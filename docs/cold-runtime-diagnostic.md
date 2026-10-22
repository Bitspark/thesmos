# Temporary cold runtime diagnostic

The `runtime-base-phase-diagnostic` branch is an auxiliary diagnostic, based on
the earlier temporary source `8e67585aa9a4b20ea5461f615eae17654a05e1ab` and the
reviewed product runtime at `70d778fbd8bb90029761ed79768d1f49be7053c3`. It must not be
merged or published as a product change. The frozen law and authority adapter
are unchanged.

The diagnostic includes the separately reviewed encoded-source replacement from
product commit `d8b98c478e0af9b853d09a373c1296f80ab75243` and its strengthened
mutation control `70d778fbd8bb90029761ed79768d1f49be7053c3`. Only those product
changes were cherry-picked into this diagnostic branch. Earlier probe artifacts
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
The current extension appends 13 base payload, 14 base bindings, 15 base options,
16 base session open, 17 base preparation, 18 base snapshot, 19 base publication
and 20 base reply. Codes are categorical last-entered labels, not ordered progress:
the current owned reader drops its wrapper (5) before parsing entries (4).
Only an `observed` event may carry an integer in that range. `unavailable`,
`read-failed` and `invalid` carry no stage; none may imply where the guest stopped.

The sink emits one `logos-native-prepared` observation with a fixed stage label.
It does not emit a start or end event for that stage, measure stage duration,
or receive an input, exception or runtime graph. Its property has independent
ownership and exact-descriptor restoration; failures remain observational and
invalidate telemetry without changing results, errors or cleanup. The original
factory hook and the product source are unchanged. Both paired source controls
must run remotely before this observation can be interpreted; no new profile has
been dispatched by adding the sink.

The clean-product current-scale attempt in run `39761837475`, at Logos
`79bca64e796a96b21d8ab4a7575177b4dd37d2d5` and product Thesmos `70d778f`,
completed isolated source capture but failed during runtime creation with
`session_stale`. That receipt contains no native stage or original trap and
does not establish its cause. Its separately reviewed product cleanup correction
must precede the next paired diagnostic source; this branch does not supply that
correction or classify the missing original failure.

Failed synchronous phases, factory preparation and owner preparation now also
record bounded primitive error fields before cleanup. Data descriptors supply
name, message, stack, observed classification and stack-exhaustion flag; getters
are not invoked. String prefixes are capped at 128, 4,096, 16,384 and 1,024 code
units respectively. At most four object levels are copied; cycles, deeper causes
and inaccessible objects receive fixed markers. No exception or cause object,
program, query or context is retained. These records preserve the thrown object's
identity and do not replace the ordinary exception with a logging error. The
supervisor checks the exact bounded grammar and keeps the first recorded failure
separate from the last native observation; neither is an allocation measurement.
Actual writer controls cover all 21 stage labels and the primitive failure chain,
including hostile getters, cycles, depth and size bounds, before a probe may run.

The explicit remote Nightyard `profile-current` route records checkpoints around
configuration capture, authenticated source capture, defensive native program
decoding, `Session.open`, factory creation and asynchronous preparation. It also
records replacement phases if execution reaches them. Records identify the exact
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
