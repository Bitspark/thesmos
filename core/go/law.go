package thesmos

import (
	_ "embed"
	"encoding/json"

	logos "github.com/Bitspark/logos/contract/go"
	codec "github.com/bitspark/ontos/codec/go"
	core "github.com/bitspark/ontos/core/go"
)

// The frozen law, as a byte copy of law/ made by scripts/embed-law.mjs --go. Go's embed cannot
// reach outside this module, so the copy is committed; `npm run law:check` fails if it differs
// from law/, which conformance/frozen.json pins.
var (
	//go:embed law/common-law.ontos
	commonLawBytes []byte
	//go:embed law/assertion-template.ontos
	assertionTemplateBytes []byte
	//go:embed law/space-asserter-template.ontos
	spaceAsserterTemplateBytes []byte
	//go:embed law/protocol.json
	protocolBytes []byte
)

type protocolData struct {
	Format string `json:"format"`
	Limits struct {
		MaxProofBytes int `json:"maxProofBytes"`
		MaxWireDepth  int `json:"maxWireDepth"`
		MaxProofSteps int `json:"maxProofSteps"`
		MaxProofDepth int `json:"maxProofDepth"`
		MaxTermDepth  int `json:"maxTermDepth"`
	} `json:"limits"`
	Results struct {
		Permitted      string `json:"permitted"`
		Invalid        string `json:"invalid"`
		LawMismatch    string `json:"lawMismatch"`
		LayerMismatch  string `json:"layerMismatch"`
		Authentication string `json:"authentication"`
		Limit          string `json:"limit"`
		Rejected       string `json:"rejected"`
	} `json:"results"`
}

var protocol = func() protocolData {
	var p protocolData
	if err := json.Unmarshal(protocolBytes, &p); err != nil {
		panic("thesmos: embedded protocol.json: " + err.Error())
	}
	return p
}()

func loadProgram(bytes []byte) *logos.MapProgram {
	value, err := codec.Decode(bytes)
	if err != nil {
		panic("thesmos: embedded law: " + err.Error())
	}
	program, err := logos.ProgramFromValue(value)
	if err != nil {
		panic("thesmos: embedded law: " + err.Error())
	}
	return program
}

func loadLaw() *logos.MapProgram { return loadProgram(commonLawBytes) }

func templateClause(bytes []byte, id string) logos.Clause {
	clause, ok := loadProgram(bytes).Clause(logos.NewClauseId(id))
	if !ok {
		panic("thesmos: embedded law has no clause " + id)
	}
	return clause
}

var (
	assertionTemplate     = templateClause(assertionTemplateBytes, "assertion-template")
	spaceAsserterTemplate = templateClause(spaceAsserterTemplateBytes, "supplied-assertion-template")
)

// LawDigest binds the executable law and assertion construction to one native program digest.
func LawDigest() core.Atom { return lawDigest }

// LayerDigest is the space-asserter layer's own identity; the frozen core's identity is unchanged.
func LayerDigest() core.Atom { return layerDigest }

var lawDigest = func() core.Atom {
	var clauses []logos.Clause
	for _, entry := range loadLaw().Iter() {
		clauses = append(clauses, entry.Clause)
	}
	digest := logos.ProgramDigest(append(clauses, assertionTemplate))
	return core.NewAtom(digest[:])
}()

var layerDigest = func() core.Atom {
	digest := logos.ProgramDigest([]logos.Clause{spaceAsserterTemplate})
	return core.NewAtom(digest[:])
}()
