use logos_contract::{GroundLiteral, Symbol};
use ontos_core::Value;

/// A Logos symbol, not a text embedding: the atom of the name's UTF-8 bytes.
pub fn symbol(name: &str) -> Value {
    Value::atom(name.as_bytes())
}

/// A labeled Logos compound: the tuple (name, args...).
pub fn fact(name: &str, args: impl IntoIterator<Item = Value>) -> Value {
    Value::tuple(std::iter::once(symbol(name)).chain(args))
}

/// Logos's [Head|Tail] notation, distinct from ontos-data's flat list embedding.
pub fn list(items: impl IntoIterator<Item = Value>) -> Value {
    let items: Vec<Value> = items.into_iter().collect();
    items.into_iter().rev().fold(symbol("[]"), |tail, head| fact(".", [head, tail]))
}

/// A space path of the segments' bytes, taken as given. `list` keeps arbitrary byte keys as atoms.
pub fn path<S: AsRef<[u8]>>(segments: impl IntoIterator<Item = S>) -> Value {
    list(segments.into_iter().map(|segment| Value::atom(segment.as_ref())))
}

/// The authorized(actor, statement, space) compound a query asks for.
pub fn authorization(actor: Value, statement: Value, space: Value) -> Value {
    fact("authorized", [actor, statement, space])
}

pub(crate) fn list_items(mut value: &Value) -> Result<Vec<&Value>, String> {
    let nil = symbol("[]");
    let cons = symbol(".");
    let mut result = Vec::new();
    while *value != nil {
        match value.as_tuple() {
            Some(tuple) if tuple.len() == 3 && tuple.items()[0] == cons => {
                result.push(&tuple.items()[1]);
                value = &tuple.items()[2];
            }
            _ => return Err("expected a proper Logos list".into()),
        }
    }
    Ok(result)
}

pub(crate) fn input_literal(value: &Value) -> Result<GroundLiteral, String> {
    if let Some(atom) = value.as_atom() {
        return Ok(GroundLiteral::new(Symbol::new(atom.bytes()), []));
    }
    let tuple = value.as_tuple().filter(|tuple| !tuple.is_empty()).ok_or("expected a labeled Logos compound")?;
    let head = tuple.items()[0].as_atom().ok_or("expected a labeled Logos compound")?;
    Ok(GroundLiteral::new(Symbol::new(head.bytes()), tuple.items()[1..].iter().cloned()))
}
