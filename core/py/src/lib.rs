//! The Python receiver: the Rust receiver (core/rs) behind PyO3, as the module `thesmos`.
//!
//! It adds no authority rule, decoding or checking of its own; every decision is core/rs's, made
//! by Logos's Rust checker. Values cross as `Value`, a canonical Ontos value with `encode` and
//! `decode`, so they interoperate with any Ontos implementation by bytes.

use pyo3::prelude::*;

#[pymodule]
mod thesmos {
    use std::panic::resume_unwind;

    use pyo3::exceptions::{PyTypeError, PyValueError};
    use pyo3::prelude::*;
    use pyo3::types::PyBytes;

    use receiver as rs;

    /// An Ontos value: an atom of bytes, or a tuple of values. Equality is structural.
    #[pyclass(frozen, eq, hash, from_py_object, module = "thesmos")]
    #[derive(Clone, PartialEq, Eq, Hash)]
    pub struct Value(pub ontos_core::Value);

    #[pymethods]
    impl Value {
        /// The atom of exactly these bytes.
        #[staticmethod]
        fn atom(data: &[u8]) -> Value {
            Value(ontos_core::Value::atom(data))
        }

        /// The tuple of these values, in order.
        #[staticmethod]
        fn tuple(items: Vec<Value>) -> Value {
            Value(ontos_core::Value::tuple(items.into_iter().map(|item| item.0)))
        }

        /// Decodes canonical Ontos bytes (ontos-codec-v1) under the codec's default limits.
        #[staticmethod]
        fn decode(data: &[u8]) -> PyResult<Value> {
            ontos_codec::decode_with_limits(data, ontos_codec::DecodeLimits::default())
                .map(Value)
                .map_err(|error| PyValueError::new_err(error.to_string()))
        }

        /// The canonical Ontos bytes of this value.
        fn encode<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
            PyBytes::new(py, &ontos_codec::encode(&self.0))
        }

        #[getter]
        fn is_atom(&self) -> bool {
            self.0.is_atom()
        }

