//! The C interface of the Spaces receiver: the Rust receiver (`thesmos`, core/rs) behind a C ABI,
//! for include/thesmos/thesmos.h and its C++ wrapper include/thesmos/thesmos.hpp.
//!
//! It adds no authority rule, decoding or checking of its own. Values cross the boundary as
//! opaque handles to Ontos values; every decision is the Rust receiver's, made by Logos's Rust
//! checker over the frozen law. No panic crosses the boundary: each entry point catches it and
//! returns its documented failure value, and a verification that panics denies.
//!
//! # Safety
//!
//! One contract covers every function, so it is stated here rather than on each:
//! - A value or verifier pointer is null or was returned by this library and not yet freed.
//!   Values and verifiers are immutable, and may be read from several threads at once.
//! - A byte range (`data`, `len`) is readable for `len` bytes; `data` may be null only if
//!   `len` is 0. An array of value pointers is readable for `len` entries.
//! - An out pointer is null or writable; it need not be initialized, since results are written
//!   without reading it. A buffer or decision written to it is owned by the caller until
//!   released with its `_free` function, exactly once.
//! - Borrowed bytes (`thesmos_bytes`) are valid only while the value they came from lives.
#![allow(clippy::missing_safety_doc)]

use std::ffi::{c_char, c_void};
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::{ptr, slice};

use ontos_core::Value;

/// An immutable Ontos value (an atom or a tuple), owned by the caller.
/// Release it with `thesmos_value_free`.
pub struct ThesmosValue(Value);

/// A verifier under one configured root. It is immutable and may be shared between threads,
/// provided its authentication callback may be called from them.
/// Release it with `thesmos_verifier_free`.
pub struct ThesmosVerifier(thesmos::Verifier);

/// Bytes owned by the caller. Release them with `thesmos_buffer_free`.
#[repr(C)]
pub struct ThesmosBuffer {
    pub data: *mut u8,
    pub len: usize,
}

/// Bytes borrowed from a value; valid while that value lives. `data` is null when absent.
#[repr(C)]
pub struct ThesmosBytes {
    pub data: *const u8,
    pub len: usize,
}

/// A verification result. `code` is one of the protocol's result codes (law/protocol.json), as
/// UTF-8 without a terminator; `detail` is diagnostic only. Release it with
/// `thesmos_decision_free`.
#[repr(C)]
pub struct ThesmosDecision {
    pub permitted: bool,
    pub checked_steps: u64,
    pub code: ThesmosBuffer,
    pub detail: ThesmosBuffer,
}

/// `thesmos_authenticate`'s answer: `supplier` did not authenticate the payload. The proof is
/// denied as `authentication-failed`.
pub const THESMOS_NOT_AUTHENTICATED: i32 = 0;
/// `thesmos_authenticate`'s answer: `supplier` authenticated exactly the payload.
pub const THESMOS_AUTHENTICATED: i32 = 1;
/// `thesmos_authenticate` could not answer (for example, the C++ adapter threw). The proof is
/// denied as `invalid-proof`, as a failing adapter is in every other receiver. Any value other
/// than the two answers is treated the same way: in C an unknown answer is a broken adapter.
/// The denial unwinds into the receiver's catch, so this library must be built with
/// `panic = "unwind"` (its default); under `panic = "abort"` a failure ends the process.
pub const THESMOS_ADAPTER_FAILED: i32 = -1;

/// Reports whether `supplier` authenticated exactly `payload` with `authentication`, as
/// `THESMOS_AUTHENTICATED` or `THESMOS_NOT_AUTHENTICATED`, or `THESMOS_ADAPTER_FAILED` if it
/// could not answer. It establishes key identity only, never authority. The value pointers are
/// borrowed for the call: do not free or retain them. It must not unwind (a C++ exception must
/// not escape it) and must be safe to call from every thread that calls `thesmos_verify` with
/// this verifier.
pub type ThesmosAuthenticate = Option<
    unsafe extern "C" fn(
        context: *mut c_void,
        payload: *const u8,
        payload_len: usize,
        authentication: *const ThesmosValue,
        supplier: *const ThesmosValue,
    ) -> i32,
>;

struct Callback {
    function: unsafe extern "C" fn(*mut c_void, *const u8, usize, *const ThesmosValue, *const ThesmosValue) -> i32,
    context: *mut c_void,
}

// The caller's contract for `ThesmosAuthenticate` makes the callback and its context usable from
// every thread that verifies with it.
unsafe impl Send for Callback {}
unsafe impl Sync for Callback {}

