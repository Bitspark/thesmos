use logos_contract::{BodyLit, Clause, Subst, Term, VarId};
use ontos_core::Value;

use crate::law::{ASSERTION, SPACE_ASSERTER};
use crate::values::list_items;

fn bindings(pairs: &[(&str, &Term)]) -> Subst {
    pairs.iter().map(|(name, term)| (VarId::new(*name), (*term).clone())).collect()
}

fn instantiate(template: &Clause, body: &[BodyLit<Term>], subst: &Subst) -> Clause {
    let mut lits = body.to_vec();
    lits.extend(template.body.iter().map(|premise| premise.substitute(subst)));
    Clause { head: template.head.substitute(subst), body: lits }
}

/// Specializes rule 5 for an attributed clause, preserving its native variables.
pub(crate) fn executable_clause(assertion: &Clause) -> Result<Clause, String> {
    let head = &assertion.head;
    if head.pred.bytes() != b"counts" || head.args.len() != 3 {
        return Err("expected an attributed counts/3 clause".into());
    }
    let (author, space, conclusion) = (&head.args[0], &head.args[1], &head.args[2]);
    let (Some(_), Some(placement)) = (author.erase_ground(), space.erase_ground()) else {
        return Err("author and space must be ground".into());
    };
    list_items(&placement)?;
    for premise in &assertion.body {
        let positive = premise.as_inner().filter(|_| premise.is_pos());
        let valid = positive.is_some_and(|lit| {
            lit.args.len() == 3 && (lit.pred.bytes() == b"authorized" || lit.pred.bytes() == b"counts")
        });
        if !valid {
            return Err("authored bodies must use positive authorized/3 or counts/3 premises".into());
        }
    }
    // Native substitution is one pass: variables inside the authored head keep their identity,
    // even when named A, S or H like the law's placeholders.
    let subst = bindings(&[("A", author), ("S", space), ("H", conclusion)]);
    Ok(instantiate(&ASSERTION, &assertion.body, &subst))
}

/// Translates only a clause from an authenticated output at its exact placement.
pub(crate) fn supplied_clause(assertion: &Clause, supplier: &Term, placement: &Value) -> Result<Clause, String> {
    executable_clause(assertion)?; // the core's syntax and positive-body checks
    let (author, space, conclusion) = (&assertion.head.args[0], &assertion.head.args[1], &assertion.head.args[2]);
    if space.erase_ground().as_ref() != Some(placement) {
        return Err("clause placement differs from its bundle space".into());
    }
    let subst = bindings(&[("A", author), ("P", space), ("H", conclusion), ("S", supplier)]);
    Ok(instantiate(&SPACE_ASSERTER, &assertion.body, &subst))
}
