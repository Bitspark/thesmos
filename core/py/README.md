# thesmos for Python

The Spaces authority receiver: it verifies a supplied proof for a query the receiver
constructs, under the frozen law, revision 3. It is the Rust receiver (`core/rs`)
behind PyO3, so Python decides exactly as Rust, Go and TypeScript do. It runs no
search, network or clock.

```python
import thesmos

verifier = thesmos.Verifier.archon(configured_root)  # or Verifier(root, authenticate)
decision = verifier.verify(thesmos.Query(actor, space, statement), caller_proof)
if not decision.permitted:
    return  # the service performs its operation only after acceptance
```

Values are `thesmos.Value`, canonical Ontos values with `encode()` and
`Value.decode(...)`. See the repository README for the model.
