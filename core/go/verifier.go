// Package thesmos verifies Spaces authority proofs under the frozen law, revision 3.
//
// It is the receiver: it checks a supplied proof for a query the receiver constructs, and runs
// no search, network or clock. The law and its layer are embedded data; Logos's checker decides.
// It is the Go counterpart of the @bitspark/thesmos root entry and accepts the same proofs.
package thesmos

import (
	"errors"
	"fmt"

	logos "github.com/Bitspark/logos-contract/contract/go"
	core "github.com/bitspark/ontos/core/go"
)

// Query is what the receiver asks: may actor assert statement in space? All three are native
// Ontos values; space is a Logos path list (see Path).
type Query struct {
	Actor     core.Value
	Space     core.Value
	Statement core.Value
}

// Authenticate reports whether supplier authenticated exactly bundle.Payload with
// bundle.Authentication. It establishes key identity only, never authority.
type Authenticate func(bundle Bundle, supplier core.Value) bool

// Decision is the verifier's result. Code is one of the protocol's result codes; Detail is
// diagnostic only.
type Decision struct {
	Permitted    bool
	Code         string
	Detail       string
	CheckedSteps int
}

// Verifier checks supplied proofs under one configured root.
type Verifier struct {
	authenticate Authenticate
	profile      *logos.CheckProfile[struct{}]
}

type rootLeaves struct{ anchor logos.GroundLiteral }

func (rootLeaves) Extensional() *logos.PredicateSet { return logos.PredicateSetOf("root") }

func (l rootLeaves) Verify(claim logos.GroundLiteral, _ logos.Evidence, _ struct{}) logos.LeafOutcome {
	if claim.Equal(l.anchor) {
		return logos.LeafAdmit{}
	}
	return logos.LeafReject{Code: "unaccepted_premise"}
}

// NewVerifier verifies the supplied evidence and finite proof under root. It has no temporal
// policy and runs no search.
func NewVerifier(root core.Value, authenticate Authenticate) (*Verifier, error) {
	if authenticate == nil {
		return nil, errors.New("thesmos: an authentication adapter is required")
	}
	if root == nil {
		return nil, errors.New("thesmos: a root is required")
	}
	anchor, err := inputLiteral(Fact("root", root))
	if err != nil {
		return nil, err
	}
	return &Verifier{authenticate: authenticate, profile: &logos.CheckProfile[struct{}]{
		Theory: logos.NewTermTheory(),
		Leaves: rootLeaves{anchor},
		Admit:  logos.AlwaysAdmit[struct{}]{},
		Limits: checkLimits,
	}}, nil
}

// Verify checks proof, Ontos-encoded bytes, for exactly query. Any failure denies, including a
// panic in the authentication adapter.
func (v *Verifier) Verify(query Query, proofBytes []byte) (decision Decision) {
	reject := func(code, detail string) Decision { return Decision{Code: code, Detail: detail} }
	defer func() {
		if recovered := recover(); recovered != nil {
			decision = reject(protocol.Results.Invalid, fmt.Sprint("verification failed: ", recovered))
		}
	}()
	if query.Actor == nil || query.Space == nil || query.Statement == nil {
		return reject(protocol.Results.Invalid, "query needs an actor, space and statement")
	}
	fail := func(err error) Decision {
		var limit limitError
		var authentication authenticationError
		switch {
		case errors.As(err, &authentication):
			return reject(protocol.Results.Authentication, err.Error())
		case errors.As(err, &limit):
			return reject(protocol.Results.Limit, err.Error())
		}
		return reject(protocol.Results.Invalid, err.Error())
	}
	p, err := decodeProof(proofBytes)
	if err != nil {
		return fail(err)
	}
	if !p.law.Equal(lawDigest) {
		return reject(protocol.Results.LawMismatch, "proof names another law")
	}
	if !p.layer.Equal(layerDigest) {
		return reject(protocol.Results.LayerMismatch, "proof names another input layer")
	}
	program, err := suppliedProgram(p.bundles, v.authenticate)
	if err != nil {
		return fail(err)
	}
	claim, err := inputLiteral(Authorization(query.Actor, query.Statement, query.Space))
	if err != nil {
		return fail(err)
	}
	outcome := logos.Check(program, claim, p.derivation, struct{}{}, v.profile)
	if !outcome.IsAccept() {
		code := outcome.Code().Code()
		result := protocol.Results.Rejected
		if code == "too_many_nodes" || code == "too_deep" || code == "term_too_deep" {
			result = protocol.Results.Limit
		}
		return reject(result, code+": "+outcome.Detail())
	}
	return Decision{Permitted: true, Code: protocol.Results.Permitted, CheckedSteps: len(p.derivation.Nodes)}
}
