# Temporary cold runtime diagnostic

The `issue-3842-runtime-observation` branch is an auxiliary diagnostic based on
measured Thesmos source `593e676b21148978c6875ad8e93a927ea11535ed`. It adapts the
existing temporary runtime hooks to the accepted research 0046 observation plan.
It must not be merged or published as a product change. The frozen law,
authentication and source acquisition are unchanged.

The source-capture implementation, five acquisition controls and runtime
documentation remain byte-identical to that product commit. This temporary
predecessor added request scopes and transport observations to the earlier runtime
hooks and primitive failure writer. Its paired Logos source was
`c35569a0529b36267f32e701d302fa072efb32b9`, which included the reviewed request
phase instrumentation, digest and immutable composition changes, and remote
formatting. That composition's remote diagnostic census required six native guest
controls, three Logos factory controls, ten Logos host diagnostic controls and
eleven Thesmos diagnostic controls. The present composition additionally requires
the resource controls described below and its exact paired host/guest source
receipts; those remote checks are pending. The ordinary candidate package check
in run `39794197694` passed all
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

The paired logos diagnostic distinguishes its actual searcher load,
`program_open` and `base_open` calls. The explicit outer preparation scope
installs the private symbol `logos.prepared.factory.phase-diagnostic`
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

The `create` and `replace` scopes keep the native and operation sinks active
through their existing preparation, publication and cleanup. Factory-entry
checkpoints remain inside those scopes after the Session's defensive capture;
the factory adapter does not acquire a second global ownership scope.
`SpacesRuntime.request` keeps the same sinks active through its actual lease
await and admission-read/constructor cleanup. Subsequent `request-execute`,
`witness-export`, `request-close`, `witness-close`, `extra-witness-close` and
`runtime-close` operations have separate scopes. Explicit public diagnostics
calls have `request-diagnostics`, `witness-diagnostics` and `runtime-diagnostics`
scopes; the instrumentation does not introduce any new guest diagnostics call.

These are narrow diagnostic operation windows. `request-execute` covers the
actual Logos execution call and ends before optional proof export/check;
Nightyard's public `run()` and whole-lifecycle timers retain their wider scope.
Synchronous close stays synchronous, and each existing catch/finally cleanup
runs in its original order. Exact prior descriptors are restored on settlement.
The sinks retain only activation IDs, fixed labels and bounded observation data,
never the request or source graph. A shared scalar ownership guard invalidates
unrelated nested and asynchronous overlapping scopes in either completion order.
It leaves the active sinks in place and lets each original operation settle
unchanged. There is no implicit nested-scope borrowing capability. Installation,
ownership, restoration and I/O failures remain separate diagnostic failures.

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

## Research 0046 resource observations

This temporary adaptation forwards the paired host's
`logos/prepared-resource-observation/2` records through the private
`logos.prepared.resource-observer` symbol. An explicit
`PREPARED_RESOURCE_OBSERVER_MODE=minimal` or `compiled-disabled` installs the
matching own data property at `logos.prepared.resource-observer.mode` before
Searcher creation. The Searcher captures that mode for its lifetime, including
instance replacement. An absent environment value installs no mode descriptor
and remains a separate calibration arm. A foreign mode or sink descriptor in that arm
invalidates telemetry; it is not silently presented as absence. Prior accessors
are never invoked, and restoration preserves a changed successor descriptor.
A successor with the identical primitive value and descriptor is observationally
indistinguishable from the installed mode. The sink itself has function-identity
ownership. Node's `minimal-diagnostic` versus `focused-diagnostic` execution class
is independent of the guest mode; focused collection adds Node profilers without
changing either memory ceiling.

The host emits only after prepared input/output cleanup and active-solver
release. The adapter accepts exactly one fixed record and copies all containers
before writing `runtime-resources.ndjson`. It validates the closed labels and
field sets, finite scalar domains, at most 16 export records, at most four u32
arguments per export, and exactly 320 u32 words for observed/disabled guest
snapshots. Getters, array holes, extra fields, unknown export names and arbitrary
object serialization are refused. The export names are `logos_alloc`,
`logos_prepared` and `logos_dealloc`. Raw word pairs remain exact; this adapter
does not decode u64 counters, infer allocator owners, or turn logical handles
into bytes. Header, publication and association validation belong to the actual
host reader; its `status`, `reason`, `association`, `aggregateValid` and
`associationValid` are forwarded unchanged, independently of `collectorValid`
and the ordinary transport outcome. Invalid/unavailable observations remain
available to the supervisor rather than being relabelled successful samples.

The closed `hostMemory` object carries positive integer `limitPages`, wasm32
`pageBytes=65536` and their exact product `limitBytes`. The host binds this actual
effective import/getter selection to its Searcher/generation, including instances
replaced after traps. It is available without growth and with counters disabled;
it does not replace module-declared limits, observed extent or growth records.
The independent `preparedInput` object carries the actual guest input-guard
scalar with `observed/limitBytes/null`, or a null limit with the exact status/reason
pairs `unavailable/missing-export`, `unavailable/instance-not-bound`,
`invalid/invalid-scalar`, or `read-failed/export-threw`. No source-level constant
is filled in when that observation is unavailable. Extra/missing cap fields,
inconsistent page/byte arithmetic and status/value/reason conflicts are refused.
The old nested private schema has no fallback; the outer envelope remains version 1.

Each envelope has format `thesmos/prepared-resource-observation/1`, its own
sequence, the lifecycle activation/name, actual process ID, UTC timestamp and
`performance.now()`/`performance.timeOrigin` clock coordinates. It records the
actual remote run, exact Logos and Thesmos source revisions and build receipt
digest. `PREPARED_OBSERVATION_CAPTURE_ID` must be a lowercase UUIDv4;
`PREPARED_OBSERVATION_CONFIGURATION_SHA256` must be a lowercase SHA-256; and
`PREPARED_OBSERVATION_EXECUTION_CLASS` must name one of the two diagnostic classes.
The Nightyard helper supplies these values and independently recomputes the
configuration digest. They join collector records; they grant no source,
logical-result or guest-identity authority. The actual guest SHA, encoded wire
size/SHA, Searcher ordinal, instance generation, host-call/export/window ordinals,
clocks and first thrown export come only from the host record. No build receipt
substitutes for the actual guest hash. Forwarding validation/I/O time is outside
the host's `collectorWallMs`; it remains part of the wider diagnostic workload
and must be assessed by calibration, not subtracted without measurement.

The writer requires the actual Nightyard `profile-current` dispatch and source
context. Shape, mode, context and I/O failures mark the diagnostic process as
failed separately, while retaining the original returned value or thrown object
and executing ordinary cleanup. The resource stream is separate from phase
checkpoints and logical decisions. A fatal process may leave either stream
partial; no closing marker is synthesized. The supervisor must keep collector
completeness/validity separate from permitted, forbidden, refused or unfinished
logical outcomes.

Eight resource controls cover exact detached raw-word copying and all unavailable
statuses; hostile fields/getters/holes and bounds; absent mode, descriptor
restoration and rejected reentry; actual remote envelope/I/O failure handling;
a real law-only create/admit/execute/request-close/replacement/owner-close/old
witness export-and-check sequence; real absent/compiled-disabled Searcher
creation; and original close-error preservation through both native cleanup
calls when collection fails. The existing eleven phase/request controls remain.
Their execution and the paired host/guest controls must pass remotely before a
profile is interpreted. This source supplies instrumentation, not a completed
memory measurement, performance qualification or product remedy.
