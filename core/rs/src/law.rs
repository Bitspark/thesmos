use std::sync::LazyLock;

use logos_contract::{program_digest, program_from_value, Clause, ClauseId, MapProgram, Program};

// The frozen law, as a byte copy of law/ made by scripts/embed-law.mjs --rs. A crate fetched as
// a git dependency or vendored carries only its own directory, so the copy is committed;
// `npm run law:check` fails if it differs from law/, which conformance/frozen.json pins.
const COMMON_LAW: &[u8] = include_bytes!("../law/common-law.ontos");
const ASSERTION_TEMPLATE: &[u8] = include_bytes!("../law/assertion-template.ontos");
const SPACE_ASSERTER_TEMPLATE: &[u8] = include_bytes!("../law/space-asserter-template.ontos");
const PROTOCOL: &str = include_str!("../law/protocol.json");

pub(crate) struct Limits {
    pub max_proof_bytes: usize,
    pub max_wire_depth: usize,
    pub max_proof_steps: usize,
    pub max_proof_depth: usize,
    pub max_term_depth: usize,
}

/// The protocol's result codes, from the embedded protocol.json.
pub(crate) struct Results {
    pub permitted: String,
    pub invalid: String,
    pub law_mismatch: String,
    pub layer_mismatch: String,
    pub authentication: String,
    pub limit: String,
    pub rejected: String,
}

pub(crate) struct Protocol {
    pub format: String,
    pub limits: Limits,
    pub results: Results,
}

pub(crate) static PROTOCOL_DATA: LazyLock<Protocol> = LazyLock::new(|| {
    let data: serde_json::Value = serde_json::from_str(PROTOCOL).expect("thesmos: embedded protocol.json");
    let text = |group: &str, key: &str| -> String {
        data[group][key].as_str().unwrap_or_else(|| panic!("thesmos: protocol.json has no {group}.{key}")).to_owned()
    };
    let limit = |key: &str| -> usize {
        data["limits"][key].as_u64().unwrap_or_else(|| panic!("thesmos: protocol.json has no limits.{key}")) as usize
    };
    Protocol {
        format: data["format"].as_str().expect("thesmos: protocol.json has no format").to_owned(),
        limits: Limits {
            max_proof_bytes: limit("maxProofBytes"),
            max_wire_depth: limit("maxWireDepth"),
            max_proof_steps: limit("maxProofSteps"),
            max_proof_depth: limit("maxProofDepth"),
            max_term_depth: limit("maxTermDepth"),
        },
        results: Results {
            permitted: text("results", "permitted"),
            invalid: text("results", "invalid"),
            law_mismatch: text("results", "lawMismatch"),
            layer_mismatch: text("results", "layerMismatch"),
            authentication: text("results", "authentication"),
            limit: text("results", "limit"),
            rejected: text("results", "rejected"),
        },
    }
});

fn load_program(bytes: &[u8]) -> MapProgram {
    let value = ontos_codec::decode(bytes).expect("thesmos: embedded law");
    program_from_value(&value).expect("thesmos: embedded law")
}

fn template_clause(bytes: &[u8], id: &str) -> Clause {
    load_program(bytes)
        .clause(&ClauseId::new(id))
        .unwrap_or_else(|| panic!("thesmos: embedded law has no clause {id}"))
        .clone()
}

pub(crate) static LAW: LazyLock<MapProgram> = LazyLock::new(|| load_program(COMMON_LAW));
pub(crate) static ASSERTION: LazyLock<Clause> =
    LazyLock::new(|| template_clause(ASSERTION_TEMPLATE, "assertion-template"));
pub(crate) static SPACE_ASSERTER: LazyLock<Clause> =
    LazyLock::new(|| template_clause(SPACE_ASSERTER_TEMPLATE, "supplied-assertion-template"));

static LAW_DIGEST: LazyLock<[u8; 32]> = LazyLock::new(|| {
    let mut program = LAW.clone();
    program.insert("assertion-template", ASSERTION.clone());
    program_digest(&program)
});

static LAYER_DIGEST: LazyLock<[u8; 32]> =
    LazyLock::new(|| program_digest(&MapProgram::new().with("supplied-assertion-template", SPACE_ASSERTER.clone())));

/// Binds the executable law and assertion construction to one native program digest.
pub fn law_digest() -> [u8; 32] {
    *LAW_DIGEST
}

/// The space-asserter layer's own identity; the frozen core's identity is unchanged.
pub fn layer_digest() -> [u8; 32] {
    *LAYER_DIGEST
}
