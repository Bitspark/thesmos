// The C++ receiver decides like the TypeScript, Go and Rust receivers: the frozen corpus, the
// TypeScript-signed Archon vector, the pinned digests and the adapter contract, through the C++
// wrapper and the C interface. Test data is core/rs's byte copy (tests/data), kept equal to law/
// by `npm run law:check`.
#include <openssl/evp.h>

#include <cstdio>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <thread>

#include "thesmos/thesmos.hpp"

namespace {

int failures = 0;
#define CHECK(condition, ...)                                         \
  do {                                                                \
    if (!(condition)) {                                               \
      ++failures;                                                     \
      std::fprintf(stderr, "FAIL %s:%d: %s: ", __FILE__, __LINE__, #condition); \
      std::fprintf(stderr, __VA_ARGS__);                              \
      std::fputc('\n', stderr);                                       \
    }                                                                 \
  } while (false)

thesmos::Bytes read_file(const std::string& name) {
  std::ifstream file(std::string(THESMOS_TEST_DATA) + "/" + name, std::ios::binary);
  if (!file) throw std::runtime_error("cannot read " + name);
  return thesmos::Bytes(std::istreambuf_iterator<char>(file), {});
}

std::string hex(const thesmos::Bytes& bytes) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (std::uint8_t byte : bytes) {
    out += digits[byte >> 4];
    out += digits[byte & 15];
  }
  return out;
}

// The public demo keys of the frozen corpus (law/conformance.ontos), reproducible from the
// identity: seed = SHA-256("Spaces public example key\0" || Ontos(identity)), plain Ed25519 over
// the payload. They are not credentials; this adapter exists only for the corpus.
bool authenticate_example(std::span<const std::uint8_t> payload, const thesmos::Value& authentication,
                          const thesmos::Value& supplier) {
  if (!authentication.is_atom()) return false;
  static const char prefix[] = "Spaces public example key";
  thesmos::Bytes input(prefix, prefix + sizeof prefix);  // includes the terminating NUL
  const thesmos::Bytes identity = supplier.encode();
  input.insert(input.end(), identity.begin(), identity.end());
  std::uint8_t seed[32];
  unsigned int seed_len = 0;
  if (EVP_Digest(input.data(), input.size(), seed, &seed_len, EVP_sha256(), nullptr) != 1) return false;
  EVP_PKEY* key = EVP_PKEY_new_raw_private_key(EVP_PKEY_ED25519, nullptr, seed, sizeof seed);
  EVP_MD_CTX* context = EVP_MD_CTX_new();
  const thesmos::Bytes signature = authentication.bytes();
  const bool valid = key != nullptr && context != nullptr &&
                     EVP_DigestVerifyInit(context, nullptr, nullptr, nullptr, key) == 1 &&
                     EVP_DigestVerify(context, signature.data(), signature.size(), payload.data(), payload.size()) == 1;
  EVP_MD_CTX_free(context);
  EVP_PKEY_free(key);
  return valid;
}

struct Case {
  std::string name, why;
  thesmos::Value root;
  thesmos::Query query;
  thesmos::Bytes proof;
  bool permitted;
};

std::vector<Case> read_corpus() {
  const thesmos::Value file = thesmos::Value::decode(read_file("conformance.ontos"));
  if (file.size() != 3 || !(file[0] == thesmos::symbol("spaces/conformance/2")) ||
      !(file[1] == thesmos::law_digest())) {
    throw std::runtime_error("wrong conformance format or law");
  }
  std::vector<Case> cases;
  const thesmos::Value entries = file[2];
  for (std::size_t i = 0; i < entries.size(); ++i) {
    const thesmos::Value fields = entries[i];
    const thesmos::Value q = fields[3];
    cases.push_back(Case{fields[0].read_text().value(), fields[1].read_text().value(), fields[2],
                         thesmos::Query{q[0], q[1], q[2]}, fields[4].bytes(), fields[5].read_bool().value()});
  }
  return cases;
}

void digests_equal_the_typescript_identities() {
  CHECK(hex(thesmos::law_digest().bytes()) == "80f91df84e8597daf04bebc8643bc8884086829b0d06795d1e0ee97be379fe7d",
        "law digest %s", hex(thesmos::law_digest().bytes()).c_str());
  CHECK(hex(thesmos::layer_digest().bytes()) == "84dfbd82bcb650b31a4e5f44f3b91b303fcb516166c12f7f9bba11cbfbe07cb0",
        "layer digest %s", hex(thesmos::layer_digest().bytes()).c_str());
}

void frozen_conformance_corpus() {
  const std::vector<Case> cases = read_corpus();
  CHECK(cases.size() == 53, "corpus has %zu cases", cases.size());
  std::size_t permitted = 0;
  for (const Case& c : cases) {
    const thesmos::Verifier verifier(c.root, authenticate_example);
    const thesmos::Decision got = verifier.verify(c.query, c.proof);
    CHECK(got.permitted == c.permitted, "%s (%s): %s %s", c.name.c_str(), c.why.c_str(), got.code.c_str(),
          got.detail.c_str());
    CHECK(got.permitted == (got.code == "permitted"), "%s: code %s", c.name.c_str(), got.code.c_str());
    permitted += got.permitted;
  }
  CHECK(permitted == 19, "%zu cases permitted", permitted);
}

void typescript_archon_proof_verifies() {
  const thesmos::Value vector = thesmos::Value::decode(read_file("archon-document.ontos"));
  const thesmos::Value q = vector[1];
  const thesmos::Query query{q[0], q[1], q[2]};
  const thesmos::Bytes proof = vector[2].bytes();
  const thesmos::Verifier verifier = thesmos::Verifier::archon(vector[0]);
  const thesmos::Decision got = verifier.verify(query, proof);
  CHECK(got.permitted && got.code == "permitted" && got.checked_steps > 0, "%s %s", got.code.c_str(),
        got.detail.c_str());
  // Any changed byte breaks the envelope, a signature or the proof.
  for (std::size_t offset : {proof.size() / 3, proof.size() / 2, proof.size() - 40}) {
    thesmos::Bytes changed = proof;
    changed[offset] ^= 1;
    CHECK(!verifier.verify(query, changed).permitted, "byte %zu changed, still permitted", offset);
  }
  // Another root or another query denies the same proof.
  CHECK(!thesmos::Verifier::archon(thesmos::Value::atom("another root")).verify(query, proof).permitted, "root");
  const thesmos::Query sibling{q[0], thesmos::path({"sibling"}), q[2]};
  CHECK(!verifier.verify(sibling, proof).permitted, "another space");
  // One verifier, shared by several threads at once, decides each call the same way.
  std::vector<int> permitted(8, 0);
  std::vector<std::thread> threads;
  for (std::size_t t = 0; t < permitted.size(); ++t) {
    threads.emplace_back([&, t] {
      for (int i = 0; i < 4; ++i) permitted[t] += verifier.verify(query, proof).permitted;
    });
  }
  for (std::thread& thread : threads) thread.join();
  for (int n : permitted) CHECK(n == 4, "a concurrent call denied: %d of 4", n);
}

void the_adapter_contract() {
  const Case c = read_corpus().at(0);
  for (const Case& each : read_corpus()) {
    if (!each.permitted) continue;
    // An adapter that refuses, or throws, denies with the authentication code.
    const thesmos::Verifier refuses(each.root, [](auto, const auto&, const auto&) { return false; });
    CHECK(refuses.verify(each.query, each.proof).code == "authentication-failed", "refusing adapter");
    const thesmos::Verifier throws(each.root, [](auto, const auto&, const auto&) -> bool {
      throw std::runtime_error("adapter failure");
    });
    const thesmos::Decision thrown = throws.verify(each.query, each.proof);
    CHECK(!thrown.permitted, "throwing adapter permitted: %s", thrown.code.c_str());
    break;
  }
  bool threw = false;
  try {
    thesmos::Verifier(c.root, thesmos::Authenticate{});
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  CHECK(threw, "an empty adapter is refused");
  // Malformed proof bytes never permit.
  const thesmos::Verifier verifier(c.root, authenticate_example);
  for (const thesmos::Bytes& bytes : {thesmos::Bytes{}, thesmos::Bytes{0xff, 0x00, 0x01}, c.root.encode()}) {
    const thesmos::Decision got = verifier.verify(c.query, bytes);
    CHECK(!got.permitted && got.code == "invalid-proof", "malformed proof: %s", got.code.c_str());
  }
}

void moves_and_moved_from_values() {
  // Replacing a verifier releases the old one before its adapter; the new one keeps working.
  const thesmos::Value vector = thesmos::Value::decode(read_file("archon-document.ontos"));
  const thesmos::Value q = vector[1];
  thesmos::Verifier verifier(thesmos::Value::atom("old root"), authenticate_example);
  verifier = thesmos::Verifier::archon(vector[0]);
  CHECK(verifier.verify({q[0], q[1], q[2]}, vector[2].bytes()).permitted, "a moved-in verifier");
  thesmos::Value moved = thesmos::symbol("x");
  const thesmos::Value taken = std::move(moved);
  const thesmos::Value copy = moved;  // NOLINT(bugprone-use-after-move): deliberate
  CHECK(!copy.is_atom() && !copy.is_tuple() && taken.is_atom(), "a moved-from value is neither");
}

void values_round_trip() {
  const thesmos::Value v = thesmos::fact("title", {thesmos::symbol("doc7"), thesmos::Value::text("Reconciled"),
                                                    thesmos::Value::integer(-21), thesmos::Value::boolean(true)});
  CHECK(thesmos::Value::decode(v.encode()) == v, "round trip");
  CHECK(v.size() == 5 && v[0] == thesmos::symbol("title"), "fact shape");
  CHECK(v[2].read_text() == "Reconciled" && v[3].read_int() == -21 && v[4].read_bool() == true, "embeddings");
  CHECK(!v[1].read_text().has_value(), "a symbol is not a text embedding");
  const thesmos::Value space = thesmos::path({"team", "docs"});
  CHECK(space == thesmos::list({thesmos::symbol("team"), thesmos::symbol("docs")}), "a path is a list of atoms");
  bool threw = false;
  try {
    thesmos::Value::text(std::string_view("\xff", 1));
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  CHECK(threw, "invalid UTF-8 text is refused");
  threw = false;
  try {
    thesmos::Value::decode(thesmos::Bytes{0x07});
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  CHECK(threw, "non-canonical bytes are refused");
}

}  // namespace

int main() {
  try {
    digests_equal_the_typescript_identities();
    frozen_conformance_corpus();
    typescript_archon_proof_verifies();
    the_adapter_contract();
    moves_and_moved_from_values();
    values_round_trip();
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
  if (failures != 0) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("thesmos %s: C++ receiver checks passed\n", std::string(thesmos::version()).c_str());
  return 0;
}
