# Temporary cold runtime diagnostic

The `runtime-cold-phase-diagnostic` branch is an auxiliary diagnostic, based on
the reviewed runtime at `4ee59b39a287c4a8b69f4a66756f6332abadb638`. It must not be
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
must identify this new diagnostic revision and use the same Logos pin, Node
`24.22.0` and default heap.

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
