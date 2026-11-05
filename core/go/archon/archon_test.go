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
	if archon.Authenticate(thesmos.Bundle{Payload: []byte("x"), Authentication: core.NewTuple()}, core.NewAtom(make([]byte, 32))) {
		t.Error("a non-atom signature authenticated")
	}
}
