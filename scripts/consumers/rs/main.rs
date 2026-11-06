//! A consumer of the Rust receiver, made by scripts/consumers/run.sh as a fresh crate with
//! `bitspark-thesmos` as a git dependency at one commit: it verifies the TypeScript-signed Archon
//! proof, and the same proof with one changed byte is denied.

use thesmos::{archon, Query, Verifier};

fn main() {
    let path = std::env::args().nth(1).expect("usage: thesmos-consumer <archon-document.ontos>");
    let vector = ontos_codec::decode(&std::fs::read(path).expect("read the vector")).expect("decode the vector");
    let items = vector.as_tuple().expect("the vector is a tuple").items();
    let q = items[1].as_tuple().expect("the query is a tuple").items();
    let query = Query { actor: q[0].clone(), space: q[1].clone(), statement: q[2].clone() };
    let mut proof = items[2].as_atom().expect("the proof is an atom").bytes().to_vec();
    let verifier = Verifier::new(items[0].clone(), archon::authenticate);
    let decision = verifier.verify(&query, &proof);
    let middle = proof.len() / 2;
    proof[middle] ^= 1;
    let changed = verifier.verify(&query, &proof);
    println!(
        "Rust: {} after {} checked steps; with one byte changed, {}",
        decision.code, decision.checked_steps, changed.code
    );
    if !decision.permitted || changed.permitted {
        std::process::exit(1);
    }
}
