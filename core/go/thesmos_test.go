package thesmos

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"testing"

	logos "github.com/Bitspark/logos/contract/go"
	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"
	data "github.com/bitspark/ontos/data/go"
)

// The public demo keys of the frozen corpus (law/conformance.ontos), reproducible from the
// identity. They are not credentials. Applications supply their own authentication adapter.
func exampleKey(identity core.Value) ed25519.PrivateKey {
	seed := sha256.Sum256(append([]byte("Spaces public example key\x00"), codec.Encode(identity)...))
	return ed25519.NewKeyFromSeed(seed[:])
}

func authenticateExample(bundle Bundle, supplier core.Value) bool {
	signature, ok := bundle.Authentication.(core.Atom)
	return ok && ed25519.Verify(exampleKey(supplier).Public().(ed25519.PublicKey), bundle.Payload, signature.Bytes())
}

type corpusCase struct {
	name, why string
	root      core.Value
	query     Query
	proof     []byte
	permitted bool
}

func readCorpus(t *testing.T) []corpusCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/conformance.ontos")
	if err != nil {
		t.Fatal(err)
	}
	value, err := codec.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	file, ok := value.(core.Tuple)
	if !ok || file.Len() != 3 || !file.At(0).Equal(symbol("spaces/conformance/2")) || !file.At(1).Equal(LawDigest()) {
		t.Fatal("wrong conformance format or law")
	}
	var cases []corpusCase
	for _, entry := range file.At(2).(core.Tuple).Items() {
		fields := entry.(core.Tuple)
		name, err1 := data.ReadText(fields.At(0))
		why, err2 := data.ReadText(fields.At(1))
		permitted, err3 := data.ReadBool(fields.At(5))
		q, qOK := fields.At(3).(core.Tuple)
		proof, proofOK := fields.At(4).(core.Atom)
		if err := errors.Join(err1, err2, err3); err != nil || !qOK || q.Len() != 3 || !proofOK {
			t.Fatalf("invalid case: %v", err)
		}
		cases = append(cases, corpusCase{name, why, fields.At(2), Query{q.At(0), q.At(1), q.At(2)}, proof.Bytes(), permitted})
	}
	return cases
}

func TestDigestsEqualTheTypeScriptIdentities(t *testing.T) {
	for _, pin := range []struct {
		name string
		got  core.Atom
		want string
	}{
		{"law", LawDigest(), "80f91df84e8597daf04bebc8643bc8884086829b0d06795d1e0ee97be379fe7d"},
		{"layer", LayerDigest(), "84dfbd82bcb650b31a4e5f44f3b91b303fcb516166c12f7f9bba11cbfbe07cb0"},
	} {
		if got := hex.EncodeToString(pin.got.Bytes()); got != pin.want {
			t.Errorf("%s digest %s, want %s", pin.name, got, pin.want)
		}
	}
}

func TestEmbeddedLawIsTheFrozenLaw(t *testing.T) {
	for embedded, source := range map[*[]byte]string{
		&commonLawBytes: "common-law.ontos", &assertionTemplateBytes: "assertion-template.ontos",
		&spaceAsserterTemplateBytes: "layers/space-asserter-template.ontos", &protocolBytes: "protocol.json",
	} {
		frozen, err := os.ReadFile("../../law/" + source)
		if errors.Is(err, os.ErrNotExist) {
			t.Skip("law/ is outside this module; the repository gate compares the copy")
		}
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(*embedded, frozen) {
			t.Errorf("embedded %s differs from law/%s", source, source)
		}
	}
}

func TestFrozenConformanceCorpus(t *testing.T) {
	cases := readCorpus(t)
	if len(cases) == 0 {
		t.Fatal("empty corpus")
	}
	for _, c := range cases {
		verifier, err := NewVerifier(c.root, authenticateExample)
		if err != nil {
			t.Fatal(err)
		}
		if got := verifier.Verify(c.query, c.proof); got.Permitted != c.permitted {
			t.Errorf("%s (%s): permitted %v, want %v: %+v", c.name, c.why, got.Permitted, c.permitted, got)
		}
	}
}

func permittedCase(t *testing.T) (corpusCase, *Verifier) {
	t.Helper()
	for _, c := range readCorpus(t) {
		if c.permitted {
			verifier, _ := NewVerifier(c.root, authenticateExample)
			return c, verifier
		}
	}
	t.Fatal("corpus has no permitted case")
	return corpusCase{}, nil
}

func TestMalformedBytesDoNotEstablishPermission(t *testing.T) {
	c, verifier := permittedCase(t)
	for _, bad := range [][]byte{{}, []byte("{}"), c.proof[:len(c.proof)-1], append(append([]byte(nil), c.proof...), 0)} {
		if got := verifier.Verify(c.query, bad); got.Code != protocol.Results.Invalid {
			t.Errorf("malformed proof: %+v", got)
		}
	}
}

func TestLimitsRefuseWithoutClaimingNonDerivability(t *testing.T) {
	c, verifier := permittedCase(t)
	if got := verifier.Verify(c.query, make([]byte, protocol.Limits.MaxProofBytes+1)); got.Code != protocol.Results.Limit {
		t.Errorf("oversized proof: %+v", got)
	}
	var nested core.Value = symbol("x")
	for i := 0; i < protocol.Limits.MaxWireDepth+2; i++ {
		nested = core.NewTuple(nested)
	}
	if got := verifier.Verify(c.query, codec.Encode(nested)); got.Code != protocol.Results.Limit {
		t.Errorf("deep wire value: %+v", got)
	}
}

