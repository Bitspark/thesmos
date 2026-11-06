// The Spaces receiver for C++: verify a supplied proof under the frozen law, revision 3.
//
// A header-only C++20 wrapper over thesmos.h, the C interface of thesmos's Rust receiver. Like
// the TypeScript, Go and Rust receivers it checks a supplied proof for a query the receiver
// constructs; it runs no search, network or clock, and every decision is made by Logos's Rust
// checker over the embedded frozen law. Apache-2.0.
#ifndef THESMOS_HPP
#define THESMOS_HPP

#include <cstddef>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <memory>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "thesmos.h"

namespace thesmos {

using Bytes = std::vector<std::uint8_t>;

namespace detail {
// Releases a buffer or decision from the C interface when it goes out of scope, so a copy that
// throws (out of memory) does not leak it.
struct BufferRelease {
  thesmos_buffer& buffer;
  ~BufferRelease() { thesmos_buffer_free(&buffer); }
};
struct DecisionRelease {
  thesmos_decision& decision;
  ~DecisionRelease() { thesmos_decision_free(&decision); }
};
inline Bytes bytes(const thesmos_buffer& buffer) { return Bytes(buffer.data, buffer.data + buffer.len); }
inline std::string text(const thesmos_buffer& buffer) {
  return std::string(reinterpret_cast<const char*>(buffer.data), buffer.len);
}
}  // namespace detail

// An immutable Ontos value: an atom (a byte string) or a tuple of values. Copies are independent.
class Value {
 public:
  // Takes ownership of a handle from the C interface; throws on null, which is how it reports
  // invalid input.
  static Value adopt(thesmos_value* handle, const char* what = "thesmos: invalid value") {
    if (handle == nullptr) throw std::invalid_argument(what);
    return Value(handle);
  }

  static Value atom(std::span<const std::uint8_t> bytes) {
    return adopt(thesmos_value_atom(bytes.data(), bytes.size()));
  }
  static Value atom(std::string_view bytes) {
    return atom(std::span(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size()));
  }
  static Value tuple(std::span<const Value> items) {
    auto handles = handles_of(items);
    return adopt(thesmos_value_tuple(handles.data(), handles.size()));
  }
  static Value tuple(std::initializer_list<Value> items) { return tuple(std::span(items.begin(), items.size())); }
  // Ontos's text, integer and boolean embeddings.
  static Value text(std::string_view utf8) {
    return adopt(thesmos_value_text(utf8.data(), utf8.size()), "thesmos: text is not valid UTF-8");
  }
  static Value integer(std::int64_t n) { return adopt(thesmos_value_int(n)); }
  static Value boolean(bool b) { return adopt(thesmos_value_bool(b)); }
  // Decodes canonical Ontos bytes; throws if they are not a canonical encoding.
  static Value decode(std::span<const std::uint8_t> bytes) {
    return adopt(thesmos_value_decode(bytes.data(), bytes.size()), "thesmos: not a canonical Ontos encoding");
  }

  Value(const Value& other) : handle_(clone(other.handle_.get())) {}
  Value(Value&&) noexcept = default;
  Value& operator=(const Value& other) {
    if (this != &other) handle_.reset(clone(other.handle_.get()));
    return *this;
  }
  Value& operator=(Value&&) noexcept = default;
  ~Value() = default;

