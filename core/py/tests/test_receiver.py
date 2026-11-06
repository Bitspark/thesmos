"""The Python receiver decides as Rust, Go and TypeScript do: the frozen corpus, the digests, the
TypeScript-signed Archon proof, and the adapter contract. The data files are the repository's own
law/conformance.ontos and the Rust crate's copy of the Archon vector."""

import hashlib
import json
import threading
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.exceptions import InvalidSignature

import thesmos
from thesmos import Bundle, Query, Value, Verifier

ROOT = Path(__file__).resolve().parents[3]
PROTOCOL = json.loads((ROOT / "law" / "protocol.json").read_text("utf-8"))
RESULTS = PROTOCOL["results"]


def example_key(identity: Value) -> Ed25519PrivateKey:
    # The corpus's public demo keys, reproducible from the identity. They are not credentials.
    seed = hashlib.sha256(b"Spaces public example key\0" + identity.encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def authenticate_example(bundle: Bundle, supplier: Value) -> bool:
    signature = bundle.authentication.bytes
    if signature is None:
        return False
    try:
        example_key(supplier).public_key().verify(signature, bundle.payload)
        return True
    except InvalidSignature:
        return False


def scalar(value: Value, label: bytes) -> bytes:
    # ontos-data's scalar embedding: the tuple (label, payload).
    items = value.items
    assert items is not None and len(items) == 2 and items[0] == Value.atom(label), value
    return items[1].bytes


def text(value: Value) -> str:
    return scalar(value, b"utf8-text").decode("utf-8")


def flag(value: Value) -> bool:
    payload = scalar(value, b"bool")
    assert payload in (bytes([0]), bytes([1])), value
    return payload == bytes([1])


def corpus():
    file = Value.decode((ROOT / "law" / "conformance.ontos").read_bytes()).items
    assert file[0] == thesmos.symbol("spaces/conformance/2")
    assert file[1] == Value.atom(thesmos.law_digest())
    for entry in file[2].items:
        name, why, root, query, proof, permitted = entry.items
        actor, space, statement = query.items
        yield text(name), text(why), root, Query(actor, space, statement), proof.bytes, flag(permitted)


def test_digests_equal_the_typescript_identities():
    assert thesmos.law_digest().hex() == "80f91df84e8597daf04bebc8643bc8884086829b0d06795d1e0ee97be379fe7d"
    assert thesmos.layer_digest().hex() == "84dfbd82bcb650b31a4e5f44f3b91b303fcb516166c12f7f9bba11cbfbe07cb0"


def test_frozen_conformance_corpus():
    wrong = []
    cases = list(corpus())
    assert len(cases) == 53
    for name, why, root, query, proof, permitted in cases:
        decision = Verifier(root, authenticate_example).verify(query, proof)
        if decision.permitted != permitted:
            wrong.append(f"{name} ({why}): {decision!r}")
    assert not wrong, "\n".join(wrong)
    assert sum(case[5] for case in cases) == 19


def permitted_case():
    for _, _, root, query, proof, permitted in corpus():
        if permitted:
            return root, query, proof
    raise AssertionError("no permitted case")


def test_malformed_bytes_and_limits():
    root, query, proof = permitted_case()
    verifier = Verifier(root, authenticate_example)
    for bad in [b"", b"{}", proof[:-1], proof + b"\0"]:
        assert verifier.verify(query, bad).code == RESULTS["invalid"]
    assert verifier.verify(query, bytes(PROTOCOL["limits"]["maxProofBytes"] + 1)).code == RESULTS["limit"]


def test_another_query_root_or_authentication_denies():
    root, query, proof = permitted_case()
    baseline = Verifier(root, authenticate_example).verify(query, proof)
    assert baseline.permitted and baseline.code == RESULTS["permitted"] and baseline.checked_steps > 0
    other = Query(query.actor, query.space, thesmos.fact("another_statement"))
    assert Verifier(root, authenticate_example).verify(other, proof).code == RESULTS["rejected"]
    assert Verifier(thesmos.symbol("another_root"), authenticate_example).verify(query, proof).code == RESULTS["rejected"]
    assert Verifier(root, lambda bundle, supplier: False).verify(query, proof).code == RESULTS["authentication"]


@pytest.mark.parametrize(
    "adapter",
    [
        pytest.param(lambda bundle, supplier: 1 / 0, id="raises"),
        pytest.param(lambda bundle, supplier: 1, id="returns-int"),
        pytest.param(lambda bundle, supplier: "yes", id="returns-str"),
        pytest.param(lambda bundle: True, id="wrong-arity"),
    ],
)
def test_only_true_authenticates_and_adapter_failures_deny_as_invalid(adapter):
    root, query, proof = permitted_case()
    decision = Verifier(root, adapter).verify(query, proof)
    assert not decision.permitted and decision.code == RESULTS["invalid"], decision
    assert "authentication adapter raised" in decision.detail


def test_authenticate_must_be_callable():
    with pytest.raises(TypeError):
        Verifier(thesmos.symbol("root"), None)


def test_verifiers_run_concurrently_with_python_adapters():
    root, query, proof = permitted_case()
    verifier = Verifier(root, authenticate_example)
    results = []

    def check():
        results.append(verifier.verify(query, proof).permitted)

    threads = [threading.Thread(target=check) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results == [True] * 8


def test_typescript_archon_proof_verifies():
    vector = Value.decode((ROOT / "core" / "rs" / "tests" / "data" / "archon-document.ontos").read_bytes()).items
    root, (actor, space, statement), proof = vector[0], vector[1].items, vector[2].bytes
    query = Query(actor, space, statement)
    for verifier in [Verifier.archon(root), Verifier(root, thesmos.archon_authenticate)]:
        assert verifier.verify(query, proof).permitted
        for offset in [len(proof) // 3, len(proof) // 2, len(proof) - 40]:
            changed = bytearray(proof)
            changed[offset] ^= 1
            assert not verifier.verify(query, bytes(changed)).permitted
    first = Value.decode(proof).items[3].items[0].items
    payload, signature = first[0].bytes, first[1]
    supplier = thesmos.decode_space_facts(payload).supplier
    assert thesmos.archon_authenticate(Bundle(payload, signature), supplier)
    changed = bytearray(payload)
    changed[len(changed) // 2] ^= 1
    assert not thesmos.archon_authenticate(Bundle(bytes(changed), signature), supplier)
    assert not thesmos.archon_authenticate(Bundle(payload, Value.tuple([])), supplier)
    assert thesmos.ARCHON_DOMAIN == "thesmos/space-facts/v1"


def test_values_and_constructors():
    team = thesmos.path("team", b"docs")
    assert team == thesmos.list([Value.atom(b"team"), Value.atom(b"docs")])
    assert Value.decode(team.encode()) == team
    assert thesmos.fact("title", Value.atom(b"x")).items[0] == thesmos.symbol("title")
    assert thesmos.authorization(Value.atom(b"a"), Value.atom(b"s"), team).items[0] == thesmos.symbol("authorized")
    assert hash(Value.atom(b"a")) == hash(Value.atom(b"a"))
    with pytest.raises(ValueError):
        Value.decode(b"\xff")
