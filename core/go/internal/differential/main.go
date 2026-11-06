// Command differential is the Go decider of the cross-language differential test
// (scripts/differential): it reads cases.ontos on stdin and writes one JSON decision per line. It
// is a development tool, not part of the module's API.
package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"

	thesmos "github.com/Bitspark/thesmos/core/go"
	"github.com/Bitspark/thesmos/core/go/archon"
)

func exampleKey(identity core.Value) ed25519.PublicKey {
	seed := sha256.Sum256(append([]byte("Spaces public example key\x00"), codec.Encode(identity)...))
	return ed25519.NewKeyFromSeed(seed[:]).Public().(ed25519.PublicKey)
}

var authenticators = map[string]thesmos.Authenticate{
	"example": func(bundle thesmos.Bundle, supplier core.Value) bool {
		signature, ok := bundle.Authentication.(core.Atom)
		return ok && ed25519.Verify(exampleKey(supplier), bundle.Payload, signature.Bytes())
	},
	"archon": archon.Authenticate,
	"accept": func(thesmos.Bundle, core.Value) bool { return true },
}

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		panic(err)
	}
	limits := codec.DefaultLimits()
	limits.MaxDepth = 4096
	value, err := codec.DecodeWithLimits(input, limits)
	if err != nil {
		panic(err)
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, entry := range value.(core.Tuple).At(2).(core.Tuple).Items() {
		fields := entry.(core.Tuple)
		q := fields.At(1).(core.Tuple)
		authenticate := authenticators[string(fields.At(3).(core.Atom).Bytes())]
		verifier, err := thesmos.NewVerifier(fields.At(0), authenticate)
		if err != nil {
			panic(err)
		}
		d := verifier.Verify(thesmos.Query{Actor: q.At(0), Space: q.At(1), Statement: q.At(2)}, fields.At(2).(core.Atom).Bytes())
		steps := 0
		if d.Permitted {
			steps = d.CheckedSteps
		}
		line, _ := json.Marshal(struct {
			I         int    `json:"i"`
			Permitted bool   `json:"permitted"`
			Code      string `json:"code"`
			Steps     int    `json:"steps"`
			Panicked  bool   `json:"panicked"`
		}{i, d.Permitted, d.Code, steps, strings.HasPrefix(d.Detail, "verification failed: ")})
		fmt.Fprintln(out, string(line))
	}
}
