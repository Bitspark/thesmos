package archon_test

import (
	"os"
	"testing"

	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"

	"github.com/Bitspark/thesmos/core/go"
	"github.com/Bitspark/thesmos/core/go/archon"
)

// testdata/archon-document.ontos is the TypeScript SDK's Archon-signed document example, written
// by scripts/export-archon-vector.mjs; the TypeScript suite checks the same bytes.
func TestTypeScriptArchonProofVerifies(t *testing.T) {
	raw, err := os.ReadFile("../testdata/archon-document.ontos")
	if err != nil {
		t.Fatal(err)
	}
	value, err := codec.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	vector := value.(core.Tuple)
	q := vector.At(1).(core.Tuple)
	query, proof := thesmos.Query{Actor: q.At(0), Space: q.At(1), Statement: q.At(2)}, vector.At(2).(core.Atom).Bytes()
	verifier, err := thesmos.NewVerifier(vector.At(0), archon.Authenticate)
	if err != nil {
		t.Fatal(err)
	}
	if got := verifier.Verify(query, proof); !got.Permitted {
		t.Fatalf("TypeScript Archon proof: %+v", got)
	}
	// Any changed byte breaks either the envelope, a signature or the proof.
	for _, offset := range []int{len(proof) / 3, len(proof) / 2, len(proof) - 40} {
		changed := append([]byte(nil), proof...)
		changed[offset] ^= 1
		if got := verifier.Verify(query, changed); got.Permitted {
			t.Errorf("byte %d changed, still permitted", offset)
		}
	}
	// The adapter itself: the vector's first bundle authenticates only exactly as signed.
	envelope, err := codec.Decode(proof)
	if err != nil {
		t.Fatal(err)
	}
	first := envelope.(core.Tuple).At(3).(core.Tuple).At(0).(core.Tuple)
	payload, signature := first.At(0).(core.Atom).Bytes(), first.At(1).(core.Atom).Bytes()
	facts, err := thesmos.DecodeSpaceFacts(payload)
	if err != nil {
		t.Fatal(err)
	}
	bundle := thesmos.Bundle{Payload: payload, Authentication: core.NewAtom(signature)}
	if !archon.Authenticate(bundle, facts.Supplier) {
		t.Fatal("the TypeScript-signed bundle does not authenticate")
	}
	flip := func(b []byte, i int) []byte {
		c := append([]byte(nil), b...)
		c[i] ^= 1
		return c
	}
	key := facts.Supplier.(core.Atom).Bytes()
	for name, check := range map[string]struct {
		bundle   thesmos.Bundle
		supplier core.Value
	}{
		"changed payload":    {thesmos.Bundle{Payload: flip(payload, len(payload)/2), Authentication: bundle.Authentication}, facts.Supplier},
		"changed signature":  {thesmos.Bundle{Payload: payload, Authentication: core.NewAtom(flip(signature, 0))}, facts.Supplier},
		"another key":        {bundle, core.NewAtom(flip(key, 0))},
		"short key":          {bundle, core.NewAtom(key[:31])},
		"non-atom signature": {thesmos.Bundle{Payload: payload, Authentication: core.NewTuple()}, facts.Supplier},
		"non-atom supplier":  {bundle, core.NewTuple(facts.Supplier)},
	} {
		if archon.Authenticate(check.bundle, check.supplier) {
			t.Errorf("%s authenticated", name)
		}
	}
}
