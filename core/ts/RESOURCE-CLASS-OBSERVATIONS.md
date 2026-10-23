# Requested-layout observation transport

This source candidate for Logos issue3851 starts at the measured Thesmos
`b2c21ea424878c66d8ae4dc55b22b1cbf3ddfa9d`. It replaces the paired private inner
record with `logos/prepared-resource-observation/3`, carrying exactly8,960 u32
words (35,840 bytes) from the new raw guest schema2. No old-length/schema fallback
is accepted. The outer Thesmos envelope stays unchanged because it already binds
source, run, process, instance generation and the nested record.

The copier detaches every word, including both requested-layout matrices and the
first-failure anchor. It does not interpret u64 words through Number, classify
allocator blocks, or infer ownership. Aggregate/association booleans retain their
original scope: a class fault or invalid table can remain alongside valid
aggregate counters. The independent artifact reader must validate class shape,
closed sequences, own failure anchors and exact sums against the selected source.

The existing focused runtime diagnostic suite gains one detached-tail/class-fault
control and clean-replacement length/schema negatives. This is source only;
remote type checks, tests, paired guest/host qualification and artifact admission
are pending. No source policy, capture selector, package publication or execution
is activated by this candidate.

## Selected retention contract (source checkpoint)

The selected profiling sink keeps these three literal members in the existing
64 MiB resource budget. The source implementation and focused controls await
independent review and remote qualification, not an activated capture policy.

| Member | Bound and meaning |
| --- | --- |
| `runtime-resources.ndjson` | At most 82 contiguous complete original outer rows, each at most 803,967 UTF-8 bytes including its LF. |
| `runtime-resources-first-allocation-failure.json` | At most one complete original outer row including LF, only when the immutable selected observation is outside the retained prefix. The row keeps its original sequence. |
| `runtime-resources-coverage.json` | At most 65,536 UTF-8 bytes including LF; closed retention metadata, never allocation tables or a product outcome. |

The combined ceiling is 66,794,797 bytes, below 67,108,864. No global quota,
ordinary private `/3` maximum of 16 exports, allocator cap, or guest behavior
changes. The selected sink refuses more than four exports; it never truncates
them. It validates the ordinary detached record, exact outer fields and scalar
encodings, then independently checks the complete encoded row bound. The outer
row remains `thesmos/prepared-resource-observation/1` with the complete 8,960-word
arrays. Rejected callbacks create an explicit retention gap. A broken prefix is
never resumed; later valid rows may only supply the separately indexed failure.

The coverage format is `thesmos/prepared-resource-retention/1`. Its exact root
keys are `format`, `status`, `binding`, `limits`, `prefix`, `firstAllocationFailure`,
`observed`, `faults`, `finalization`, and `authority`:

- `status` is `recording`, `complete`, `partial`, or `failed`. Complete describes
  retention through the observed exit callback, not workload success, class
  validity, all instances, or an enclosing resource limit.
  It requires no omission, rejected callback, sequence gap or write fault and
  an observed exit. Exactly 82 rows can be complete; an omitted 83rd row makes
  coverage partial even after successful finalization.
- `binding` has `source` (exact `logos`, `thesmos`), `run`,
  `buildReceiptSha256`, `captureId`, `configurationSha256`, `executionClass`,
  `pid`, and `timeOriginMs`; these equal every accepted outer row.
- `limits` has the fixed `rowBytes:803967`, `prefixRows:82`,
  `coverageBytes:65536`, and `combinedBytes:67108864`.
- `prefix` has `member`, `rows`, `bytes`, `sha256`, `firstSequence`,
  `lastSequence`, `stop`, `partialTailBytes`, and `records`. Its byte/hash pair
  describes only the complete prefix, even after a failed partial write.
  `records` contains at most 82 exact `{sequence,offset,bytes,sha256}` references,
  including each row's LF. Empty sequence endpoints are null. `stop` is null,
  `row-limit`, `invalid-row`, `sequence-gap`, or `write-failed`.
  `partialTailBytes` is zero when no write failed, or a nonnegative measured
  suffix size or null when that size could not be read. Readers must preserve
  this suffix as failed evidence, never parse it as a complete prefix row.
