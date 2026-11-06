//! The Rust decider of the cross-language differential test (scripts/differential): reads
//! cases.ontos on stdin and writes one JSON decision per line. A development tool, not part of the
//! crate's API.

use std::io::{Read, Write};

use archon_core::crypto;
use ontos_codec::DecodeLimits;
use sha2::{Digest, Sha256};
use thesmos::{Bundle, Query, Value, Verifier};

fn example_authenticate(bundle: &Bundle, supplier: &Value) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(b"Spaces public example key\0");
    hasher.update(ontos_codec::encode(supplier));
    let key = crypto::public_key_from_seed(&hasher.finalize().into());
    bundle.authentication.as_atom().is_some_and(|signature| crypto::verify(&key, &bundle.payload, signature.bytes()))
}

fn main() {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
    let limits = DecodeLimits { max_depth: 4096, ..DecodeLimits::default() };
    let file = ontos_codec::decode_with_limits(&input, limits).unwrap();
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    for (i, entry) in file.as_tuple().unwrap().items()[2].as_tuple().unwrap().items().iter().enumerate() {
        let fields = entry.as_tuple().unwrap().items();
        let q = fields[1].as_tuple().unwrap().items();
        let query = Query { actor: q[0].clone(), space: q[1].clone(), statement: q[2].clone() };
        let verifier = match fields[3].as_atom().unwrap().bytes() {
            b"example" => Verifier::new(fields[0].clone(), example_authenticate),
            b"archon" => Verifier::new(fields[0].clone(), thesmos::archon::authenticate),
            b"accept" => Verifier::new(fields[0].clone(), |_: &Bundle, _: &Value| true),
            other => panic!("unknown authenticator {other:?}"),
        };
        let d = verifier.verify(&query, fields[2].as_atom().unwrap().bytes());
        let steps = if d.permitted { d.checked_steps } else { 0 };
        let line = serde_json::json!({ "i": i, "permitted": d.permitted, "code": d.code, "steps": steps });
        writeln!(out, "{line}").unwrap();
    }
}
