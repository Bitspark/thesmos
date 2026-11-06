// The receiver's tests, inside the crate so they can rebuild a proof's envelope. The corpus and the
// Archon vector are byte copies of law/conformance.ontos and the Go module's TypeScript-written
// vector, kept equal by `npm run law:check`.

use archon_core::crypto;
use logos_contract::{clause_value, encode_derivation_wire_v1};
use ontos_core::Value;
use sha2::{Digest, Sha256};

use crate::law::PROTOCOL_DATA;
use crate::proof::{decode_proof, Proof};
use crate::*;

fn data(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/tests/data/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

// The public demo keys of the frozen corpus, reproducible from the identity. They are not
// credentials. Applications supply their own authentication adapter.
fn example_seed(identity: &Value) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"Spaces public example key\0");
    hasher.update(ontos_codec::encode(identity));
    hasher.finalize().into()
}

fn authenticate_example(bundle: &Bundle, supplier: &Value) -> bool {
    let key = crypto::public_key_from_seed(&example_seed(supplier));
    bundle.authentication.as_atom().is_some_and(|signature| crypto::verify(&key, &bundle.payload, signature.bytes()))
}

struct Case {
    name: String,
    why: String,
    root: Value,
    query: Query,
    proof: Vec<u8>,
    permitted: bool,
}

fn corpus() -> Vec<Case> {
    let file = ontos_codec::decode(&data("conformance.ontos")).unwrap();
    let file = file.as_tuple().unwrap().items();
    assert_eq!(file.len(), 3);
    assert_eq!(file[0], symbol("spaces/conformance/2"), "conformance format");
    assert_eq!(file[1], Value::atom(law_digest()), "conformance law");
    let text = |value: &Value| ontos_data::read_text(value).unwrap();
    file[2]
        .as_tuple()
        .unwrap()
        .items()
        .iter()
        .map(|entry| {
            let fields = entry.as_tuple().unwrap().items();
            let query = fields[3].as_tuple().unwrap().items();
            Case {
                name: text(&fields[0]),
                why: text(&fields[1]),
                root: fields[2].clone(),
                query: Query { actor: query[0].clone(), space: query[1].clone(), statement: query[2].clone() },
                proof: fields[4].as_atom().unwrap().bytes().to_vec(),
                permitted: ontos_data::read_bool(&fields[5]).unwrap(),
            }
        })
        .collect()
}