impl Callback {
    // A method, so a closure captures the whole Callback rather than its raw-pointer field.
    fn authenticate(&self, bundle: &thesmos::Bundle, supplier: &Value) -> bool {
        // Handles the callback borrows for the call; they are released when it returns.
        let authentication = ThesmosValue(bundle.authentication.clone());
        let supplier = ThesmosValue(supplier.clone());
        let answer = unsafe {
            (self.function)(self.context, bundle.payload.as_ptr(), bundle.payload.len(), &authentication, &supplier)
        };
        match answer {
            THESMOS_AUTHENTICATED => true,
            THESMOS_NOT_AUTHENTICATED => false,
            // Unwinds into the receiver's catch, which denies as invalid-proof; no panic hook runs.
            _ => resume_unwind(Box::new("the authentication adapter failed")),
        }
    }
}

fn guard<T>(failure: T, body: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(body)).unwrap_or(failure)
}

/// A borrowed byte range; null data is accepted only for an empty range.
unsafe fn input<'a>(data: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        Some(&[])
    } else if data.is_null() {
        None
    } else {
        Some(slice::from_raw_parts(data, len))
    }
}

unsafe fn value<'a>(handle: *const ThesmosValue) -> Option<&'a Value> {
    handle.as_ref().map(|handle| &handle.0)
}

unsafe fn values(items: *const *const ThesmosValue, len: usize) -> Option<Vec<Value>> {
    if len == 0 {
        return Some(Vec::new());
    }
    if items.is_null() {
        return None;
    }
    slice::from_raw_parts(items, len).iter().map(|&item| value(item).cloned()).collect()
}

fn owned(value: Value) -> *mut ThesmosValue {
    Box::into_raw(Box::new(ThesmosValue(value)))
}

fn buffer(bytes: &[u8]) -> ThesmosBuffer {
    let boxed: Box<[u8]> = bytes.into();
    let len = boxed.len();
    ThesmosBuffer { data: Box::into_raw(boxed) as *mut u8, len }
}

const EMPTY: ThesmosBuffer = ThesmosBuffer { data: ptr::null_mut(), len: 0 };

// --- Values -------------------------------------------------------------------------------

/// An atom of exactly these bytes.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_atom(data: *const u8, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || input(data, len).map_or(ptr::null_mut(), |bytes| owned(Value::atom(bytes))))
}

/// A tuple of copies of `items`; null if any item is null.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_tuple(items: *const *const ThesmosValue, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || values(items, len).map_or(ptr::null_mut(), |items| owned(Value::tuple(items))))
}

/// Ontos's text embedding of UTF-8 text; null if it is not valid UTF-8.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_text(utf8: *const c_char, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        input(utf8.cast(), len)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())
            .map_or(ptr::null_mut(), |text| owned(ontos_data::encode_text(text)))
    })
}

/// Ontos's integer embedding.
#[no_mangle]
pub extern "C" fn thesmos_value_int(n: i64) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || owned(ontos_data::encode_int(n.into())))
}

/// Ontos's boolean embedding.
#[no_mangle]
pub extern "C" fn thesmos_value_bool(b: bool) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || owned(ontos_data::encode_bool(b)))
}

/// Decodes canonical Ontos bytes; null if they are not a canonical encoding.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_decode(data: *const u8, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        input(data, len).and_then(|bytes| ontos_codec::decode(bytes).ok()).map_or(ptr::null_mut(), owned)
    })
}

/// Writes the value's canonical Ontos bytes to `out`; false (and nothing written) on null input.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_encode(handle: *const ThesmosValue, out: *mut ThesmosBuffer) -> bool {
    guard(false, || match value(handle) {
        Some(value) if !out.is_null() => {
            out.write(buffer(&ontos_codec::encode(value)));
            true
        }
        _ => false,
    })
}

/// An independent copy of the value; null on null input.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_clone(handle: *const ThesmosValue) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || value(handle).map_or(ptr::null_mut(), |value| owned(value.clone())))
}

/// Structural equality; false if either is null.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_equal(a: *const ThesmosValue, b: *const ThesmosValue) -> bool {
    guard(false, || matches!((value(a), value(b)), (Some(a), Some(b)) if a == b))
}

/// Whether the value is an atom (otherwise it is a tuple); false on null input.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_is_atom(handle: *const ThesmosValue) -> bool {
    guard(false, || value(handle).is_some_and(Value::is_atom))
}

/// An atom's bytes, borrowed from the value; null data if it is not an atom.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_atom_bytes(handle: *const ThesmosValue) -> ThesmosBytes {
    let absent = ThesmosBytes { data: ptr::null(), len: 0 };
    guard(absent, || match value(handle).and_then(Value::as_atom) {
        Some(atom) => ThesmosBytes { data: atom.bytes().as_ptr(), len: atom.len() },
        None => ThesmosBytes { data: ptr::null(), len: 0 },
    })
}