- `firstAllocationFailure` has `status` (`not-observed`, `retained`, or
  `unavailable`), `selection`, `reference`, `earliest`, and
  `eligibleObservationsAfterSelection`. Selection/reference are null until
  selected; a failed reserve write keeps the selection and a null reference.
  The reference has `{member,offset,bytes,sha256}`. It points either into the
  exact prefix or to offset zero in the separate fixed member, never to a
  fabricated contiguous suffix.
- `selection` has `outerSequence`, `activation`, `lifecycle`, `searcher`,
  `generation`, `hostCall`, `guestWindow`, `guestSha256`, `export`, `snapshot`,
  and `anchor`. `export` is `{name,ordinal,edge}` with edge `before` or `after`.
  `snapshot` is `{status,reason,association,memoryPages,aggregateValid,
  associationValid,wordsSha256}`. The snapshot digest is SHA256 of all words
  encoded as little-endian u32. `anchor` is `{wordOffset:4608,wordCount:128,
  words,sha256}`; its digest uses the same encoding. It retains its own count,
  byte, sequence, attempt, context, page and validity anchors, not current
  counters. The anchor JSON is bounded to 2 KiB.
- `earliest` is `{status,limitations}` where status is `observed-order` or
  `limited`. Its fixed limitation codes are `rejected-row`,
  `unreadable-snapshot`, `unbound-snapshot`, `invalid-latch`, and
  `disabled-observation`. They record earlier uncertainty; they do not turn
  selected data into the process's primary failure.
- `observed` has `callbacks`, `validRows`, `invalidRows`, `omittedRows`,
  `firstSequence`, `lastSequence`, `unavailableSnapshots`, and
  `ineligibleLatches`. Counts are checked safe integers, not unbounded lists.
- `faults` is a deduplicated fixed-code array: `selected-row-invalid`,
  `sequence-invalid`, `prefix-write-failed`, `reserve-write-failed`,
  `coverage-write-failed`, `finalize-failed`, or `counter-overflow`.
- `finalization` is `{status,exitCode}`, with `pending`/null until the actual
  synchronous exit callback, then `exit-observed` and its nonnegative exit
  code. Abrupt termination leaves pending or unavailable coverage.
- `authority` has the literal values
  `selection:"earliest-observed-eligible-lifetime-latch"`,
  `classValidation:"not-performed"`, `productOutcome:"not-assessed"`, and
  `coverage:"contiguous-prefix-plus-at-most-one-noncontiguous-row"`.

The sink selects in actual outer sequence, then export ordinal, then before/
after order. It does not reorder the retained row. An eligible observation has
the selected source/module/unchanged instance and accepted window/export
association, raw schema-2 framing, and a published first-lifetime latch whose
own closed failed alloc/zero/realloc attempt and sequences agree with its
original first-failure slot. The latch may originate in an earlier export;
its own context is retained separately from the export that observed it.
Class-table sums and class/aggregate validity are **not** selection gates:
invalid class evidence is still retained with its own flags for independent
analysis. A thrown export without such a latch is not enough. Once selected,
neither a later failure nor another instance can replace it. Later eligible
observations are counted, not represented as all-instance coverage.

Every successful callback checkpoints bounded coverage. Finalization settles
the coverage through the actual exit callback. Read/write/close failures remain
separate diagnostic failures; no sink operation replaces a product exception
or prevents cleanup. Independent readers must verify all raw references and
join the diagnostic failure sidecar and final process status: a last persisted
checkpoint cannot attest a later failed coverage close or an unwritable update.
Outer artifact custody must hash the entire physical prefix file including a
failed opaque suffix; its whole-file hash is not the complete-prefix hash.
No temporary files or unbounded failed-write member names are created. Readers
must recompute eligibility. Per-instance epoch processing still uses actual export
ordinals through a bounded index/replay pass, not NDJSON completion order;
noncontiguous evidence cannot form a cross-gap interval.
