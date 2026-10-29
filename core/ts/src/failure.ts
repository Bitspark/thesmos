/**
 * Why `prove` returned no proof. `exhausted`: the certified search drained its answer stream
 * without deriving the query from these bundles. `not_completed`: any other outcome, such as a
 * limit, cancellation, the memory ceiling, an engine failure or a request Logos refused, so the
 * search established nothing. Neither is a proof of prohibition.
 */
export type ProofSearchFailure = "exhausted" | "not_completed";

/**
 * Why a proof provider returned no proof. The search outcomes keep their meaning; the others
 * describe the request, the evidence, the provider or its response. None means "prohibited".
 */
export type ProofProviderFailure = ProofSearchFailure
  | "disclosure_refused" | "unauthenticated" | "evidence_unavailable" | "invalid_request"
  | "limit_exceeded" | "provider_unavailable" | "invalid_response";

export const proofProviderFailures: readonly ProofProviderFailure[] = Object.freeze([
  "exhausted", "not_completed", "disclosure_refused", "unauthenticated", "evidence_unavailable",
  "invalid_request", "limit_exceeded", "provider_unavailable", "invalid_response",
]);

/** The failure a proof provider reports. `detail` is safe descriptive text, never evidence. */
export class ProofProviderError extends Error {
  static { this.prototype.name = "ProofProviderError"; }
  constructor(readonly code: ProofProviderFailure, readonly detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
  }
}
