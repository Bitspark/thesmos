package thesmos

import (
	"errors"

	logos "github.com/Bitspark/logos/contract/go"
)

func bindings(names []string, terms ...logos.Term) logos.Subst {
	subst := logos.Subst{}
	for i, name := range names {
		subst[logos.NewVarId(name)] = terms[i]
	}
	return subst
}

func instantiate(template logos.Clause, body []logos.BodyLit, subst logos.Subst) logos.Clause {
	lits := append([]logos.BodyLit(nil), body...)
	for _, premise := range template.Body {
		lits = append(lits, premise.Substitute(subst))
	}
	return logos.Clause{Head: template.Head.Substitute(subst), Body: lits}
}

// executableClause specializes rule 5 for an attributed clause, preserving its native variables.
func executableClause(assertion logos.Clause) (logos.Clause, error) {
	if string(assertion.Head.Pred.Bytes()) != "counts" || len(assertion.Head.Args) != 3 {
		return logos.Clause{}, errors.New("expected an attributed counts/3 clause")
	}
	author, space, head := assertion.Head.Args[0], assertion.Head.Args[1], assertion.Head.Args[2]
	_, groundAuthor := author.EraseGround()
	placement, groundSpace := space.EraseGround()
	if !groundAuthor || !groundSpace {
		return logos.Clause{}, errors.New("author and space must be ground")
	}
	if _, err := listItems(placement); err != nil {
		return logos.Clause{}, err
	}
	for _, premise := range assertion.Body {
		name := string(premise.Lit.Pred.Bytes())
		if !premise.IsPos() || len(premise.Lit.Args) != 3 || (name != "authorized" && name != "counts") {
			return logos.Clause{}, errors.New("authored bodies must use positive authorized/3 or counts/3 premises")
		}
	}
	// Native substitution is one pass: variables inside the authored head keep their identity,
	// even when named A, S or H like the law's placeholders.
	return instantiate(assertionTemplate, assertion.Body, bindings([]string{"A", "S", "H"}, author, space, head)), nil
}

// suppliedClause translates only a clause from an authenticated output at its exact placement.
func suppliedClause(assertion logos.Clause, supplier, placement logos.Term) (logos.Clause, error) {
	if _, err := executableClause(assertion); err != nil { // the core's syntax and positive-body checks
		return logos.Clause{}, err
	}
	author, space, head := assertion.Head.Args[0], assertion.Head.Args[1], assertion.Head.Args[2]
	if !space.Equal(placement) {
		return logos.Clause{}, errors.New("clause placement differs from its bundle space")
	}
	return instantiate(spaceAsserterTemplate, assertion.Body, bindings([]string{"A", "P", "H", "S"}, author, space, head, supplier)), nil
}
