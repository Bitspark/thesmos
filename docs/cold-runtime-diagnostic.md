# Temporary cold runtime diagnostic

The `runtime-base-incremental-diagnostic` branch is an auxiliary diagnostic,
composing temporary source `49c9c5316686a49135d2fed909505efdba90737c` with the
reviewed incremental source capture from product commit
`db0766e68c07dd780df93895ea7dc1e321b9a687`. It must not be merged or published as a
product change. The frozen law and authority adapter are unchanged.

The source-capture implementation, five acquisition controls and runtime
documentation remain byte-identical to that product commit. This temporary
extension adds request scopes and transport observations to the earlier runtime
hooks and primitive failure writer. Its paired Logos source is
`c35569a0529b36267f32e701d302fa072efb32b9`, which includes the reviewed request
phase instrumentation, digest and immutable composition changes, and remote
formatting. The current remote diagnostic census requires six native guest
controls, three Logos factory controls, ten Logos host diagnostic controls and
eleven Thesmos diagnostic controls. Their execution for this composition is
pending. The ordinary candidate package check in run `39794197694` passed all
116 core cases, including the five
acquisition controls, against product Logos `2c248515`; it does not validate
this temporary composition or establish memory fit.

The preceding native-only probe `39795344738`, using Thesmos `49c9c531` and
Logos `01ce03c3ca11643fe480b11d9bc1856df3fd35a4`, completed program and base
preparation, then aborted with V8 heap exhaustion after its first
`request-admission-start` checkpoint. It recorded zero of 100 request results.
That immutable failure remains separate from the next combined-source probe.
That earlier composition changed no heap, guest ceiling, budget or request
denominator. Probe `39807218357` subsequently completed cold native preparation
and failed during the first request with a guest allocation trap at 4,096 pages.
JavaScript survived to record one incomplete result and zero decisions. Its
native codes covered cold preparation only, so its request interval does not
isolate inference or establish the failing request subphase. Those immutable
receipts precede this expanded diagnostic grammar and cannot validate it.

The diagnostic includes the separately reviewed encoded-source replacement from
product commit `d8b98c478e0af9b853d09a373c1296f80ab75243` and its strengthened
mutation control `70d778fbd8bb90029761ed79768d1f49be7053c3`. Those product changes
formed the earlier encoded-source diagnostic. Earlier probe artifacts
continue to identify their earlier source; they are not measurements of this
storage change. Probe `39679135506` measured this composite at diagnostic source
`4d081bbe8b93a22369e259370af1014a9ed65778` and Logos
`25580fb700b883c47d7a884ed64d2bed8aa93386`. It completed `Session.open` and then
exhausted JavaScript heap inside awaited preparation before any request ran.

The narrower follow-up adds a temporary `PreparedViewFactory` wrapper. Its
`factory-prepare:start` checkpoint runs after the owner's isolation capture and
before delegating to the actual factory receiver. Completion and failure markers
await that same operation. The exact input, resolved runtime and rejection object
are forwarded; the wrapper neither closes nor retains the runtime. It stores no
source graph in telemetry and does not change operation order or the product
source. The original probe remains a separate immutable baseline. The next run
must identify its exact diagnostic and logos revisions, Node `24.22.0` and
default heap. Probe `39683230748` at logos `3489763a4feee934bf288d68896df15bc19902f8`
passed the owner capture and returned a guest allocation failure inside the
factory at the declared 4,096-page limit. It completed no request.

The next temporary paired logos diagnostic distinguishes its actual searcher
load, `program_open` and `base_open` calls. During the factory operation only,
this wrapper installs the private symbol `logos.prepared.factory.phase-diagnostic`
and routes its fixed scalar events through the existing source-bound sink. It
restores the exact previous property descriptor only while it still owns that
property. Installation, ownership or restoration failures invalidate telemetry
without changing the factory result or error. The sink closes over a numeric
activation ID only and stores no program, input, factory or returned runtime.
The temporary hook is neither an exported product API nor release source.

Probe `39719731564` at paired logos source
`331afe787aa826d81931d029251839f849510da1` still failed inside `program_open`
at the unchanged 4,096-page ceiling, before `base_open` or any query. The next
temporary diagnostic adds a separate `logos.prepared.native-phase-diagnostic`
sink. After the trapped call's cleanup, the paired host reports only a scalar
status and the last guest stage: 0 not entered, 1 entry, 2 wire decode, 3 envelope
read, 4 program parse, 5 envelope drop, 6 rule copy, 7 compile/index, 8 program
digest, 9 publication, 10 program reply, 11 reply encoding, or 12 complete.
The base extension appends 13 base payload, 14 base bindings, 15 base options,
16 base session open, 17 base preparation, 18 base snapshot, 19 base publication
and 20 base reply. This request extension preserves codes 0–20 and appends:

| Code | Fixed label | Code | Fixed label |
| --- | --- | --- | --- |
| 21 | `request-payload` | 30 | `admit-payload` |
| 22 | `request-bindings` | 31 | `admit-options` |
| 23 | `request-facts` | 32 | `admit-prepare` |
| 24 | `request-fragments` | 33 | `admit-engine` |
| 25 | `request-instantiate` | 34 | `admit-result` |
| 26 | `request-effective` | 35 | `admit-manifest` |
| 27 | `request-snapshot-limits` | 36 | `admit-manifest-copy` |
| 28 | `request-publication` | 37 | `admit-publication` |
| 29 | `request-reply` | 38 | `admit-reply` |

