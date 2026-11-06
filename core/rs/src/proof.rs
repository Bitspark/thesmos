use logos_contract::{
    clause_from_value, decode_derivation_wire_v1_bounded, BoundedWireError, CheckLimits, Clause, Derivation,
    MapProgram, Node, Premise, Term,
};
use ontos_codec::{DecodeError, DecodeLimits};
use ontos_core::Value;

use crate::clauses::supplied_clause;
use crate::law::{LAW, PROTOCOL_DATA};
use crate::values::{list_items, symbol};
use crate::{Authenticate, Bundle};

/// An asserter's live assertion at `asserted_at`; the time has no built-in policy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpaceFacts {
    pub supplier: Value,
    pub space: Value,
    pub asserted_at: Value,
    /// Native counts(author, space, head) :- body inputs; facts have empty bodies.
    pub clauses: Vec<Clause>,
}

pub(crate) struct Proof {
    pub law: Vec<u8>,
    pub layer: Vec<u8>,
    pub bundles: Vec<Bundle>,
    pub derivation: Derivation,
}

/// Why a proof was not accepted, before the checker ran.
pub(crate) enum Failure {
    /// A protocol limit: the proof was not checked, which says nothing about derivability.
    Limit(String),
    Authentication,
    Invalid(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Invalid(message)
    }
}

pub(crate) fn check_limits() -> CheckLimits {
    let limits = &PROTOCOL_DATA.limits;
    CheckLimits {
        max_nodes: limits.max_proof_steps,
        max_depth: limits.max_proof_depth,
        max_term_depth: limits.max_term_depth,
        ..CheckLimits::default()
    }
}

fn decode_limits() -> DecodeLimits {
    let limits = &PROTOCOL_DATA.limits;
    DecodeLimits {
        max_depth: limits.max_wire_depth,
        max_atom_bytes: limits.max_proof_bytes,
        max_tuple_arity: limits.max_proof_steps,
    }
}

fn decode_failure(error: DecodeError) -> Failure {
    match error {
        DecodeError::LimitExceeded { .. } => Failure::Limit(error.to_string()),
        _ => Failure::Invalid(error.to_string()),
    }
}

fn wire_failure(error: BoundedWireError) -> Failure {
    match error {
        BoundedWireError::Stopped(_) | BoundedWireError::OverBudget { .. } => Failure::Limit(error.to_string()),
        _ => Failure::Invalid(error.to_string()),
    }
}

fn atom_of_len(value: &Value, len: usize) -> Option<Vec<u8>> {
    value.as_atom().filter(|atom| atom.len() == len).map(|atom| atom.bytes().to_vec())
}

/// The small Spaces envelope; clauses and derivations use Logos's standard formats.
pub(crate) fn decode_proof(bytes: &[u8]) -> Result<Proof, Failure> {
    let protocol = &*PROTOCOL_DATA;
    if bytes.len() > protocol.limits.max_proof_bytes {
        return Err(Failure::Limit("proof byte limit exceeded".into()));
    }
    let value = ontos_codec::decode_with_limits(bytes, decode_limits()).map_err(decode_failure)?;
    let envelope = value
        .as_tuple()
        .filter(|envelope| envelope.len() == 5 && envelope.items()[0] == symbol(&protocol.format))
        .ok_or_else(|| format!("expected {} envelope", protocol.format))?;
    let items = envelope.items();
    let (Some(law), Some(layer), Some(bundles), Some(derivation)) =
        (atom_of_len(&items[1], 32), atom_of_len(&items[2], 32), items[3].as_tuple(), items[4].as_atom())
    else {
        return Err("invalid proof envelope".to_owned().into());
    };
    let mut outputs = Vec::with_capacity(bundles.len());
    for item in bundles.items() {
        let bundle = item.as_tuple().filter(|bundle| bundle.len() == 2);
        let Some((payload, authentication)) =
            bundle.and_then(|bundle| Some((bundle.items()[0].as_atom()?, &bundle.items()[1])))
        else {
            return Err("expected authenticated space_facts bundle".to_owned().into());
        };
        outputs.push(Bundle { payload: payload.bytes().to_vec(), authentication: authentication.clone() });
    }
    let account = decode_derivation_wire_v1_bounded(derivation.bytes(), &check_limits()).map_err(wire_failure)?;
    let positive = account.closed_world.is_empty()
        && account.nodes.iter().all(|node| match node {
            Node::Rule { premises, .. } => premises.iter().all(|premise| matches!(premise, Premise::Pos { .. })),
            _ => true,
        });
    if !positive {
        return Err("this experiment supports positive derivations only".to_owned().into());
    }
    Ok(Proof { law, layer, bundles: outputs, derivation: account })
}

/// Decodes evidence without treating its contents as established judgments.
pub fn decode_space_facts(bytes: &[u8]) -> Result<SpaceFacts, String> {
    if bytes.len() > PROTOCOL_DATA.limits.max_proof_bytes {
        return Err("invalid space_facts payload size".into());
    }
    let value = ontos_codec::decode_with_limits(bytes, decode_limits()).map_err(|error| error.to_string())?;
    let output = value
        .as_tuple()
        .filter(|output| output.len() == 5 && output.items()[0] == symbol("space_facts"))
        .ok_or("expected space_facts output")?;
    let items = output.items();
    let clauses = items[4].as_tuple().ok_or("expected native clause tuple")?;
    list_items(&items[2])?;
    let clauses = clauses
        .items()
        .iter()
        .map(|item| clause_from_value(item).ok_or_else(|| "expected a native Logos clause".to_owned()))
        .collect::<Result<_, _>>()?;
    Ok(SpaceFacts { supplier: items[1].clone(), space: items[2].clone(), asserted_at: items[3].clone(), clauses })
}

/// Builds the same guarded program as the producer. Authentication remains the receiver's job.
pub(crate) fn supplied_program(bundles: &[Bundle], authenticate: &Authenticate) -> Result<MapProgram, Failure> {
    let mut program = LAW.clone();
    let mut count = 0;
    for (bundle_index, bundle) in bundles.iter().enumerate() {
        let output = decode_space_facts(&bundle.payload)?;
        if !authenticate(bundle, &output.supplier) {
            return Err(Failure::Authentication);
        }
        let supplier = Term::from_value(&output.supplier);
        for (index, assertion) in output.clauses.iter().enumerate() {
            count += 1;
            if count > PROTOCOL_DATA.limits.max_proof_steps {
                return Err(Failure::Limit("bundled clause limit exceeded".into()));
            }
            let clause = supplied_clause(assertion, &supplier, &output.space)?;
            program.insert(format!("bundle/{bundle_index}/{index}"), clause);
        }
    }
    Ok(program)
}