fn permitted_case() -> (Case, Verifier) {
    let case = corpus().into_iter().find(|case| case.permitted).expect("corpus has a permitted case");
    let verifier = Verifier::new(case.root.clone(), authenticate_example);
    (case, verifier)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn digests_equal_the_typescript_identities() {
    assert_eq!(hex(&law_digest()), "80f91df84e8597daf04bebc8643bc8884086829b0d06795d1e0ee97be379fe7d");
    assert_eq!(hex(&layer_digest()), "84dfbd82bcb650b31a4e5f44f3b91b303fcb516166c12f7f9bba11cbfbe07cb0");
}

#[test]
fn embedded_law_is_the_frozen_law() {
    let root = format!("{}/../../law", env!("CARGO_MANIFEST_DIR"));
    if !std::path::Path::new(&root).exists() {
        return; // law/ is outside a vendored crate; the repository gate compares the copy
    }
    for (copy, source) in [
        ("common-law.ontos", "common-law.ontos"),
        ("assertion-template.ontos", "assertion-template.ontos"),
        ("space-asserter-template.ontos", "layers/space-asserter-template.ontos"),
        ("protocol.json", "protocol.json"),
    ] {
        let embedded = std::fs::read(format!("{}/law/{copy}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        assert_eq!(embedded, std::fs::read(format!("{root}/{source}")).unwrap(), "law/{source}");
    }
}

#[test]
fn frozen_conformance_corpus() {
    let cases = corpus();
    assert!(!cases.is_empty(), "empty corpus");
    let mut wrong = Vec::new();
    for case in &cases {
        let decision = Verifier::new(case.root.clone(), authenticate_example).verify(&case.query, &case.proof);
        if decision.permitted != case.permitted {
            wrong.push(format!("{} ({}): {:?}, want permitted {}", case.name, case.why, decision, case.permitted));
        }
    }
    assert!(wrong.is_empty(), "{} of {} cases differ:\n{}", wrong.len(), cases.len(), wrong.join("\n"));
}

#[test]
fn malformed_bytes_do_not_establish_permission() {
    let (case, verifier) = permitted_case();
    let mut extended = case.proof.clone();
    extended.push(0);
    for bad in [&b""[..], b"{}", &case.proof[..case.proof.len() - 1], &extended] {
        let decision = verifier.verify(&case.query, bad);
        assert_eq!(decision.code, PROTOCOL_DATA.results.invalid, "malformed proof: {decision:?}");
    }
}

#[test]
fn limits_refuse_without_claiming_non_derivability() {
    let (case, verifier) = permitted_case();
    let limits = &PROTOCOL_DATA.limits;
    let decision = verifier.verify(&case.query, &vec![0; limits.max_proof_bytes + 1]);
    assert_eq!(decision.code, PROTOCOL_DATA.results.limit, "oversized proof: {decision:?}");
    let nested = (0..limits.max_wire_depth + 2).fold(symbol("x"), |inner, _| Value::tuple([inner]));
    let decision = verifier.verify(&case.query, &ontos_codec::encode(&nested));
    assert_eq!(decision.code, PROTOCOL_DATA.results.limit, "deep wire value: {decision:?}");
}

#[test]
fn another_query_root_or_authentication_denies() {
    let (case, verifier) = permitted_case();
    let results = &PROTOCOL_DATA.results;
    let baseline = verifier.verify(&case.query, &case.proof);
    assert!(baseline.permitted && baseline.code == results.permitted, "baseline: {baseline:?}");
    let other = Query { statement: fact("another_statement", []), ..case.query.clone() };
    let decision = verifier.verify(&other, &case.proof);
    assert!(!decision.permitted && decision.code == results.rejected, "another statement: {decision:?}");
    let decision = Verifier::new(symbol("another_root"), authenticate_example).verify(&case.query, &case.proof);
    assert!(!decision.permitted && decision.code == results.rejected, "another root: {decision:?}");
    let decision = Verifier::new(case.root.clone(), |_: &Bundle, _: &Value| false).verify(&case.query, &case.proof);
    assert!(!decision.permitted && decision.code == results.authentication, "failed authentication: {decision:?}");
    let panics = Verifier::new(case.root.clone(), |_: &Bundle, _: &Value| -> bool { panic!("adapter failure") });
    let decision = panics.verify(&case.query, &case.proof);
    assert!(!decision.permitted && decision.code == results.invalid, "panicking adapter: {decision:?}");
}

// Rebuilds a proof with `edit` applied to its decoded parts: law, layer, bundles, derivation.
fn envelope(proof: &[u8], edit: impl FnOnce(&mut Proof)) -> Vec<u8> {
    let mut proof = decode_proof(proof).ok().expect("decodable proof");
    edit(&mut proof);
    let bundles = proof
        .bundles
        .iter()
        .map(|bundle| Value::tuple([Value::atom(bundle.payload.clone()), bundle.authentication.clone()]));
    ontos_codec::encode(&Value::tuple([
        symbol(&PROTOCOL_DATA.format),
        Value::atom(proof.law),
        Value::atom(proof.layer),
        Value::tuple(bundles),
        Value::atom(encode_derivation_wire_v1(&proof.derivation)),
    ]))
}

// Encodes facts and signs them with the corpus's example key for their supplier.
fn resign(facts: &SpaceFacts) -> Bundle {
    let clauses = facts.clauses.iter().map(clause_value);
    let payload = ontos_codec::encode(&Value::tuple([
        symbol("space_facts"),
        facts.supplier.clone(),
        facts.space.clone(),
        facts.asserted_at.clone(),
        Value::tuple(clauses),
    ]));
    let signature = crypto::sign(&example_seed(&facts.supplier), &payload);
    Bundle { payload, authentication: Value::atom(signature.to_vec()) }
}

type Edit = Box<dyn FnOnce(&mut Proof)>;

#[test]
fn each_result_code_is_reachable() {
    let (case, verifier) = permitted_case();
    let results = &PROTOCOL_DATA.results;
    let baseline = verifier.verify(&case.query, &envelope(&case.proof, |_| {}));
    assert!(baseline.permitted, "re-encoded baseline: {baseline:?}");
    let steps = PROTOCOL_DATA.limits.max_proof_steps;
    let checks: Vec<(&str, Edit, &String)> = vec![
        ("another law", Box::new(|proof| proof.law = vec![0; 32]), &results.law_mismatch),
        ("another layer", Box::new(|proof| proof.layer = vec![0; 32]), &results.layer_mismatch),
        (
            "changed signature",
            Box::new(|proof| {
                let mut signature = proof.bundles[0].authentication.as_atom().unwrap().bytes().to_vec();
                signature[0] ^= 1;
                proof.bundles[0].authentication = Value::atom(signature);
            }),
            &results.authentication,
        ),
        (
            "changed payload",
            Box::new(|proof| {
                let mut facts = decode_space_facts(&proof.bundles[0].payload).unwrap();
                facts.asserted_at = symbol("another time");
                proof.bundles[0].payload = resign(&facts).payload;
            }),
            &results.authentication,
        ),
        (
            "too many bundled clauses",
            // One bundle over the limit is refused while decoding it (invalid-proof, as in
            // TypeScript and Go); two bundles within it exceed it together.
            Box::new(move |proof| {
                let mut facts = decode_space_facts(&proof.bundles[0].payload).unwrap();
                while facts.clauses.len() <= steps / 2 {
                    facts.clauses.push(facts.clauses[0].clone());
                }
                proof.bundles.extend([resign(&facts), resign(&facts)]);
            }),
            &results.limit,
        ),
        (
            "too many nodes",
            Box::new(move |proof| {
                while proof.derivation.nodes.len() <= steps {
                    proof.derivation.nodes.push(proof.derivation.nodes[0].clone());
                }
            }),
            &results.limit,
        ),
    ];
    for (name, edit, code) in checks {
        let decision = verifier.verify(&case.query, &envelope(&case.proof, edit));
        assert!(!decision.permitted && decision.code == *code, "{name}: {decision:?}, want {code}");
    }
}