Codes identify categorical stores, not ordered progress: the owned reader drops
its wrapper (5) before parsing entries (4). Code 33 covers the whole native
admission call; it is not an inference-only duration. The scalar is the last
store on the exact trapped instance. There is no per-call nonce or reset before
the export, so a trap before the current call reaches ENTRY can leave an earlier
call's store. The scalar alone does not prove entry by the current call.
Only an `observed` event may carry an integer from 0 through 38. `unavailable`,
`read-failed` and `invalid` carry no stage; none may imply where the guest stopped.

The sink emits one `logos-native-prepared` observation with a fixed stage label.
It does not emit a start or end event for that stage, measure stage duration,
or receive an input, exception or runtime graph. Its property has independent
ownership and exact-descriptor restoration; failures remain observational and
invalidate telemetry without changing results, errors or cleanup. The original
factory hook retains its prior grammar. All paired source controls must run
remotely before this observation can be interpreted; adding the sink does not
establish a successful profile.

The separate `logos.prepared.operation-diagnostic` hook records the prepared
operation observed at the actual transport invocation. It accepts exactly three
primitive arguments and emits `logos-prepared-operation:observed` with detail
`operation=<operation>; transportPhase=<phase>; outcome=<outcome>`. The closed
operation set is `program_open`, `base_open`, `request_open`, `admit`, `execute`,
`materialize`, `close`, `diagnostics` and `unknown`. The closed phase set is
`guards`, `encode`, `post-encode-guards`, `input-buffer`, `export-call`, `reply`
and `complete`. Only `complete` pairs with `returned`; every other phase pairs
with `threw`. Unknown strings, invalid pairs, missing or extra arguments
invalidate telemetry without inspecting an extra source value.

An `export-call` failure reports the attempted call boundary, not proof that the
guest entered it. `reply` means the export returned before reply processing
failed. `complete` means the transport returned; a typed refusal or later client
decode failure can still follow. The paired host observes after buffer cleanup
and solver release. Its initial reentrancy guard remains outside this observer.
Native and transport callbacks can interleave with callback reentry, so adjacency
does not authenticate a call association. Neither channel grants logical authority.

`SpacesRuntime.request` keeps the native and operation sinks active through its
actual lease await and any admission-read/constructor cleanup, then restores
their exact previous descriptors. The sink closures retain only the numeric
activation and primitive labels, never the request or source graph. A shared
scalar ownership guard invalidates overlapping factory/request scopes in either
completion order. It leaves the active sinks in place and lets the original
operation settle unchanged; it does not treat those overlapping observations as
valid measurements. Sink installation, ownership, restoration and I/O failures
remain separate diagnostic failures and preserve the original result or error.

The clean-product current-scale attempt in run `39761837475`, at Logos
`79bca64e796a96b21d8ab4a7575177b4dd37d2d5` and product Thesmos `70d778f`,
completed isolated source capture but failed during runtime creation with
`session_stale`. That receipt contains no native stage or original trap and
does not establish its cause. Its separately reviewed product cleanup correction
must precede the next paired diagnostic source; this branch does not supply that
correction or classify the missing original failure.

Failed synchronous phases, factory preparation, owner preparation and requests
record bounded primitive error fields at their existing failure boundaries. The
request wrapper observes rejection after the request's internal cleanup. Data descriptors supply
name, message, stack, observed classification and stack-exhaustion flag; getters
are not invoked. String prefixes are capped at 128, 4,096, 16,384 and 1,024 code
units respectively. At most four object levels are copied; cycles, deeper causes
and inaccessible objects receive fixed markers. No exception or cause object,
program, query or context is retained. These records preserve the thrown object's
identity and do not replace the ordinary exception with a logging error. The
supervisor checks the exact bounded grammar and keeps the first recorded failure
separate from the last native observation; neither is an allocation measurement.
Actual writer controls cover all 39 stage labels and the primitive failure chain,
including hostile getters, cycles, depth and size bounds, before a probe may run.
The five added Thesmos controls cover all 63 valid operation/phase pairs and
invalid arity or labels, pending async lifetime, exact descriptor restoration,
ownership replacement, overlap in both completion orders, and an actual
`SpacesRuntime.request` with a forwarded lease await and failing admission read.
That last control requires real native request/admission/close observations,
the original error identity, and absence of the query marker from every record.

The explicit remote Nightyard `profile-current` route records checkpoints around
configuration capture, authenticated source capture, defensive native program
decoding, `Session.open`, factory creation and asynchronous preparation. It also
records replacement and request phases if execution reaches them. Records
identify the exact
Logos and Thesmos source pins, build receipt and run, together with process memory,
peak RSS, CPU use and actual V8 heap limit. A separate supervisor retains the file
when V8 aborts before an operation can write its closing checkpoint.
Checkpoint failures cannot throw into product execution or prevent cleanup. They
set a failing diagnostic process exit and attempt a separate failure sidecar/log;
the supervisor rejects that measurement even when product execution completes.

No heap setting or runtime budget changes. No source graph escapes, source is
not pre-evaluated, and the caller's authority decision still uses the ordinary
runtime. Checkpoint writes add diagnostic overhead; these intervals are not
production latency measurements or qualification evidence. The next artifact
must report its own source pins, rather than being labelled as the previous
uninstrumented runtime.
