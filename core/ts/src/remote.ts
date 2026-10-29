import { ProofProviderError, type ProofProviderFailure } from "./failure.js";
import { maxDeadlineMs } from "./wire.js";
import {
  decodeProofResult, defaultMaxRequestBytes, defaultMaxResponseBytes, encodeProofRequest,
  proofConcludes, proofMediaType, type ProducedProof, type ProofProvider, type ProofRequest,
} from "./wire.js";

export { ProofProviderError, proofProviderFailures } from "./failure.js";
export type { ProofProviderFailure, ProofSearchFailure } from "./failure.js";
export {
  decodeProofRequest, decodeProofResult, defaultMaxRequestBytes, defaultMaxResponseBytes, maxDeadlineMs,
  encodeProofRequest, encodeProofResult, proofMediaType,
} from "./wire.js";
export type { ProducedProof, ProofBudget, ProofProvider, ProofRequest, ProofResult, SourceObservation } from "./wire.js";

/**
 * What the caller's authentication hook sees: the exact request it signs or annotates. A signature
 * should bind the method, the exact target, the `content-type` header and the body. The adapter
 * never retries, so every `produce` authenticates afresh, with a new replay nonce where one is used.
 */
export interface OutgoingProofRequest {
  readonly method: "POST";
  readonly url: URL;
  readonly body: Uint8Array;
  readonly headers: Headers;
}

export interface HttpProofProviderOptions {
  readonly endpoint: string | URL;
  /** Transport; defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Authenticates the caller to the provider. thesmos never sees or stores credentials. */
  readonly authenticate?: (request: OutgoingProofRequest) => void | Promise<void>;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  /**
   * The longest the adapter waits for a complete response, in milliseconds (default 60,000). On
   * expiry it stops waiting with `provider_unavailable`; the provider still owns its worker.
   */
  readonly timeoutMs?: number;
}

export const defaultTimeoutMs = 60_000;

/**
 * HTTP statuses for responses that carry no typed proof result. These claim no more than the
 * status: an untyped 403 is a refusal by the provider or an intermediary, not an authentication
 * failure and not a disclosure decision.
 */
function statusFailure(status: number): ProofProviderFailure {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "provider_refused";
  if (status === 413) return "limit_exceeded";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 429 || status >= 500) return "provider_unavailable";
  return "invalid_response";
}

const maxDetail = 512;
// Truncates by code point, so the result never splits a surrogate pair and re-encodes as text.
const safeDetail = (detail: string | undefined) => {
  if (detail === undefined) return undefined;
  const points = Array.from(detail);
  return points.length > maxDetail ? points.slice(0, maxDetail).join("") + "…" : detail;
};

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProofProviderError("limit_exceeded", `response of ${declared} bytes exceeds ${maxBytes}`);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let next;
    try {
      next = reader ? await reader.read() : { done: true as const, value: undefined };
    } catch (error) {
      throw new ProofProviderError("provider_unavailable", "the response was interrupted", { cause: error });
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader!.cancel().catch(() => undefined);
      throw new ProofProviderError("limit_exceeded", `response exceeds ${maxBytes} bytes`);
    }
    chunks.push(next.value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/**
 * A remote proof provider over HTTP. It needs no Logos kernel, WASM or filesystem. The returned
 * proof is untrusted until the receiver verifies it with its own root and actual request query.
 */
export function createHttpProofProvider(options: HttpProofProviderOptions): ProofProvider {
  const endpoint = new URL(options.endpoint);
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== "function") throw new TypeError("A fetch implementation is required");
  const maxRequestBytes = options.maxRequestBytes ?? defaultMaxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? defaultMaxResponseBytes;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  for (const [name, value] of [["maxRequestBytes", maxRequestBytes], ["maxResponseBytes", maxResponseBytes], ["timeoutMs", timeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  // Timers hold at most 2^31-1 ms; larger values would silently fire at once.
  if (timeoutMs > maxDeadlineMs) throw new TypeError(`timeoutMs must not exceed ${maxDeadlineMs}`);
  return Object.freeze({
    async produce(request: ProofRequest, signal?: AbortSignal): Promise<ProducedProof> {
      signal?.throwIfAborted();
      const body = encodeProofRequest(request);
      if (body.byteLength > maxRequestBytes) {
        throw new ProofProviderError("limit_exceeded", `request of ${body.byteLength} bytes exceeds ${maxRequestBytes}`);
      }
      // A fresh target per call: an authentication hook may annotate it without affecting others.
      const url = new URL(endpoint);
      const headers = new Headers({ "content-type": proofMediaType, accept: proofMediaType });
      await options.authenticate?.({ method: "POST", url, body, headers });
      // The caller's cancellation and the adapter's own wait bound, kept distinguishable.
      const timer = AbortSignal.timeout(timeoutMs);
      const wait = signal ? AbortSignal.any([signal, timer]) : timer;
      const stopped = (error: unknown) => {
        if (signal?.aborted) return signal.reason;
        if (timer.aborted) return new ProofProviderError("provider_unavailable", `no complete response within ${timeoutMs} ms`, { cause: error });
        return undefined;
      };
      let response: Response;
      try {
        response = await transport(url, { method: "POST", headers, body: body as BodyInit, redirect: "error", signal: wait });
      } catch (error) {
        const reason = stopped(error);
        if (reason !== undefined) throw reason;
        throw new ProofProviderError("provider_unavailable", "the provider could not be reached, or redirected the request", { cause: error });
      }
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== proofMediaType) {
        try { await response.body?.cancel(); } catch (error) {
          const reason = stopped(error);
          if (reason !== undefined) throw reason;
        }
        throw new ProofProviderError(statusFailure(response.status), `HTTP ${response.status} without a proof result`);
      }
      let result;
      try {
        result = decodeProofResult(await readBounded(response, maxResponseBytes), maxResponseBytes);
      } catch (error) {
        const reason = stopped(error);
        if (reason !== undefined) throw reason;
        if (error instanceof ProofProviderError) throw error;
        throw new ProofProviderError("invalid_response", "the provider returned a malformed proof result", { cause: error });
      }
      if (result.kind === "failure") throw new ProofProviderError(result.code, safeDetail(result.detail));
      if (!proofConcludes(result.proof, request)) {
        throw new ProofProviderError("invalid_response", "the proof does not conclude the requested query from the requested root");
      }
      return { proof: result.proof, observations: result.observations };
    },
  });
}
