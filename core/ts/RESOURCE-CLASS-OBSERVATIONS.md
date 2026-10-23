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
