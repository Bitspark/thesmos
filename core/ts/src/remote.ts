import { ProofProviderError, type ProofProviderFailure } from "./failure.js";
import {
  decodeProofResult, defaultMaxRequestBytes, defaultMaxResponseBytes, encodeProofRequest,
  proofConcludes, proofMediaType, type ProducedProof, type ProofProvider, type ProofRequest,
} from "./wire.js";

export { ProofProviderError, proofProviderFailures } from "./failure.js";
export type { ProofProviderFailure, ProofSearchFailure } from "./failure.js";
export {
  decodeProofRequest, decodeProofResult, defaultMaxRequestBytes, defaultMaxResponseBytes,
  encodeProofRequest, encodeProofResult, proofConcludes, proofMediaType,
} from "./wire.js";
export type { ProducedProof, ProofBudget, ProofProvider, ProofRequest, ProofResult, SourceObservation } from "./wire.js";

/** What the caller's authentication hook sees: the exact request it may sign or annotate. */
export interface OutgoingProofRequest {
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
}

/** HTTP statuses for responses that carry no proof result. */
function statusFailure(status: number): ProofProviderFailure {
  if (status === 401 || status === 403) return "unauthenticated";
  if (status === 413) return "limit_exceeded";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 429 || status >= 500) return "provider_unavailable";
  return "invalid_response";
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new ProofProviderError("limit_exceeded", `response of ${declared} bytes exceeds ${maxBytes}`);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = reader ? await reader.read() : { done: true as const, value: undefined };
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader!.cancel();
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
  const url = new URL(options.endpoint);
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== "function") throw new TypeError("A fetch implementation is required");
  const maxRequestBytes = options.maxRequestBytes ?? defaultMaxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? defaultMaxResponseBytes;
  return Object.freeze({
    async produce(request: ProofRequest, signal?: AbortSignal): Promise<ProducedProof> {
      signal?.throwIfAborted();
      const body = encodeProofRequest(request);
      if (body.byteLength > maxRequestBytes) {
        throw new ProofProviderError("limit_exceeded", `request of ${body.byteLength} bytes exceeds ${maxRequestBytes}`);
      }
      const headers = new Headers({ "content-type": proofMediaType, accept: proofMediaType });
      await options.authenticate?.({ url, body, headers });
      let response: Response;
      try {
        response = await transport(url, { method: "POST", headers, body: body as BodyInit, redirect: "error", signal });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new ProofProviderError("provider_unavailable", "the provider could not be reached", { cause: error });
      }
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== proofMediaType) {
        await response.body?.cancel();
        throw new ProofProviderError(statusFailure(response.status), `HTTP ${response.status} without a proof result`);
      }
      let result;
      try {
        result = decodeProofResult(await readBounded(response, maxResponseBytes), maxResponseBytes);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof ProofProviderError) throw error;
        throw new ProofProviderError("invalid_response", "the provider returned a malformed proof result", { cause: error });
      }
      if (result.kind === "failure") throw new ProofProviderError(result.code, result.detail);
      if (!proofConcludes(result.proof, request)) {
        throw new ProofProviderError("invalid_response", "the proof does not conclude the requested query from the requested root");
      }
      return { proof: result.proof, observations: result.observations };
    },
  });
}
