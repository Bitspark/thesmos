// A consumer of the C/C++ receiver, built by scripts/consumers/run.sh with CMake's FetchContent
// from one commit: it verifies the TypeScript-signed Archon proof, and the same proof with one
// changed byte is denied.
#include <thesmos/thesmos.hpp>

#include <cstdio>
#include <fstream>
#include <iterator>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fputs("usage: thesmos_consumer <archon-document.ontos>\n", stderr);
    return 2;
  }
  std::ifstream file(argv[1], std::ios::binary);
  const thesmos::Value vector = thesmos::Value::decode(thesmos::Bytes(std::istreambuf_iterator<char>(file), {}));
  const thesmos::Value q = vector[1];
  const thesmos::Query query{q[0], q[1], q[2]};
  thesmos::Bytes proof = vector[2].bytes();
  const thesmos::Verifier verifier = thesmos::Verifier::archon(vector[0]);
  const thesmos::Decision decision = verifier.verify(query, proof);
  proof[proof.size() / 2] ^= 1;
  const thesmos::Decision changed = verifier.verify(query, proof);
  std::printf("C++: %s after %llu checked steps; with one byte changed, %s\n", decision.code.c_str(),
              static_cast<unsigned long long>(decision.checked_steps), changed.code.c_str());
  return decision.permitted && !changed.permitted ? 0 : 1;
}
