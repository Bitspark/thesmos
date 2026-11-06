// tests/data/archon-document.ontos is the TypeScript SDK's Archon-signed document example, written
// by scripts/export-archon-vector.mjs; the TypeScript and Go suites check the same bytes.
#![cfg(feature = "archon")]

use thesmos::{archon, decode_space_facts, Bundle, Query, Value, Verifier};

fn flip(bytes: &[u8], index: usize) -> Vec<u8> {
    let mut changed = bytes.to_vec();
    changed[index] ^= 1;
    changed
}

#[test]
fn typescript_archon_proof_verifies() {
    let raw = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data/archon-document.ontos")).unwrap();
    let vector = ontos_codec::decode(&raw).unwrap();
    let vector = vector.as_tuple().unwrap().items();
    let q = vector[1].as_tuple().unwrap().items();
    let query = Query { actor: q[0].clone(), space: q[1].clone(), statement: q[2].clone() };
    let proof = vector[2].as_atom().unwrap().bytes();
    let verifier = Verifier::new(vector[0].clone(), archon::authenticate);
    let decision = verifier.verify(&query, proof);
    assert!(decision.permitted, "TypeScript Archon proof: {decision:?}");
    // Any changed byte breaks either the envelope, a signature or the proof.
    for offset in [proof.len() / 3, proof.len() / 2, proof.len() - 40] {
        assert!(!verifier.verify(&query, &flip(proof, offset)).permitted, "byte {offset} changed, still permitted");
    }

    // The adapter itself: the vector's first bundle authenticates only exactly as signed.
    let envelope = ontos_codec::decode(proof).unwrap();
    let first =
        envelope.as_tuple().unwrap().items()[3].as_tuple().unwrap().items()[0].as_tuple().unwrap().items().to_vec();
    let (payload, signature) = (first[0].as_atom().unwrap().bytes(), first[1].as_atom().unwrap().bytes());
    let facts = decode_space_facts(payload).unwrap();
    let bundle = Bundle { payload: payload.to_vec(), authentication: Value::atom(signature) };
    assert!(archon::authenticate(&bundle, &facts.supplier), "the TypeScript-signed bundle does not authenticate");
    let key = facts.supplier.as_atom().unwrap().bytes();
    for (name, bundle, supplier) in [
        (
            "changed payload",
            Bundle { payload: flip(payload, payload.len() / 2), ..bundle.clone() },
            facts.supplier.clone(),
        ),
        (
            "changed signature",
            Bundle { authentication: Value::atom(flip(signature, 0)), ..bundle.clone() },
            facts.supplier.clone(),
        ),
        ("another key", bundle.clone(), Value::atom(flip(key, 0))),
        ("short key", bundle.clone(), Value::atom(&key[..31])),
        ("non-atom signature", Bundle { authentication: Value::tuple([]), ..bundle.clone() }, facts.supplier.clone()),
        ("non-atom supplier", bundle.clone(), Value::tuple([facts.supplier.clone()])),
    ] {
        assert!(!archon::authenticate(&bundle, &supplier), "{name} authenticated");
    }
}
