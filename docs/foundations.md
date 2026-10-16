# Constellation contracts used here

Source inspection on 16 October 2026; these are code and contract observations,
not claims about a deployed service.

| Foundation | Inspected source | Consequence for thesmos |
| --- | --- | --- |
| deixis | [e0b0410](https://github.com/Bitspark/deixis/tree/e0b0410d6f76d795992cc0a5792c507a19ef05ee): core/ts, IDENTITY.md, PATH.md | A path is a sequence of exact byte keys. No slash splitting, text normalization, routing or implied permission. No runtime tree is needed for this SDK. |
| ontos | [9877e9d](https://github.com/Bitspark/ontos/tree/9877e9d57e04484d0a8b64c2d98ce807cfe4f4f4): core/ts, codec/ts, data/ts | Values are immutable Atom/ Tuple structures; equality is structural. Use the frozen codec directly. Numeric and text embeddings add representation, not authority meaning. |
| archon | [3d84816](https://github.com/Bitspark/archon/tree/3d848169b4c4d382dbd54d958b9ba9d0796376be): core/ts, sdk/ts, RELEASING.md | Signature verification establishes key identity and exact bytes. Use the native Ed25519ph domain API; permission still comes from the law. |

Space paths use the existing law's Logos cons-list representation. `path()`
is a convenience for UTF-8 byte segments; `list([new Atom(bytes), ...])` retains
arbitrary byte keys. There is no additional topology registry. The frozen
law accepts native Ontos path terms; this implementation does not narrow its
semantics to Deixis byte keys or replace its list form with a Deixis tree codec.
An application selecting Deixis keys can represent them directly as atoms.

The public family separates semantic floors, codecs, optional adapters and
language bindings. This repository follows that separation with one actual
TypeScript implementation, rather than placeholder packages for other languages.
Ontos 0.13.0 is pinned to match the selected Logos 0.23.0 dependency cohort;
the inspected Ontos main reports 0.14.0. Upgrading one side alone can produce
incompatible JavaScript class identities even when the value semantics agree.

Archon's signing-capability API also supports external custodians. This first
adapter supplies a small software-signing convenience and a pure verifier.
A custodian signs the exact encoded payload with the documented context; the
SDK does not acquire or store production keys. No OIDC subject is automatically
an Archon principal, and signing does not establish authority by itself.

The frozen law, templates and original conformance corpus were extracted from
the Spaces experiment at `541400eeda78940a7ee73ee80ef2e962840c4537`. Their
SHA-256 pins are [recorded separately](../conformance/frozen.json), and the
gate compares the source's Logos compilation with the preserved Ontos bytes.
Private legacy thesmos code, research, operational data and Git objects are
excluded from this repository.
