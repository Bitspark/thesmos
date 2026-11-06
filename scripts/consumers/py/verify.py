"""A consumer of the Python receiver, installed by scripts/consumers/run.sh with pip from one
commit: it verifies the TypeScript-signed Archon proof, and the same proof with one changed byte
is denied."""

import sys

import thesmos


def main() -> int:
    with open(sys.argv[1], "rb") as file:
        vector = thesmos.Value.decode(file.read()).items
    root, q, proof = vector[0], vector[1], bytearray(vector[2].bytes)
    actor, space, statement = q.items
    query = thesmos.Query(actor, space, statement)
    verifier = thesmos.Verifier.archon(root)
    decision = verifier.verify(query, bytes(proof))
    proof[len(proof) // 2] ^= 1
    changed = verifier.verify(query, bytes(proof))
    print(f"Python: {decision.code} after {decision.checked_steps} checked steps; with one byte changed, {changed.code}")
    return 0 if decision.permitted and not changed.permitted else 1


if __name__ == "__main__":
    sys.exit(main())