  Bytes encode() const {
    thesmos_buffer buffer{};
    if (!thesmos_value_encode(get(), &buffer)) throw std::invalid_argument("thesmos: invalid value");
    const detail::BufferRelease release{buffer};
    return detail::bytes(buffer);
  }
  // A moved-from value is neither; it may only be assigned to or destroyed.
  bool is_atom() const { return thesmos_value_is_atom(get()); }
  bool is_tuple() const { return get() != nullptr && !is_atom(); }
  // An atom's bytes; throws for a tuple.
  Bytes bytes() const {
    if (!is_atom()) throw std::logic_error("thesmos: not an atom");
    const thesmos_bytes view = thesmos_value_atom_bytes(get());
    return Bytes(view.data, view.data + view.len);
  }
  // A tuple's arity and items; 0 and out_of_range for an atom.
  std::size_t size() const { return thesmos_value_tuple_len(get()); }
  Value at(std::size_t index) const {
    thesmos_value* item = thesmos_value_tuple_item(get(), index);
    if (item == nullptr) throw std::out_of_range("thesmos: no such tuple item");
    return Value(item);
  }
  Value operator[](std::size_t index) const { return at(index); }
  // Reads Ontos's embeddings; empty when the value is not one.
  std::optional<std::string> read_text() const {
    thesmos_buffer buffer{};
    if (!thesmos_value_read_text(get(), &buffer)) return std::nullopt;
    const detail::BufferRelease release{buffer};
    return detail::text(buffer);
  }
  std::optional<std::int64_t> read_int() const {
    std::int64_t n = 0;
    return thesmos_value_read_int(get(), &n) ? std::optional(n) : std::nullopt;
  }
  std::optional<bool> read_bool() const {
    bool b = false;
    return thesmos_value_read_bool(get(), &b) ? std::optional(b) : std::nullopt;
  }

  friend bool operator==(const Value& a, const Value& b) { return thesmos_value_equal(a.get(), b.get()); }

  const thesmos_value* get() const noexcept { return handle_.get(); }

  static std::vector<const thesmos_value*> handles_of(std::span<const Value> values) {
    std::vector<const thesmos_value*> handles;
    handles.reserve(values.size());
    for (const Value& value : values) handles.push_back(value.get());
    return handles;
  }

 private:
  struct Free {
    void operator()(thesmos_value* handle) const noexcept { thesmos_value_free(handle); }
  };
  explicit Value(thesmos_value* handle) : handle_(handle) {}
  static thesmos_value* clone(const thesmos_value* handle) {
    if (handle == nullptr) return nullptr;  // a copy of a moved-from value is moved-from
    thesmos_value* copy = thesmos_value_clone(handle);
    if (copy == nullptr) throw std::bad_alloc();
    return copy;
  }
  std::unique_ptr<thesmos_value, Free> handle_;
};

// A Logos symbol: the atom of the name's UTF-8 bytes. Throws if the name is not valid UTF-8.
inline Value symbol(std::string_view name) {
  return Value::adopt(thesmos_symbol(name.data(), name.size()), "thesmos: name is not valid UTF-8");
}
// A labeled Logos compound: the tuple (name, args...).
inline Value fact(std::string_view name, std::span<const Value> args) {
  auto handles = Value::handles_of(args);
  return Value::adopt(thesmos_fact(name.data(), name.size(), handles.data(), handles.size()),
                      "thesmos: name is not valid UTF-8");
}
inline Value fact(std::string_view name, std::initializer_list<Value> args = {}) {
  return fact(name, std::span(args.begin(), args.size()));
}
// Logos's [Head|Tail] list, distinct from Ontos's flat list embedding.
inline Value list(std::span<const Value> items) {
  auto handles = Value::handles_of(items);
  return Value::adopt(thesmos_list(handles.data(), handles.size()));
}
inline Value list(std::initializer_list<Value> items) { return list(std::span(items.begin(), items.size())); }
// A space path of the segments' exact bytes.
inline Value path(std::span<const std::string_view> segments) {
  std::vector<thesmos_bytes> views;
  views.reserve(segments.size());
  for (std::string_view segment : segments) {
    views.push_back({reinterpret_cast<const std::uint8_t*>(segment.data()), segment.size()});
  }
  return Value::adopt(thesmos_path(views.data(), views.size()));
}
inline Value path(std::initializer_list<std::string_view> segments) {
  return path(std::span(segments.begin(), segments.size()));
}
// The authorized(actor, statement, space) compound a query asks for.
inline Value authorization(const Value& actor, const Value& statement, const Value& space) {
  return Value::adopt(thesmos_authorization(actor.get(), statement.get(), space.get()));
}
// The law and space-asserter layer digests a proof must name.
inline Value law_digest() { return Value::adopt(thesmos_law_digest()); }
inline Value layer_digest() { return Value::adopt(thesmos_layer_digest()); }
inline std::string_view version() { return thesmos_version(); }

// What the receiver asks: may actor assert statement in space? The receiver constructs it from
// the authenticated actor and the actual operation; space is a Logos path list (see path).
struct Query {
  Value actor;
  Value space;
  Value statement;
};

// The verifier's result. code is one of the protocol's result codes; detail is diagnostic only.
struct Decision {
  bool permitted = false;
  std::string code;
  std::string detail;
  std::uint64_t checked_steps = 0;
};

// Reports whether supplier authenticated exactly payload with authentication. It establishes key
// identity only, never authority. false denies as authentication-failed; an exception it throws
// denies as invalid-proof, as a failing adapter does in every other receiver.
using Authenticate =
    std::function<bool(std::span<const std::uint8_t> payload, const Value& authentication, const Value& supplier)>;

// Verifies supplied proofs under one configured root. It is immutable; verify may be called from
// several threads at once when the authentication adapter allows it.
class Verifier {
 public:
  // Authenticates bundles with archon's Ed25519ph domain signatures (thesmos/space-facts/v1).
  static Verifier archon(const Value& root) {
    thesmos_verifier* handle = thesmos_verifier_new_archon(root.get());
    if (handle == nullptr) throw std::invalid_argument("thesmos: invalid root");
    return Verifier(handle, nullptr);
  }

