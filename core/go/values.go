package thesmos

import (
	"errors"
	"unicode/utf8"

	logos "github.com/Bitspark/logos-contract/contract/go"
	core "github.com/bitspark/ontos/core/go"
)

// Symbol is a Logos symbol, not a text embedding: the atom of the name's UTF-8 bytes.
func Symbol(name string) (core.Atom, error) {
	if !utf8.ValidString(name) {
		return core.Atom{}, errors.New("thesmos: symbol must be valid Unicode")
	}
	return core.NewAtom([]byte(name)), nil
}

func symbol(name string) core.Atom { return core.NewAtom([]byte(name)) }

// Fact is a labeled Logos compound: the tuple (name, args...). Names are taken as given; use
// Symbol to check that an untrusted name is valid Unicode.
func Fact(name string, args ...core.Value) core.Value {
	return core.NewTuple(append([]core.Value{symbol(name)}, args...)...)
}

// List is Logos's [Head|Tail] notation, distinct from ontos-data's flat list embedding.
func List(items ...core.Value) core.Value {
	var out core.Value = symbol("[]")
	for i := len(items) - 1; i >= 0; i-- {
		out = Fact(".", items[i], out)
	}
	return out
}

// Path is a space path of the segments' bytes, taken as given. List keeps arbitrary byte keys
// as atoms.
func Path(segments ...string) core.Value {
	items := make([]core.Value, len(segments))
	for i, segment := range segments {
		items[i] = symbol(segment)
	}
	return List(items...)
}

// Authorization is the authorized(actor, statement, space) compound a query asks for.
func Authorization(actor, statement, space core.Value) core.Value {
	return Fact("authorized", actor, statement, space)
}

func listItems(value core.Value) ([]core.Value, error) {
	var result []core.Value
	for !value.Equal(symbol("[]")) {
		tuple, ok := value.(core.Tuple)
		if !ok || tuple.Len() != 3 || !tuple.At(0).Equal(symbol(".")) {
			return nil, errors.New("expected a proper Logos list")
		}
		result = append(result, tuple.At(1))
		value = tuple.At(2)
	}
	return result, nil
}

func inputLiteral(value core.Value) (logos.GroundLiteral, error) {
	if atom, ok := value.(core.Atom); ok {
		return logos.GroundLiteral{Pred: logos.NewSymbol(atom.Bytes())}, nil
	}
	tuple, ok := value.(core.Tuple)
	if !ok || tuple.Len() == 0 {
		return logos.GroundLiteral{}, errors.New("expected a labeled Logos compound")
	}
	head, ok := tuple.At(0).(core.Atom)
	if !ok {
		return logos.GroundLiteral{}, errors.New("expected a labeled Logos compound")
	}
	return logos.GroundLiteral{Pred: logos.NewSymbol(head.Bytes()), Args: tuple.Items()[1:]}, nil
}
