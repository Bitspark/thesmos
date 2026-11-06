"""The Python decider of the cross-language differential test (scripts/differential).

Reads cases.ontos on stdin and writes one JSON decision per line. A development tool, not part of
the package's API. Needs the installed thesmos extension and the cryptography package.
"""

import hashlib
import json
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from thesmos import Bundle, Query, Value, Verifier


def authenticate_example(bundle: Bundle, supplier: Value) -> bool:
    # The corpus's public demo keys, reproducible from the identity. They are not credentials.
    seed = hashlib.sha256(b"Spaces public example key\0" + supplier.encode()).digest()
    signature = bundle.authentication.bytes
    if signature is None:
        return False
    try:
        Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(signature, bundle.payload)
        return True
    except InvalidSignature:
        return False


def main() -> None:
    cases = Value.decode(sys.stdin.buffer.read()).items[2].items
    out = []
    for i, entry in enumerate(cases):
        root, q, proof, auth = entry.items
        actor, space, statement = q.items
        kind = auth.bytes
        if kind == b"archon":
            verifier = Verifier.archon(root)
        elif kind == b"example":
            verifier = Verifier(root, authenticate_example)
        elif kind == b"accept":
            verifier = Verifier(root, lambda bundle, supplier: True)
        else:
            raise SystemExit(f"unknown authenticator {kind!r}")
        d = verifier.verify(Query(actor, space, statement), proof.bytes)
        panicked = d.detail.startswith("verification failed: ")
        out.append(json.dumps({"i": i, "permitted": d.permitted, "code": d.code, "steps": d.checked_steps if d.permitted else 0, "panicked": panicked}))
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