  Verifier(const Value& root, Authenticate authenticate)
      : authenticate_(std::make_unique<Authenticate>(std::move(authenticate))) {
    if (!*authenticate_) throw std::invalid_argument("thesmos: an authentication adapter is required");
    handle_.reset(thesmos_verifier_new(root.get(), &Verifier::call, authenticate_.get()));
    if (!handle_) throw std::invalid_argument("thesmos: invalid root");
  }

  Verifier(Verifier&&) noexcept = default;
  // The old verifier is released before the adapter it calls, as in the destructor.
  Verifier& operator=(Verifier&& other) noexcept {
    handle_ = std::move(other.handle_);
    authenticate_ = std::move(other.authenticate_);
    return *this;
  }

  // Checks proof, canonical Ontos bytes, for exactly query. Every failure denies.
  Decision verify(const Query& query, std::span<const std::uint8_t> proof) const {
    thesmos_decision out{};
    if (!thesmos_verify(handle_.get(), query.actor.get(), query.space.get(), query.statement.get(), proof.data(),
                        proof.size(), &out)) {
      throw std::invalid_argument("thesmos: invalid verifier or query");
    }
    const detail::DecisionRelease release{out};
    return Decision{out.permitted, detail::text(out.code), detail::text(out.detail), out.checked_steps};
  }

 private:
  struct Free {
    void operator()(thesmos_verifier* handle) const noexcept { thesmos_verifier_free(handle); }
  };
  Verifier(thesmos_verifier* handle, std::unique_ptr<Authenticate> authenticate)
      : authenticate_(std::move(authenticate)), handle_(handle) {}

  // No exception may cross the C boundary: an exception is reported as the adapter's failure.
  static std::int32_t call(void* context, const std::uint8_t* payload, std::size_t payload_len,
                           const thesmos_value* authentication, const thesmos_value* supplier) noexcept {
    try {
      const auto& authenticate = *static_cast<const Authenticate*>(context);
      return authenticate(std::span(payload, payload_len), Value::adopt(thesmos_value_clone(authentication)),
                          Value::adopt(thesmos_value_clone(supplier)))
                 ? THESMOS_AUTHENTICATED
                 : THESMOS_NOT_AUTHENTICATED;
    } catch (...) {
      return THESMOS_ADAPTER_FAILED;
    }
  }

  // Declared first, released last: the library may call the adapter until the handle is gone.
  std::unique_ptr<Authenticate> authenticate_;
  std::unique_ptr<thesmos_verifier, Free> handle_;
};

}  // namespace thesmos

#endif  // THESMOS_HPP
