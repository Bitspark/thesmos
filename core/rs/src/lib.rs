//! Verifies Spaces authority proofs under the frozen law, revision 3.
//!
//! This is the receiver: it checks a supplied proof for a query the receiver constructs, and runs
//! no search, network or clock. The law and its layer are embedded data; Logos's checker decides.
//! It is the Rust counterpart of the `@bitspark/thesmos` root entry and of the Go module, and
//! accepts the same proofs.

mod clauses;
mod law;
mod proof;
mod values;

#[cfg(test)]
mod tests;

#[cfg(feature = "archon")]
pub mod archon;

use std::panic::{catch_unwind, AssertUnwindSafe};

use logos_contract::{
    check, AlwaysAdmit, CheckProfile, Evidence, GroundLiteral, LeafOutcome, LeafVerifier, Outcome, PredicateSet,
    TermTheory,
};
pub use ontos_core::Value;

pub use law::{law_digest, layer_digest};
pub use proof::{decode_space_facts, SpaceFacts};
pub use values::{authorization, fact, list, path, symbol};

use law::PROTOCOL_DATA;
use proof::{check_limits, decode_proof, supplied_program, Failure};
use values::input_literal;

/// What the receiver asks: may `actor` assert `statement` in `space`? All three are native Ontos
/// values; `space` is a Logos path list (see [`path`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Query {
    pub actor: Value,
    pub space: Value,
    pub statement: Value,
}

/// An authenticated space_facts output: untrusted evidence until authentication and the Logos
/// authority proof pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bundle {
    pub payload: Vec<u8>,
    pub authentication: Value,
}

/// Reports whether `supplier` authenticated exactly `bundle.payload` with
/// `bundle.authentication`. It establishes key identity only, never authority.
pub type Authenticate = dyn Fn(&Bundle, &Value) -> bool + Send + Sync;

/// The verifier's result. `code` is one of the protocol's result codes; `detail` is diagnostic
/// only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decision {
    pub permitted: bool,
    pub code: String,
    pub detail: String,
    pub checked_steps: usize,
}

/// Checks supplied proofs under one configured root.
pub struct Verifier {
    authenticate: Box<Authenticate>,
    anchor: GroundLiteral,
}

struct RootLeaves {
    anchor: GroundLiteral,
    extensional: PredicateSet,
}

impl LeafVerifier<()> for RootLeaves {
    fn extensional(&self) -> &PredicateSet {
        &self.extensional
    }

    fn verify(&self, claim: &GroundLiteral, _evidence: &Evidence, _ctx: &()) -> LeafOutcome {
        if *claim == self.anchor {
            LeafOutcome::Admit
        } else {
            LeafOutcome::Reject { code: "unaccepted_premise".into() }
        }
    }
}

impl Verifier {
    /// Verifies the supplied evidence and finite proof under `root`. It has no temporal policy and
    /// runs no search.
    pub fn new(root: Value, authenticate: impl Fn(&Bundle, &Value) -> bool + Send + Sync + 'static) -> Self {
        let anchor = input_literal(&fact("root", [root])).expect("root(...) is a labeled compound");
        Verifier { authenticate: Box::new(authenticate), anchor }
    }

    /// Checks `proof`, Ontos-encoded bytes, for exactly `query`. Any failure denies, including a
    /// panic in the authentication adapter (with the default `panic = "unwind"`; under
    /// `panic = "abort"` a panic ends the process instead).
    pub fn verify(&self, query: &Query, proof: &[u8]) -> Decision {
        catch_unwind(AssertUnwindSafe(|| self.decide(query, proof))).unwrap_or_else(|panic| {
            let message = panic
                .downcast_ref::<&str>()
                .map(|text| text.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_default();
            reject(&PROTOCOL_DATA.results.invalid, format!("verification failed: {message}"))
        })
    }

    fn decide(&self, query: &Query, proof_bytes: &[u8]) -> Decision {
        let results = &PROTOCOL_DATA.results;
        let fail = |failure: Failure| match failure {
            Failure::Authentication => reject(&results.authentication, "space-facts output did not authenticate"),
            Failure::Limit(detail) => reject(&results.limit, detail),
            Failure::Invalid(detail) => reject(&results.invalid, detail),
        };
        let proof = match decode_proof(proof_bytes) {
            Ok(proof) => proof,
            Err(failure) => return fail(failure),
        };
        if proof.law != law_digest() {
            return reject(&results.law_mismatch, "proof names another law");
        }
        if proof.layer != layer_digest() {
            return reject(&results.layer_mismatch, "proof names another input layer");
        }
        let program = match supplied_program(&proof.bundles, self.authenticate.as_ref()) {
            Ok(program) => program,
            Err(failure) => return fail(failure),
        };
        let claim = authorization(query.actor.clone(), query.statement.clone(), query.space.clone());
        let claim = match input_literal(&claim) {
            Ok(claim) => claim,
            Err(detail) => return reject(&results.invalid, detail),
        };
        let profile = CheckProfile {
            theory: Box::new(TermTheory),
            leaves: Box::new(RootLeaves {
                anchor: self.anchor.clone(),
                extensional: PredicateSet::from_iter(["root"]),
            }),
            admit: Box::new(AlwaysAdmit),
            limits: check_limits(),
        };
        match check(&program, &claim, &proof.derivation, &(), &profile) {
            Outcome::Accept => Decision {
                permitted: true,
                code: results.permitted.clone(),
                detail: String::new(),
                checked_steps: proof.derivation.nodes.len(),
            },
            Outcome::Reject { code, detail } => {
                let code = code.code();
                let result = match code {
                    "too_many_nodes" | "too_deep" | "term_too_deep" => &results.limit,
                    _ => &results.rejected,
                };
                reject(result, format!("{code}: {detail}"))
            }
        }
    }
}

fn reject(code: &str, detail: impl Into<String>) -> Decision {
    Decision { permitted: false, code: code.to_owned(), detail: detail.into(), checked_steps: 0 }
}