        /// An atom's bytes, or None for a tuple.
        #[getter]
        fn bytes<'py>(&self, py: Python<'py>) -> Option<Bound<'py, PyBytes>> {
            self.0.as_atom().map(|atom| PyBytes::new(py, atom.bytes()))
        }

        /// A tuple's items, or None for an atom.
        #[getter]
        fn items(&self) -> Option<Vec<Value>> {
            self.0.as_tuple().map(|tuple| tuple.items().iter().cloned().map(Value).collect())
        }

        fn __repr__(&self) -> String {
            // Bounded: a value built in Python can nest deeper than the stack allows.
            fn show(value: &ontos_core::Value, depth: usize) -> String {
                if depth == 0 {
                    return "...".into();
                }
                match value.as_atom() {
                    Some(atom) => match std::str::from_utf8(atom.bytes()) {
                        Ok(text) if text.chars().all(|c| !c.is_control()) => format!("{text:?}"),
                        _ => format!("0x{}", atom.bytes().iter().map(|b| format!("{b:02x}")).collect::<String>()),
                    },
                    None => {
                        let items = value.as_tuple().map(|tuple| tuple.items()).unwrap_or_default();
                        format!("({})", items.iter().map(|item| show(item, depth - 1)).collect::<Vec<_>>().join(", "))
                    }
                }
            }
            format!("Value({})", show(&self.0, 64))
        }
    }

    /// What the receiver asks: may `actor` assert `statement` in `space`?
    #[pyclass(frozen, get_all, module = "thesmos")]
    #[derive(Clone)]
    pub struct Query {
        actor: Value,
        space: Value,
        statement: Value,
    }

    #[pymethods]
    impl Query {
        #[new]
        fn new(actor: Value, space: Value, statement: Value) -> Self {
            Query { actor, space, statement }
        }
    }

    /// An authenticated space_facts output: untrusted evidence until authentication and the
    /// Logos authority proof pass.
    #[pyclass(frozen, module = "thesmos")]
    #[derive(Clone)]
    pub struct Bundle(rs::Bundle);

    #[pymethods]
    impl Bundle {
        #[new]
        fn new(payload: &[u8], authentication: Value) -> Self {
            Bundle(rs::Bundle { payload: payload.to_vec(), authentication: authentication.0 })
        }

        #[getter]
        fn payload<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
            PyBytes::new(py, &self.0.payload)
        }

        #[getter]
        fn authentication(&self) -> Value {
            Value(self.0.authentication.clone())
        }
    }

    /// The verifier's result. `code` is one of the protocol's result codes; `detail` is
    /// diagnostic only.
    #[pyclass(frozen, get_all, module = "thesmos")]
    pub struct Decision {
        permitted: bool,
        code: String,
        detail: String,
        checked_steps: usize,
    }

    #[pymethods]
    impl Decision {
        fn __repr__(&self) -> String {
            format!(
                "Decision(permitted={}, code={:?}, detail={:?}, checked_steps={})",
                if self.permitted { "True" } else { "False" },
                self.code,
                self.detail,
                self.checked_steps
            )
        }
    }

    /// An asserter's live assertion at `asserted_at`; the time has no built-in policy. Clauses
    /// are native Logos clause values.
    #[pyclass(frozen, get_all, module = "thesmos")]
    pub struct SpaceFacts {
        supplier: Value,
        space: Value,
        asserted_at: Value,
        clauses: Vec<Value>,
    }

    /// Checks supplied proofs under one configured root. It has no temporal policy and runs no
    /// search, network or clock.
    #[pyclass(frozen, module = "thesmos")]
    pub struct Verifier(rs::Verifier);

    #[pymethods]
    impl Verifier {
        /// `authenticate(bundle, supplier) -> bool` reports whether `supplier` authenticated
        /// exactly `bundle.payload`; it establishes key identity only, never authority. Only
        /// `True` authenticates: any other result denies as `authentication-failed`, and an
        /// exception it raises denies as `invalid-proof`, as in every receiver.
        #[new]
        fn new(root: Value, authenticate: Bound<'_, PyAny>) -> PyResult<Self> {
            if !authenticate.is_callable() {
                return Err(PyTypeError::new_err("authenticate must be callable"));
            }
            let authenticate = authenticate.unbind();
            let adapter = move |bundle: &rs::Bundle, supplier: &ontos_core::Value| -> bool {
                Python::attach(|py| {
                    match authenticate.call1(py, (Bundle(bundle.clone()), Value(supplier.clone()))) {
                        // Only True authenticates; any other result is a failed authentication,
                        // as TypeScript's `!== true`.
                        Ok(result) => result.bind(py).extract::<bool>().unwrap_or(false),
                        // Unwinds into the receiver's catch, which denies; no panic hook runs.
                        Err(error) => resume_unwind(Box::new(format!("authentication adapter raised {error}"))),
                    }
                })
            };
            Ok(Verifier(rs::Verifier::new(root.0, adapter)))
        }

        /// A verifier with the built-in Archon adapter (`archon_authenticate`), which runs without
        /// calling back into Python.
        #[staticmethod]
        fn archon(root: Value) -> Self {
            Verifier(rs::Verifier::new(root.0, rs::archon::authenticate))
        }

        /// Checks `proof`, Ontos-encoded bytes, for exactly `query`. Any failure denies. The GIL
        /// is released while checking.
        fn verify(&self, py: Python<'_>, query: &Query, proof: &[u8]) -> Decision {
            let query = rs::Query {
                actor: query.actor.0.clone(),
                space: query.space.0.clone(),
                statement: query.statement.0.clone(),
            };
            let decision = py.detach(|| self.0.verify(&query, proof));
            Decision {
                permitted: decision.permitted,
                code: decision.code,
                detail: decision.detail,
                checked_steps: decision.checked_steps,
            }
        }
    }

    /// The Archon adapter: verifies the bundle's Ed25519ph signature (context
    /// `thesmos/space-facts/v1`) by the supplier's 32-byte key over its exact payload.
    #[pyfunction]
    fn archon_authenticate(bundle: &Bundle, supplier: &Value) -> bool {
        rs::archon::authenticate(&bundle.0, &supplier.0)
    }

    /// The Archon adapter's protocol domain, not an authority or freshness rule.
    #[pymodule_export]
    const ARCHON_DOMAIN: &str = rs::archon::DOMAIN;

    /// A Logos symbol, not a text embedding: the atom of the name's UTF-8 bytes.
    #[pyfunction]
    fn symbol(name: &str) -> Value {
        Value(rs::symbol(name))
    }

    /// A labeled Logos compound: the tuple (name, args...).
    #[pyfunction]
    #[pyo3(signature = (name, *args))]
    fn fact(name: &str, args: Vec<Value>) -> Value {
        Value(rs::fact(name, args.into_iter().map(|arg| arg.0)))
    }

    /// Logos's [Head|Tail] notation over these items, distinct from ontos-data's flat list.
    #[pyfunction]
    fn list(items: Vec<Value>) -> Value {
        Value(rs::list(items.into_iter().map(|item| item.0)))
    }

    /// A space path of the segments' bytes (str segments as UTF-8), taken as given.
    #[pyfunction]
    #[pyo3(signature = (*segments))]
    fn path(segments: Vec<Segment>) -> Value {
        Value(rs::path(segments.into_iter().map(|segment| segment.0)))
    }

    #[derive(FromPyObject)]
    struct Segment(#[pyo3(from_py_with = segment_bytes)] Vec<u8>);

    fn segment_bytes(segment: &Bound<'_, PyAny>) -> PyResult<Vec<u8>> {
        if let Ok(text) = segment.extract::<String>() {
            return Ok(text.into_bytes());
        }
        segment
            .cast::<PyBytes>()
            .map(|bytes| bytes.as_bytes().to_vec())
            .map_err(|_| PyTypeError::new_err("a path segment is str or bytes"))
    }

    /// The authorized(actor, statement, space) compound a query asks for.
    #[pyfunction]
    fn authorization(actor: Value, statement: Value, space: Value) -> Value {
        Value(rs::authorization(actor.0, statement.0, space.0))
    }

    /// Binds the executable law and assertion construction to one native program digest.
    #[pyfunction]
    fn law_digest(py: Python<'_>) -> Bound<'_, PyBytes> {
        PyBytes::new(py, &rs::law_digest())
    }

    /// The space-asserter layer's own identity.
    #[pyfunction]
    fn layer_digest(py: Python<'_>) -> Bound<'_, PyBytes> {
        PyBytes::new(py, &rs::layer_digest())
    }

    /// Decodes evidence without treating its contents as established judgments.
    #[pyfunction]
    fn decode_space_facts(payload: &[u8]) -> PyResult<SpaceFacts> {
        let facts = rs::decode_space_facts(payload).map_err(PyValueError::new_err)?;
        Ok(SpaceFacts {
            supplier: Value(facts.supplier),
            space: Value(facts.space),
            asserted_at: Value(facts.asserted_at),
            clauses: facts.clauses.iter().map(|clause| Value(logos_contract::clause_value(clause))).collect(),
        })
    }
}
