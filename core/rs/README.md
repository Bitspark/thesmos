# thesmos for Rust

The Spaces authority receiver: it verifies a supplied proof for a query the receiver
constructs, under the frozen law, revision 3. It is the same receiver as the
TypeScript package and the Go module, so all of them accept the same proofs. It runs
no search, network or clock. The decision is made by the Rust checker of logos
(`logos-contract`); thesmos itself has no hand-written authority rule.

```toml
[dependencies]
thesmos = { package = "bitspark-thesmos", version = "=<version>" }
```

```rust
use thesmos::{archon, Query, Verifier};

let verifier = Verifier::new(configured_root, archon::authenticate);
let decision = verifier.verify(&Query { actor, space, statement }, &caller_proof);
if !decision.permitted {
    return; // the service performs its operation only after acceptance
}
```

Values are ontos values (`thesmos::Value`), built with `path`, `fact`, `symbol`,
`list` and `authorization`. The archon adapter is the default feature `archon`. With
`default-features = false`, you supply your own
`Fn(&Bundle, &Value) -> bool + Send + Sync + 'static`. An adapter establishes key
identity only, never authority. Any failure denies, including a panic in that adapter (under the
default `panic = "unwind"`). The crate needs Rust 1.96 or later.

The model, the other receivers and the release notes are at
<https://github.com/Bitspark/thesmos>.