/// A tuple's arity; 0 for an atom or null input (use `thesmos_value_is_atom` to tell them apart).
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_tuple_len(handle: *const ThesmosValue) -> usize {
    guard(0, || value(handle).and_then(Value::as_tuple).map_or(0, |tuple| tuple.len()))
}

/// A copy of a tuple's item; null for an atom or an index out of range.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_tuple_item(handle: *const ThesmosValue, index: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        value(handle)
            .and_then(Value::as_tuple)
            .and_then(|tuple| tuple.at(index))
            .map_or(ptr::null_mut(), |item| owned(item.clone()))
    })
}

/// Reads Ontos's text embedding into `out` as UTF-8; false if the value is not one.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_read_text(handle: *const ThesmosValue, out: *mut ThesmosBuffer) -> bool {
    guard(false, || match value(handle).and_then(|value| ontos_data::read_text(value).ok()) {
        Some(text) if !out.is_null() => {
            out.write(buffer(text.as_bytes()));
            true
        }
        _ => false,
    })
}

/// Reads Ontos's integer embedding; false if the value is not one or does not fit in 64 bits.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_read_int(handle: *const ThesmosValue, out: *mut i64) -> bool {
    guard(false, || {
        let n = value(handle).and_then(|value| ontos_data::read_int(value).ok()).and_then(|n| i64::try_from(n).ok());
        match n {
            Some(n) if !out.is_null() => {
                out.write(n);
                true
            }
            _ => false,
        }
    })
}

/// Reads Ontos's boolean embedding; false if the value is not one.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_read_bool(handle: *const ThesmosValue, out: *mut bool) -> bool {
    guard(false, || match value(handle).and_then(|value| ontos_data::read_bool(value).ok()) {
        Some(b) if !out.is_null() => {
            out.write(b);
            true
        }
        _ => false,
    })
}

/// Releases a value; null is ignored.
#[no_mangle]
pub unsafe extern "C" fn thesmos_value_free(handle: *mut ThesmosValue) {
    if !handle.is_null() {
        guard((), || drop(Box::from_raw(handle)));
    }
}

/// Releases a buffer's bytes and empties it; null is ignored.
#[no_mangle]
pub unsafe extern "C" fn thesmos_buffer_free(out: *mut ThesmosBuffer) {
    if let Some(out) = out.as_mut() {
        if !out.data.is_null() {
            guard((), || drop(Box::from_raw(ptr::slice_from_raw_parts_mut(out.data, out.len))));
        }
        *out = EMPTY;
    }
}

// --- Spaces values ------------------------------------------------------------------------

/// A Logos symbol: the atom of the name's UTF-8 bytes; null if the name is not valid UTF-8.
#[no_mangle]
pub unsafe extern "C" fn thesmos_symbol(name: *const c_char, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        input(name.cast(), len)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())
            .map_or(ptr::null_mut(), |name| owned(thesmos::symbol(name)))
    })
}

/// A labeled Logos compound: the tuple (name, args...). The name's bytes are taken as given;
/// null if the name is not valid UTF-8 or an argument is null.
#[no_mangle]
pub unsafe extern "C" fn thesmos_fact(
    name: *const c_char,
    name_len: usize,
    args: *const *const ThesmosValue,
    len: usize,
) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        let name = input(name.cast(), name_len).and_then(|bytes| std::str::from_utf8(bytes).ok());
        match (name, values(args, len)) {
            (Some(name), Some(args)) => owned(thesmos::fact(name, args)),
            _ => ptr::null_mut(),
        }
    })
}

/// Logos's [Head|Tail] list of copies of `items`; null if any item is null.
#[no_mangle]
pub unsafe extern "C" fn thesmos_list(items: *const *const ThesmosValue, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || values(items, len).map_or(ptr::null_mut(), |items| owned(thesmos::list(items))))
}

/// A space path of the segments' exact bytes; null if a non-empty segment has null data.
#[no_mangle]
pub unsafe extern "C" fn thesmos_path(segments: *const ThesmosBytes, len: usize) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || {
        let segments: Option<Vec<&[u8]>> = if len == 0 {
            Some(Vec::new())
        } else if segments.is_null() {
            None
        } else {
            slice::from_raw_parts(segments, len).iter().map(|segment| input(segment.data, segment.len)).collect()
        };
        segments.map_or(ptr::null_mut(), |segments| owned(thesmos::path(segments)))
    })
}

/// The authorized(actor, statement, space) compound a query asks for; null on null input.
#[no_mangle]
pub unsafe extern "C" fn thesmos_authorization(
    actor: *const ThesmosValue,
    statement: *const ThesmosValue,
    space: *const ThesmosValue,
) -> *mut ThesmosValue {
    guard(ptr::null_mut(), || match (value(actor), value(statement), value(space)) {
        (Some(actor), Some(statement), Some(space)) => {
            owned(thesmos::authorization(actor.clone(), statement.clone(), space.clone()))
        }
        _ => ptr::null_mut(),
    })
}

