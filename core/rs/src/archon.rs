//! Authenticates space_facts bundles with archon's Ed25519ph domain signatures.
//!
//! The Rust counterpart of `@bitspark/thesmos/archon` and the Go `archon` package. A supplier
//! identity is its exact 32-byte archon public key. Authentication establishes key identity only;
//! authority comes from the law.

use archon_core::crypto::verify_in_domain;

use crate::{Bundle, Value};

/// This adapter's protocol domain, not an authority or freshness rule.
pub const DOMAIN: &str = "thesmos/space-facts/v1";

/// Verifies the bundle's signature by the supplier's key over its exact payload.
pub fn authenticate(bundle: &Bundle, supplier: &Value) -> bool {
    match (supplier.as_atom(), bundle.authentication.as_atom()) {
        (Some(key), Some(signature)) => verify_in_domain(key.bytes(), DOMAIN, &bundle.payload, signature.bytes()),
        _ => false,
    }
}
