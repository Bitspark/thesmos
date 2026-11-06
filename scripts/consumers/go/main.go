// A consumer of the Go receiver, made by scripts/consumers/run.sh as a fresh module that requires
// github.com/Bitspark/thesmos/core/go at one commit: it verifies the TypeScript-signed Archon
// proof, and the same proof with one changed byte is denied.
package main

import (
	"fmt"
	"os"

	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"

	thesmos "github.com/Bitspark/thesmos/core/go"
	"github.com/Bitspark/thesmos/core/go/archon"
)

func main() {
	if len(os.Args) != 2 {
		fail(fmt.Errorf("usage: consumer <archon-document.ontos>"))
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fail(err)
	}
	value, err := codec.Decode(raw)
	if err != nil {
		fail(err)
	}
	vector := value.(core.Tuple)
	q := vector.At(1).(core.Tuple)
	query := thesmos.Query{Actor: q.At(0), Space: q.At(1), Statement: q.At(2)}
	proof := append([]byte(nil), vector.At(2).(core.Atom).Bytes()...)
	verifier, err := thesmos.NewVerifier(vector.At(0), archon.Authenticate)
	if err != nil {
		fail(err)
	}
	decision := verifier.Verify(query, proof)
	proof[len(proof)/2] ^= 1
	changed := verifier.Verify(query, proof)
	fmt.Printf("Go: %s after %d checked steps; with one byte changed, %s\n", decision.Code, decision.CheckedSteps, changed.Code)
	if !decision.Permitted || changed.Permitted {
		os.Exit(1)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "Go consumer:", err)
	os.Exit(1)
}