/// The law digest a proof must name: the executable law and assertion construction.
#[no_mangle]
pub extern "C" fn thesmos_law_digest() -> *mut ThesmosValue {
    guard(ptr::null_mut(), || owned(Value::atom(thesmos::law_digest())))
}

/// The space-asserter layer digest a proof must name.
#[no_mangle]
pub extern "C" fn thesmos_layer_digest() -> *mut ThesmosValue {
    guard(ptr::null_mut(), || owned(Value::atom(thesmos::layer_digest())))
}

/// This library's version, a static NUL-terminated string.
#[no_mangle]
pub extern "C" fn thesmos_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr().cast()
}

// --- Verification -------------------------------------------------------------------------

/// A verifier under `root` that authenticates bundles with `authenticate`; null if either is
/// null. It has no temporal policy and runs no search.
#[no_mangle]
pub unsafe extern "C" fn thesmos_verifier_new(
    root: *const ThesmosValue,
    authenticate: ThesmosAuthenticate,
    context: *mut c_void,
) -> *mut ThesmosVerifier {
    guard(ptr::null_mut(), || {
        let (Some(root), Some(function)) = (value(root), authenticate) else {
            return ptr::null_mut();
        };
        let callback = Callback { function, context };
        let authenticate = move |bundle: &thesmos::Bundle, supplier: &Value| callback.authenticate(bundle, supplier);
        Box::into_raw(Box::new(ThesmosVerifier(thesmos::Verifier::new(root.clone(), authenticate))))
    })
}

/// A verifier under `root` that authenticates bundles with archon's Ed25519ph domain
/// signatures (domain `thesmos/space-facts/v1`); null if root is null.
#[no_mangle]
pub unsafe extern "C" fn thesmos_verifier_new_archon(root: *const ThesmosValue) -> *mut ThesmosVerifier {
    guard(ptr::null_mut(), || {
        value(root).map_or(ptr::null_mut(), |root| {
            Box::into_raw(Box::new(ThesmosVerifier(thesmos::Verifier::new(
                root.clone(),
                thesmos::archon::authenticate,
            ))))
        })
    })
}

/// Releases a verifier; null is ignored.
#[no_mangle]
pub unsafe extern "C" fn thesmos_verifier_free(verifier: *mut ThesmosVerifier) {
    if !verifier.is_null() {
        guard((), || drop(Box::from_raw(verifier)));
    }
}

/// Checks `proof` (canonical Ontos bytes) for exactly the query: may `actor` assert `statement`
/// in `space`? Writes the decision to `out` and returns true. Returns false, writing nothing, only
/// when an argument is null. Every failure of the proof is a decision that denies, including a
/// panicking callback.
#[no_mangle]
pub unsafe extern "C" fn thesmos_verify(
    verifier: *const ThesmosVerifier,
    actor: *const ThesmosValue,
    space: *const ThesmosValue,
    statement: *const ThesmosValue,
    proof: *const u8,
    proof_len: usize,
    out: *mut ThesmosDecision,
) -> bool {
    let (Some(verifier), Some(actor), Some(space), Some(statement), Some(proof)) =
        (verifier.as_ref(), value(actor), value(space), value(statement), input(proof, proof_len))
    else {
        return false;
    };
    if out.is_null() {
        return false;
    }
    // Written through the pointer: the caller's decision may be uninitialized.
    out.write(
        catch_unwind(AssertUnwindSafe(|| {
            let query = thesmos::Query { actor: actor.clone(), space: space.clone(), statement: statement.clone() };
            let decision = verifier.0.verify(&query, proof);
            ThesmosDecision {
                permitted: decision.permitted,
                checked_steps: decision.checked_steps as u64,
                code: buffer(decision.code.as_bytes()),
                detail: buffer(decision.detail.as_bytes()),
            }
        }))
        .unwrap_or_else(|_| ThesmosDecision {
            permitted: false,
            checked_steps: 0,
            code: buffer(b"invalid-proof"),
            detail: buffer(b"verification panicked"),
        }),
    );
    true
}

/// Releases a decision's code and detail; null is ignored.
#[no_mangle]
pub unsafe extern "C" fn thesmos_decision_free(decision: *mut ThesmosDecision) {
    if let Some(decision) = decision.as_mut() {
        thesmos_buffer_free(&mut decision.code);
        thesmos_buffer_free(&mut decision.detail);
        decision.permitted = false;
        decision.checked_steps = 0;
    }
}
