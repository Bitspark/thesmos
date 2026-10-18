# Frozen Spaces authority model

Revision 3, 15 October 2026. This implementation preserves the frozen model:

`LAW + FACTS + OP + Id → {allowed, forbidden}`

LAW contains the fixed common law and configured trust root. FACTS is the
applicable set of attributed clauses. Id is established by the receiving
service's authentication. OP is that service's exact statement and space.
Authority is a finite positive derivation, rooted in that configured trust.

The five authority rules are:

1. The root has every authority.
2. Authority for a statement in a space extends to its descendants.
3. Holding a right and being entitled to confer that right are equivalent.
4. A counting grant confers its underlying right, within the grant's placement.
5. An attributed clause counts when its body holds and its author is authorized
   for that instantiated conclusion. An ordinary fact has an empty body.

These are encoded in [the law](../law/common-law.logos) and
[assertion template](../law/assertion-template.logos). Structural helpers in
the executable form implement paths and nested-grant notation; they add no
authority axiom. Delegation preserves the issuer's authority. An authorized
ancestor can supply a descendant directly. Unsupported circular grants do
not establish a finite rooted proof.

## The separate space-asserter layer

An authenticated supplier supplies `space_facts(supplier, space, assertedAt,
clauses)`. Each clause preserves its author, placement, head and body. The
same law establishes `authorized(supplier, supply_facts, space)`; the layer
adds this guard to each supplied clause alongside its author-authority guard.
The construction is data in [the layer template](../law/layers/space-asserter-template.logos).

`supply_facts` is an ordinary authority statement. `space_facts` is an evidence
envelope, not another authority rule. An asserter is trusted to supply valid
attribution and state when its facts were asserted live. Its internal
acceptance, sequencing and retrieval mechanisms are outside this model.

The timestamp is authenticated evidence. It imposes no expiry, maximum age,
latest-state selection or revocation semantics. Temporal applicability can
be supplied by a separately selected policy or projection. This SDK does not
claim that an offline bundle represents current access.

## Checking a proof

The receiver fixes the root and constructs the query from the authenticated
actor and actual operation. The caller supplies authenticated bundles and a
Logos derivation. The SDK checks the law/layer identities, authenticates exact
bundle bytes, reconstructs guarded clauses and asks the Logos checker to
verify that exact query. It runs no search and makes no network or clock call.

The client entry point uses Logos search to produce the derivation. Its
clause-reference translation only maps Logos content identifiers to the
existing law and bundle identifiers; it does not ground rules or derive rights.
Authored variables and their bindings remain Logos's responsibility.

A rejected proof denies this request's evidence. It does not prove that no
valid derivation exists. The positive body subset implemented here is
`authorized/3` and `counts/3`; support for other pure relations is a separate
implementation choice, not a missing core authority rule.

Resource bounds and the `spaces/proof/6` envelope belong to this implementation,
in [protocol data](../law/protocol.json). They are not authority axioms.