func TestAnotherQueryRootOrAuthenticationDenies(t *testing.T) {
	c, verifier := permittedCase(t)
	if got := verifier.Verify(c.query, c.proof); !got.Permitted || got.Code != protocol.Results.Permitted {
		t.Fatalf("baseline: %+v", got)
	}
	other := c.query
	other.Statement = Fact("another_statement")
	if got := verifier.Verify(other, c.proof); got.Permitted || got.Code != protocol.Results.Rejected {
		t.Errorf("another statement: %+v", got)
	}
	elsewhere, _ := NewVerifier(symbol("another_root"), authenticateExample)
	if got := elsewhere.Verify(c.query, c.proof); got.Permitted || got.Code != protocol.Results.Rejected {
		t.Errorf("another root: %+v", got)
	}
	refuse, _ := NewVerifier(c.root, func(Bundle, core.Value) bool { return false })
	if got := refuse.Verify(c.query, c.proof); got.Permitted || got.Code != protocol.Results.Authentication {
		t.Errorf("failed authentication: %+v", got)
	}
	if _, err := NewVerifier(c.root, nil); err == nil {
		t.Error("a verifier without authentication was constructed")
	}
	if _, err := NewVerifier(nil, authenticateExample); err == nil {
		t.Error("a verifier without a root was constructed")
	}
	if got := verifier.Verify(Query{Actor: c.query.Actor}, c.proof); got.Permitted || got.Code != protocol.Results.Invalid {
		t.Errorf("incomplete query: %+v", got)
	}
	panics, _ := NewVerifier(c.root, func(Bundle, core.Value) bool { panic("adapter failure") })
	if got := panics.Verify(c.query, c.proof); got.Permitted || got.Code != protocol.Results.Invalid {
		t.Errorf("panicking adapter: %+v", got)
	}
}

// envelope rebuilds a proof with edit applied to its decoded parts: law, layer, bundles, derivation.
func envelope(t *testing.T, proofBytes []byte, edit func(p *proof)) []byte {
	t.Helper()
	p, err := decodeProof(proofBytes)
	if err != nil {
		t.Fatal(err)
	}
	edit(&p)
	bundles := make([]core.Value, len(p.bundles))
	for i, b := range p.bundles {
		bundles[i] = core.NewTuple(core.NewAtom(b.Payload), b.Authentication)
	}
	return codec.Encode(core.NewTuple(symbol(protocol.Format), p.law, p.layer, core.NewTuple(bundles...),
		core.NewAtom(logos.EncodeDerivationWireV1(p.derivation))))
}

// resign encodes facts and signs them with the corpus's example key for their supplier.
func resign(facts SpaceFacts) Bundle {
	clauses := make([]core.Value, len(facts.Clauses))
	for i, clause := range facts.Clauses {
		clauses[i] = logos.ClauseValue(clause)
	}
	payload := codec.Encode(core.NewTuple(symbol("space_facts"), facts.Supplier, facts.Space, facts.AssertedAt, core.NewTuple(clauses...)))
	return Bundle{Payload: payload, Authentication: core.NewAtom(ed25519.Sign(exampleKey(facts.Supplier), payload))}
}

func TestEachResultCodeIsReachable(t *testing.T) {
	c, verifier := permittedCase(t)
	if got := verifier.Verify(c.query, envelope(t, c.proof, func(p *proof) {})); !got.Permitted {
		t.Fatalf("re-encoded baseline: %+v", got)
	}
	other := core.NewAtom(make([]byte, 32))
	for _, check := range []struct {
		name string
		edit func(p *proof)
		code string
	}{
		{"another law", func(p *proof) { p.law = other }, protocol.Results.LawMismatch},
		{"another layer", func(p *proof) { p.layer = other }, protocol.Results.LayerMismatch},
		{"changed signature", func(p *proof) {
			signature := p.bundles[0].Authentication.(core.Atom).Bytes()
			signature[0] ^= 1
			p.bundles[0].Authentication = core.NewAtom(signature)
		}, protocol.Results.Authentication},
		{"changed payload", func(p *proof) {
			facts, _ := DecodeSpaceFacts(p.bundles[0].Payload)
			facts.AssertedAt = symbol("another time")
			p.bundles[0].Payload = resign(facts).Payload
		}, protocol.Results.Authentication},
		{"too many bundled clauses", func(p *proof) {
			// One bundle over the limit is refused while decoding it (invalid-proof, as in
			// TypeScript); two bundles within it exceed it together.
			facts, _ := DecodeSpaceFacts(p.bundles[0].Payload)
			for len(facts.Clauses) <= protocol.Limits.MaxProofSteps/2 {
				facts.Clauses = append(facts.Clauses, facts.Clauses[0])
			}
			p.bundles = append(p.bundles, resign(facts), resign(facts))
		}, protocol.Results.Limit},
		{"too many nodes", func(p *proof) {
			for len(p.derivation.Nodes) <= protocol.Limits.MaxProofSteps {
				p.derivation.Nodes = append(p.derivation.Nodes, p.derivation.Nodes[0])
			}
		}, protocol.Results.Limit},
	} {
		if got := verifier.Verify(c.query, envelope(t, c.proof, check.edit)); got.Permitted || got.Code != check.code {
			t.Errorf("%s: %+v, want %s", check.name, got, check.code)
		}
	}
}
