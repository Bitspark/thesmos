// Package archon authenticates space_facts bundles with archon's Ed25519ph domain signatures.
//
// It is the Go counterpart of @bitspark/thesmos/archon. A supplier identity is its exact 32-byte
// archon public key. Authentication establishes key identity only; authority comes from the law.
package archon

import (
	"github.com/Bitspark/archon/core/go/crypto"
	core "github.com/bitspark/ontos/core/go"

	"github.com/Bitspark/thesmos/core/go"
)

// Domain is this adapter's protocol domain, not an authority or freshness rule.
const Domain = "thesmos/space-facts/v1"

// Authenticate verifies the bundle's signature by the supplier's key over its exact payload.
func Authenticate(bundle thesmos.Bundle, supplier core.Value) bool {
	key, keyOK := supplier.(core.Atom)
	signature, signatureOK := bundle.Authentication.(core.Atom)
	return keyOK && signatureOK && crypto.VerifyInDomain(key.Bytes(), Domain, bundle.Payload, signature.Bytes())
}
