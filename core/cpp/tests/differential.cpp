// The C++ decider of the cross-language differential test (scripts/differential): reads
// cases.ontos on stdin and writes one JSON decision per line, through the C++ wrapper and the C
// interface, so the C layer's own handling of every decision is compared with the other
// receivers. A development tool, not part of the library.
#include <openssl/evp.h>

#include <cstdio>
#include <iostream>
#include <iterator>
#include <span>
#include <stdexcept>
#include <string>

#include "thesmos/thesmos.hpp"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

// The corpus's public demo keys, as in tests/receiver.cpp: seed = SHA-256("Spaces public example
// key\0" || Ontos(identity)), plain Ed25519 over the payload. They are not credentials.
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

std::string json_string(const std::string& text) {
  std::string out = "\"";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') {
      out += '\\';
      out += static_cast<char>(c);
    } else if (c < 0x20) {
      char escaped[8];
      std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
      out += escaped;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out + "\"";
}

}  // namespace

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  const thesmos::Bytes input(std::istreambuf_iterator<char>(std::cin), {});
  const thesmos::Value cases = thesmos::Value::decode(input)[2];
  std::string out;
  for (std::size_t i = 0; i < cases.size(); ++i) {
    const thesmos::Value entry = cases[i];
    const thesmos::Value root = entry[0], q = entry[1];
    const thesmos::Bytes authenticator = entry[3].bytes();
    const std::string kind(authenticator.begin(), authenticator.end());
    const thesmos::Verifier verifier =
        kind == "archon"    ? thesmos::Verifier::archon(root)
        : kind == "example" ? thesmos::Verifier(root, authenticate_example)
        : kind == "accept"  ? thesmos::Verifier(root, [](auto, const auto&, const auto&) { return true; })
                            : throw std::runtime_error("unknown authenticator " + kind);
    const thesmos::Decision d = verifier.verify({q[0], q[1], q[2]}, entry[2].bytes());
    const bool panicked = d.detail.starts_with("verification failed: ");
    out += "{\"i\":" + std::to_string(i) + ",\"permitted\":" + (d.permitted ? "true" : "false") +
           ",\"code\":" + json_string(d.code) + ",\"steps\":" + std::to_string(d.permitted ? d.checked_steps : 0) +
           ",\"panicked\":" + (panicked ? "true" : "false") + "}\n";
  }
  std::fwrite(out.data(), 1, out.size(), stdout);
  return std::fflush(stdout) == 0 ? 0 : 1;
}
