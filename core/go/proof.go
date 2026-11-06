package thesmos

import (
	"errors"
	"fmt"

	logos "github.com/Bitspark/logos/contract/go"
	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"
)

// Bundle is an authenticated space_facts output: untrusted evidence until authentication and the
// Logos authority proof pass.
type Bundle struct {
	Payload        []byte
	Authentication core.Value
}

// SpaceFacts is an asserter's live assertion at AssertedAt; the time has no built-in policy.
type SpaceFacts struct {
	Supplier   core.Value
	Space      core.Value
	AssertedAt core.Value
	// Clauses are native counts(author, space, head) :- body inputs; facts have empty bodies.
	Clauses []logos.Clause
}

type proof struct {
	law, layer core.Atom
	bundles    []Bundle
	derivation logos.Derivation
}

// limitError reports a protocol limit: the proof was not checked, which says nothing about
// whether the query is derivable.
type limitError struct{ message string }

func (e limitError) Error() string { return e.message }

type authenticationError struct{}

func (authenticationError) Error() string { return "space-facts output did not authenticate" }

var checkLimits = func() logos.CheckLimits {
	limits := logos.DefaultLimits()
	limits.MaxNodes = protocol.Limits.MaxProofSteps
	limits.MaxDepth = protocol.Limits.MaxProofDepth
	limits.MaxTermDepth = protocol.Limits.MaxTermDepth
	return limits
}()

func decodeLimits() codec.Limits {
	return codec.Limits{
		MaxDepth: protocol.Limits.MaxWireDepth, MaxAtomBytes: protocol.Limits.MaxProofBytes,
		MaxTupleArity: protocol.Limits.MaxProofSteps,
	}
}

func asLimit(err error) error {
	var decodeErr *codec.DecodeError
	if errors.As(err, &decodeErr) && decodeErr.Code == "limit_exceeded" {
		return limitError{err.Error()}
	}
	var wireErr *logos.BoundedWireError
	if errors.As(err, &wireErr) && (wireErr.Kind == logos.BoundedWireStopped || wireErr.Kind == logos.BoundedWireOverBudget) {
		return limitError{err.Error()}
	}
	return err
}

// The small Spaces envelope; clauses and derivations use Logos's standard formats.
func decodeProof(bytes []byte) (proof, error) {
	if len(bytes) > protocol.Limits.MaxProofBytes {
		return proof{}, limitError{"proof byte limit exceeded"}
	}
	value, err := codec.DecodeWithLimits(bytes, decodeLimits())
	if err != nil {
		return proof{}, asLimit(err)
	}
	envelope, ok := value.(core.Tuple)
	if !ok || envelope.Len() != 5 || !envelope.At(0).Equal(symbol(protocol.Format)) {
		return proof{}, fmt.Errorf("expected %s envelope", protocol.Format)
	}
	law, lawOK := envelope.At(1).(core.Atom)
	layer, layerOK := envelope.At(2).(core.Atom)
	bundles, bundlesOK := envelope.At(3).(core.Tuple)
	derivation, derivationOK := envelope.At(4).(core.Atom)
	if !lawOK || law.Len() != 32 || !layerOK || layer.Len() != 32 || !bundlesOK || !derivationOK {
		return proof{}, errors.New("invalid proof envelope")
	}
	outputs := make([]Bundle, 0, bundles.Len())
	for _, item := range bundles.Items() {
		bundle, ok := item.(core.Tuple)
		if !ok || bundle.Len() != 2 {
			return proof{}, errors.New("expected authenticated space_facts bundle")
		}
		payload, ok := bundle.At(0).(core.Atom)
		if !ok {
			return proof{}, errors.New("expected authenticated space_facts bundle")
		}
		outputs = append(outputs, Bundle{Payload: payload.Bytes(), Authentication: bundle.At(1)})
	}
	account, err := logos.DecodeDerivationWireV1Bounded(derivation.Bytes(), checkLimits)
	if err != nil {
		return proof{}, asLimit(err)
	}
	if len(account.ClosedWorld) > 0 {
		return proof{}, errors.New("this experiment supports positive derivations only")
	}
	for _, node := range account.Nodes {
		if rule, ok := node.(logos.RuleNode); ok {
			for _, premise := range rule.Premises {
				if _, ok := premise.(logos.PosPremise); !ok {
					return proof{}, errors.New("this experiment supports positive derivations only")
				}
			}
		}
	}
	return proof{law: law, layer: layer, bundles: outputs, derivation: account}, nil
}

// DecodeSpaceFacts decodes evidence without treating its contents as established judgments.
func DecodeSpaceFacts(bytes []byte) (SpaceFacts, error) {
	if len(bytes) > protocol.Limits.MaxProofBytes {
		return SpaceFacts{}, errors.New("invalid space_facts payload size")
	}
	value, err := codec.DecodeWithLimits(bytes, decodeLimits())
	if err != nil {
		return SpaceFacts{}, err
	}
	output, ok := value.(core.Tuple)
	if !ok || output.Len() != 5 || !output.At(0).Equal(symbol("space_facts")) {
		return SpaceFacts{}, errors.New("expected space_facts output")
	}
	clauses, ok := output.At(4).(core.Tuple)
	if !ok {
		return SpaceFacts{}, errors.New("expected native clause tuple")
	}
	if _, err := listItems(output.At(2)); err != nil {
		return SpaceFacts{}, err
	}
	facts := SpaceFacts{Supplier: output.At(1), Space: output.At(2), AssertedAt: output.At(3)}
	for _, item := range clauses.Items() {
		clause, ok := logos.ClauseFromValue(item)
		if !ok {
			return SpaceFacts{}, errors.New("expected a native Logos clause")
		}
		facts.Clauses = append(facts.Clauses, clause)
	}
	return facts, nil
}

// suppliedProgram builds the same guarded program as the producer. Authentication remains the
// receiver's job.
func suppliedProgram(bundles []Bundle, authenticate Authenticate) (*logos.MapProgram, error) {
	program := loadLaw()
	count := 0
	for bundleIndex, bundle := range bundles {
		output, err := DecodeSpaceFacts(bundle.Payload)
		if err != nil {
			return nil, err
		}
		if !authenticate(bundle, output.Supplier) {
			return nil, authenticationError{}
		}
		supplier, placement := logos.FromValue(output.Supplier), logos.FromValue(output.Space)
		for index, assertion := range output.Clauses {
			if count++; count > protocol.Limits.MaxProofSteps {
				return nil, limitError{"bundled clause limit exceeded"}
			}
			clause, err := suppliedClause(assertion, supplier, placement)
			if err != nil {
				return nil, err
			}
			program.Insert(logos.NewClauseId(fmt.Sprintf("bundle/%d/%d", bundleIndex, index)), clause)
		}
	}
	return program, nil
}
