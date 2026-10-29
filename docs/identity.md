# Issuer-qualified principals

The law accepts native Values as actors and authors. A personal signing key is
not required. The optional `/identity` profile gives cooperating services one
encoding for a previously authenticated issuer/subject pair:

```ts
import { issuerSubjectPrincipal, decodeIssuerSubjectPrincipal } from "@bitspark/thesmos/identity";

const actor = issuerSubjectPrincipal(validatedIssuer, validatedSubject);
const { issuer, subject } = decodeIssuerSubjectPrincipal(actor);
```

The exact native Value is the three-element tuple
`(symbol("thesmos/issuer-subject/1"), text(issuer), text(subject))`.
`text` is Ontos's canonical text embedding. Both inputs must be nonempty
well-formed Unicode. There is no case, URL, slash or Unicode normalization.
The decoder accepts only this exact shape and canonical text. Equal subjects
at different issuers are distinct principals. Key-valued principals remain
distinct; this helper neither aliases them nor transfers existing grants.

Construction and decoding establish no authentication. A receiver obtains the
pair from its validated session or credential under an explicit authentication
profile, then constructs the actor for its actual operation. An arbitrary
principal supplied in a request or proof does not establish that actor.
Forwarding a person's identity also requires the receiver's selected authenticated
forwarding profile; this helper supplies none.

An issuer must keep subject assignments stable and never reassign a subject.
Continuity requires preserving that identity namespace and its assignments.
Recreating a database under the same issuer string does not prove continuity.
Credential changes, account standing and recovery generations belong to the
selected service profile; they are not additional identity fields or law rules.

## Attributed records

An authorized asserter can supply a clause attributed to an account principal
while signing the output with its own service key. Under the Archon adapter,
that supplier is a public-key atom. The account author remains the issuer/subject
Value; the supplier is trusted for attribution. The existing law still checks
the author for each instantiated conclusion and the supplier for `supply_facts`,
but the author check does not constrain the supplier: it could equally
attribute a clause to any author holding that right, including the root. A rule
conditioned on an account's records therefore also relies on the suppliers of
that space; see [the space-asserter layer](model.md#the-separate-space-asserter-layer).

For an authenticated authoring endpoint, the root SDK exports:

```ts
import { inspectAttributedClause } from "@bitspark/thesmos";
const { author, space } = inspectAttributedClause(nativeClause);
// The service compares these with its authenticated author and exact request.
```

This reuses the existing attributed-clause syntax checks: a ground author,
proper ground placement and positive `authorized/3` or `counts/3` body premises.
It leaves the clause and its variables intact. A fact is a clause with an empty
body. Passing inspection establishes neither authentic authorship nor authority,
and creates no publication permission. Record storage, authoring authentication,
confirmation, withdrawal and currently selected evidence remain source/service
contracts. `prove` consumes supplied bundles; it does not acquire current ones.

## Full proofs with account principals

The [runnable example](../examples/account-principals.ts) uses the unchanged
five-rule law for two unrelated operations: changing a document title and a
device temperature. Synthetic root evidence authorizes a non-root grantor.
That grantor authorizes the account supplier and Alice; Alice grants Bob;
For each example operation, Bob's variable rule grants it to an eligible person
only when Bob holds it; the person's binding remains native Logos reasoning.
An independently signed provider supplies the eligibility observation.

Carol's query at a descendant resource requires the complete supplier,
author and conditional support. The [conformance tests](../core/ts/test/identity.test.ts)
remove each support separately, substitute an issuer, retain ancestor rights,
and show a new proof through an independent route after the first route loses
support. None of these tests claims current-state selection or a live account
integration. Receivers select applicable bundles through their own policy
before using the local proof checker.

The separate wide-operation witness also leaves the operation itself as an
unconstrained variable. At the default 256 MiB guest memory it reaches the host
search limit even for this small program. The suite preserves that witness:
it must either produce a valid proof or report that precise capacity stop,
never infer prohibition. The runnable concrete-operation profile must produce
proofs for both vocabularies and pass all missing-support checks. This is a
measured search limitation, not a restriction on the law or authored syntax;
`prove`'s `memoryLimitPages` option (Logos 0.24.0) raises the ceiling to at most 1 GiB.
