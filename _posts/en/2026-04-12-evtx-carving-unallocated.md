---
layout: post
title: "EVTX Carving: Recovering Deleted Event Logs from Unallocated Space"
date: 2026-04-12 02:00:00 +0100
category: tools
lang: en
ref: tool-masstin-evtx-carving
tags: [masstin, carving, evtx, forensics, dfir, unallocated, recovery, tools]
description: "Masstin's carve-image action scans forensic disk images for EVTX chunks in unallocated space, recovering lateral movement events after attackers delete logs. A deep dive into the three tiers of EVTX carving and how masstin hardens itself against upstream parser bugs."
comments: true
---

## The last resort: when even VSS is gone

The attacker was thorough. They cleared every event log. They deleted the Volume Shadow Copies with `vssadmin delete shadows /all`. They even wiped the UAL databases. Your `Security.evtx` is empty, your VSS stores are gone, and there's nothing left to parse.

Or is there?

When Windows deletes a file, the data doesn't disappear from disk — the space is simply marked as "available" in the filesystem. The actual bytes — including complete EVTX chunks — remain on disk until they're overwritten by new data. **Masstin's `carve-image` scans the raw disk for these remnants and recovers them, feeds them through the normal parsing pipeline, and hands you a timeline indistinguishable from one built from live logs.**

This article is a deep dive into how that works: how EVTX files are laid out, the three theoretical tiers of EVTX carving, what masstin implements today, what we're leaving as future work, and the surprisingly painful real-world hurdles we hit along the way — including three new bugs we found and reported upstream in the `evtx` crate.

---

## How EVTX files are structured on disk

An EVTX file has a simple, regular layout:

```
[File Header - 4 KB] [Chunk 0 - 64 KB] [Chunk 1 - 64 KB] [Chunk 2 - 64 KB] ...
```

The **file header** identifies the file (`ElfFile\x00` magic), tracks the chunk count, and stores global metadata. The header is useful for reading an intact file, but crucially it is **not required to parse individual chunks**.

Each 64 KB chunk is self-contained and starts with the magic signature `ElfChnk\x00`. A chunk carries:

- Its own string table
- Its own template table (BinXML templates referenced by the records inside)
- One or more event records

This self-containment is what makes EVTX carving feasible. **A single chunk recovered from unallocated space can be parsed on its own**, even without the original file header, even without the other chunks, even if the sectors around it have been reused.

Each event record inside a chunk starts with the magic `\x2a\x2a\x00\x00` and follows this layout:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Magic: `0x2A2A0000` |
| 4 | 4 | Record size (u32) |
| 8 | 8 | Record ID (u64) |
| 16 | 8 | Timestamp (FILETIME) |
| 24 | var | BinXML event data |
| size-4 | 4 | Size copy (validation) |

This matters because three different strategies exist for recovering events, each operating at a different granularity.

---

## The three tiers of EVTX carving

Before looking at what masstin does, it's worth understanding the theoretical landscape. EVTX carving is usually described in three tiers, in increasing order of power and complexity.

### Tier 1 — Chunk carving

**What it recovers:** complete 64 KB EVTX chunks that survived intact on disk.

**How it works:** scan the disk (sequentially or only the unallocated extents) looking for the 8-byte `ElfChnk\x00` magic on a known alignment boundary. When a hit is found, read the full 64 KB, validate it as a parseable chunk, and hand it to a standard EVTX parser.

**Fidelity:** perfect. The recovered chunk contains its own string and template tables, so every record inside parses to full XML with all its substituted values. The events you get are identical to what `wevtutil` would have shown on a live system.

**What it misses:** any chunk that has been partially overwritten. Even a single damaged byte inside the 64 KB breaks validation, and Tier 1 discards it entirely.

**Cost:** very cheap. A single linear scan of the disk.

### Tier 2 — Orphan record scanning

**What it recovers:** individual event records that survived even when their parent chunk did not.

**How it works:** scan the disk looking for the `\x2a\x2a\x00\x00` record magic. For each hit, validate the header (size field sane, trailing size matches, BinXML preamble byte, timestamp plausible) to filter out coincidental matches. The records that pass validation are "orphans" — real EVTX records floating outside any recoverable chunk.

**Fidelity:** partial. The record header parses and gives you record ID, size, and timestamp. The **body** is BinXML — a compact binary encoding that substitutes values into templates stored in the chunk's template table. Without the parent chunk's template table, you can recover the record header and you can see that an event *existed*, but turning the BinXML body into a readable event (with its Event ID, provider, substituted fields, etc.) requires more work.

**What it provides today:** a count and the metadata you can extract from the header alone. This is enough to say "there were N extra events in unallocated space at these timestamps", which is itself useful evidence for timeline reconstruction.

**Cost:** cheap. Same single linear scan as Tier 1, with one extra magic pattern to match.

### Tier 3 — Template matching (the holy grail)

**What it recovers:** full XML from orphan records whose parent chunks are gone forever.

**How it works:** build a corpus of known BinXML templates — either from the chunks that did survive in the same image, from a library of common Windows templates collected from other systems, or from both. For each orphan record, walk its BinXML body, and for every template reference try to match it against templates in the corpus. When a match works, substitute the record's inline values into the template and render the XML just like the normal parser would.

**Fidelity:** variable. An orphan record for a Security 4624 logon on a Windows Server 2019 system is very likely to find a matching template in the corpus — those templates are stable across installs. A record for a niche provider or an unusual OS build may not find a match, leaving it partially decoded.

**Why it's hard:** BinXML is designed to be parsed *with its template table at hand*, not backwards from a partial record. You have to reimplement enough of the BinXML state machine to walk a record without blowing up on the first unknown token, you have to decide how to handle template hash collisions, and you have to build and maintain the template corpus.

**Cost:** not in the scan — one extra pass — but in the code and the template database.

---

## What masstin implements today

| Tier | Status in masstin |
|------|-------------------|
| **Tier 1** — chunk carving | **Implemented.** Full 64 KB chunks recovered, grouped by provider, parsed through the normal masstin pipeline into the unified CSV timeline. |
| **Tier 2** — orphan record detection | **Implemented (detection only).** Orphan records are found, validated, and counted. Header metadata is reported. Full XML reconstruction from the BinXML body is not done. |
| **Tier 3** — template matching | **Future work.** The design is clear and the corpus could be bootstrapped from Tier 1's output on the same image (use the recovered chunks' template tables to decode the orphan records), but this is not in the current release. |

The rationale for this ordering is simple: **Tier 1 gives you the overwhelming majority of the value for a fraction of the engineering cost.** In practice, on the images we tested, Tier 1 alone recovers tens of thousands of complete events. Tier 2's count is useful as corroborating evidence ("there were N more events than what Tier 1 could recover"). Tier 3 is where you go when you need every last byte, and on a real incident it is rarely the difference between catching the attacker and missing them.

---

## Tier 1 in masstin — from signature to timeline

The full pipeline is:

1. **Open the image.** For E01, masstin uses the `ewf` crate to read the logical disk view (decompressed bytes). For VMDK it uses its own reader that handles both `monolithicFlat` and `streamOptimized`. For raw `dd`/`001` it just opens the file.
2. **Scan in 4 MB blocks.** Each block is read sequentially into memory; no seeks, so spinning disks and network shares stay at read-ahead speed.
3. **Look for `ElfChnk\x00`.** The 8-byte magic is scanned for on 512-byte alignment inside each block.
4. **Validate the chunk.** When a signature is found, masstin reads the full 64 KB starting at the match and passes it to the `evtx` crate. A chunk that parses is kept; a chunk that fails is silently discarded.
5. **Extract the provider name.** Masstin parses the first record and reads its `Provider Name="..."` attribute. This determines which "synthetic EVTX file" the chunk will be written into.
6. **Group by provider.** All chunks with the same provider go into the same in-memory bucket — e.g., all Security-Auditing chunks together, all TerminalServices-LocalSessionManager chunks together, and so on.
7. **Build synthetic EVTX files.** For each bucket, masstin writes a file header (`ElfFile\x00` magic, chunk count, CRC32) followed by the concatenated 64 KB chunks. The result is a real, parseable `.evtx` file named after the provider it contains.
8. **Validate synthetic files.** Each synthetic file is opened in an isolated thread and walked end-to-end to detect crashes/hangs/OOMs before it reaches the main pipeline. More on this below — it turned out to be essential.
9. **Parse through the normal masstin pipeline.** The validated files are handed to `parse_events_ex` exactly as if they had been extracted from an NTFS filesystem. The same 32+ Event IDs, the same classification, the same CSV columns, the same graph loading.

The key consequence: **carved events are indistinguishable from live events in masstin's output.** They show up in the same timeline, in the same columns, ready for `load-memgraph` or `load-neo4j` like any other source.

---

## Tier 2 in masstin — orphan record scanning

During the same 4 MB block sweep, masstin also scans for `\x2a\x2a\x00\x00` record magic in bytes that are *not* inside a recovered Tier 1 chunk. Each candidate is validated:

- Size field is between 28 and 65024 bytes
- The trailing size copy (at `size-4`) matches the header size
- The BinXML preamble byte at offset 24 is `0x0F`
- The timestamp at offset 16 is a FILETIME inside the range 2000–2030

Records that pass all four checks are counted and reported in the final summary. Their header metadata (record ID, timestamp) is available for investigation. Their BinXML body is not yet rendered to XML — that's Tier 3.

On the images we tested, Tier 2 typically finds several times more orphan records than Tier 1 finds complete chunks. Most of those are records whose parent chunk has been partially overwritten — the first few kilobytes of the chunk are gone, the string/template tables are lost, but individual records later in the chunk are still intact. Tier 3 is exactly the tool for turning those counts into events.

---

## Tier 3 — future work

Template matching is the next milestone for masstin's carving. The plan:

1. On the same image, Tier 1 recovers complete chunks. Each surviving chunk contributes its template table to a local corpus.
2. Augment the corpus with a pre-built library of common Windows templates (Security, SMB, TerminalServices, WinRM, etc.) collected from known clean installs — these templates are stable across Windows versions.
3. For each Tier 2 orphan record, walk its BinXML body referring to the corpus. When every template referenced by the record has a match, render the full XML.
4. Feed the rendered XML back into masstin's normal event classification, so Tier 3 events land in the same timeline as Tier 1.

This is design work, not pure coding — the main questions are how aggressively to match against the corpus (strict hash equality vs. structural matching), how to report partially-decoded records, and how to version the template library. It is not in the current release, but the architecture is compatible with it.

---

## Surviving a hostile ecosystem: hardening against upstream bugs

Here is the part that surprised us. The `evtx` crate (omerbenamram/evtx, the de-facto Rust EVTX parser) is excellent for parsing well-formed logs from a live Windows system. It was never designed to deal with **arbitrary corrupted 64 KB buffers that claim to be chunks**, which is exactly what carving produces.

During development, we hit three distinct classes of bugs in the upstream parser:

### Bug 1 — Infinite loop on malformed BinXML

A carved chunk with a valid-looking `ElfChnk\x00` header and a sane record count would hang the parser indefinitely when we iterated its records. Not a crash, not a panic — just a silent infinite loop. Because it was a loop and not a panic, `std::panic::catch_unwind` was useless against it.

### Bug 2 — Multi-gigabyte allocation (≈14 GB) on corrupted template

A second chunk caused the parser to read a size field from a corrupted BinXML template and attempt to allocate a `Vec` of ~14 GB. On a 64 GB RAM machine this still aborted the whole process with `memory allocation of 14136377380 bytes failed`. Because an allocation abort in Rust is an abort, not a panic, again `catch_unwind` could not recover.

### Bug 3 — Second unbounded allocation (≈2.3 GB)

A different chunk, different provider, same failure mode — a 2.3 GB allocation attempt that aborted the process.

All three bugs were **reproducible**, **triggered by real data recovered from unallocated space**, and **would have made Tier 1 carving unusable in practice**. We filed them upstream with minimal repros and attached the offending chunks ([issues #290, #291, #292](https://github.com/omerbenamram/evtx/issues/290)). These were closed as presumed-fixed in evtx 0.11.2 and the pathological Desktop image that previously aborted the whole process does now carve cleanly to 35,477 events with zero rejections on a stable build — but the fix did not cover every BinXML allocation path.

### Bug 4 — The one 0.11.2 didn't catch: a ~16 GB allocation inside `read_template_values_cursor`

While testing masstin against a freshly wiped `ws01-wipe-novss.raw` (50 GB Windows workstation imaged after an attacker's cleanup), the carver produced 108 synthetic EVTX files — and on one of them the whole process died:

```
memory allocation of 17179868328 bytes failed
stack backtrace:
 0: std::alloc::rust_oom
 1: std::alloc::_::__rust_alloc_error_handler
 2: alloc::alloc::handle_alloc_error
 3: alloc::raw_vec::handle_error
 4: evtx::binxml::tokens::read_template_values_cursor
 5: evtx::binxml::ir::build_tree_from_binxml_bytes_direct_with_mode
...
 13: rayon::iter::...
```

17,179,868,328 bytes is ~16 GiB, the signature of a `u32` read from the stream used as a capacity without an upper bound. Same family as bugs 2 and 3, different code path: the chunk header and record sizes are valid, but inside a BinXML template the count of values is garbage. evtx 0.11.2 bounds the top-level loops and record sizes, but not this particular `Vec::with_capacity` inside `read_template_values_cursor`.

The harder problem: this is an **`alloc_error`, not a panic**. The Rust allocator calls `abort()` directly (Windows status `0xC0000409`). `std::panic::catch_unwind` does not intercept it, thread isolation does not help (the abort kills the whole process), and rayon amplifies it because the crate parallelises chunk decoding — the abort can come from a worker pool thread the parent never sees.

### How masstin defends itself

On top of the upstream fix, the defense ladder keeps two layers that handle the `alloc_error` class of failures specifically:

1. **Subprocess isolation for phase-2 validation.** Every synthetic EVTX is validated in a **dedicated child process**, spawned by masstin itself via `MASSTIN_VALIDATE_EVTX=<path>` on the same binary. The child opens the file, iterates every record, and exits 0 on success. If the child aborts by OOM, the parent observes a non-zero exit code, rejects the file, and carries on with the remaining synthetics. This is the only strategy that survives `abort()` — no amount of in-process guard rails can.
2. **`catch_unwind` inside the child** for any ordinary panic path in malformed BinXML, plus a 60-second poll deadline on the parent side so hangs are killed cleanly.
3. **Thread isolation for chunk-scan peeks.** When extracting the provider name during the initial scan, `peek_chunk_provider` runs in a dedicated worker thread with a 3-second `recv_timeout`. If it hangs, masstin prints `[evtx hang] chunk at 0xOFFSET — skipping corrupt BinXML`, abandons the worker with `std::mem::forget`, and continues scanning.
4. **`--skip-offsets` escape hatch.** For pathological images where even the thread isolation isn't enough (a read inside the E01 decompressor that doesn't return), the analyst can pass `--skip-offsets 0x6478b6000,0x7a0000000` to tell masstin to skip a 32 MB window around each specified offset on the next run. Offsets of stalled reads are printed with a copy-paste-ready hint.
5. **Rejected-file preservation in debug mode.** When running with `--debug`, masstin copies every rejected synthetic EVTX to `<output_dir>/masstin_rejected_evtx/` with a prefix indicating the failure mode (`panic_oom__`, `hang__`, `open_fail__`). Useful for post-mortem, upstream bug reports, or just to know exactly what you could not use.

Verified end-to-end on the `ws01-wipe-novss.raw` case above: **one** synthetic EVTX (`Security.evtx` rebuilt from 108 carved chunks) aborted the validator child with `0xC0000409`, got quarantined as `panic_oom__Security.evtx`, and the remaining **107** parsed cleanly — 49 lateral movement events recovered from a disk where the attacker had deleted everything and wiped VSS.

---

## Usage

```bash
# Carve a single forensic image
masstin -a carve-image -f server.e01 -o carved-timeline.csv

# Carve multiple images
masstin -a carve-image -f DC01.e01 -f SRV-FILE.vmdk -o carved.csv

# Scan only unallocated space (faster, planned)
masstin -a carve-image -f server.e01 -o carved.csv --carve-unalloc

# Skip known bad offsets (for pathological E01s)
masstin -a carve-image -f broken.e01 --skip-offsets 0x6478b6000 -o carved.csv

# Keep rejected synthetic files for post-mortem (useful for bug reports)
masstin -a carve-image -f image.e01 -o carved.csv --debug
```

The output is the same 14-column CSV as `parse-image`, with `log_filename` showing the carved origin:

```
HRServer_Disk0.e01_carved_Microsoft-Windows-Security-Auditing.evtx
```

---

## Real-world results

Numbers below come from masstin v0.14.0 (evtx 0.11.2, stable build, no feature flags) against the DEFCON DFIR CTF 2018 images.

### HRServer (12.6 GB E01 / ~50 GB logical)

| Metric | Result |
|--------|--------|
| Chunks found (Tier 1) | 1,104 |
| Orphan records (Tier 2) | 7,895 |
| Synthetic EVTX files | 93 (grouped by provider) |
| Synthetic files rejected | 0 |
| **Lateral movement events recovered** | **37,288** |
| Scan time | 3m 54s |

Event-ID breakdown: Security.evtx dominates with 31,791 events (4625 failed logons, 4624/4634/4648/4776), SMBServer contributes 5,291 (551 auth failures, 1009 server events), TerminalServices-LocalSessionManager 67 (21/22/24/25), and RdpCoreTS 139 (event 131). A complete lateral movement timeline, built entirely from raw disk bytes, with no need for NTFS or VSS.

### Desktop (29.2 GB E01 / ~50 GB logical)

| Metric | Result |
|--------|--------|
| Chunks found (Tier 1) | 2,376 |
| Orphan records (Tier 2) | 24,911 |
| Synthetic EVTX files | 103 |
| Synthetic files rejected | 0 |
| **Lateral movement events recovered** | **35,477** |
| Scan time | 5m 39s |

This is the image that surfaced all three upstream bugs during development of masstin's carving path. With evtx 0.8.0 plus the old `alloc_error_hook` workaround, two synthetic files were rejected (the 14 GB and 2.3 GB allocation attempts described above) and ~34,916 events came out. With evtx 0.11.2 the parser handles those chunks cleanly: **zero rejected files**, all 103 synthetic EVTX parsed end-to-end, and 561 extra events recovered from the chunks that the hook-based path was discarding entirely — giving the 35,477 total shown here.

---

## Performance

Carving speed is purely I/O bound: one sequential pass, no seeks, almost no CPU.

| Storage | Throughput | Time for 100 GB |
|---------|-----------|-----------------|
| NVMe local | ~3 GB/s | ~35 seconds |
| SSD SATA | ~500 MB/s | ~3.5 minutes |
| E01 on SSD | ~200-400 MB/s | ~5-8 minutes |
| E01 on HDD | ~100-150 MB/s | ~12-17 minutes |
| Network share | ~50-100 MB/s | ~17-33 minutes |

The validation phase adds a few seconds per synthetic file, dominated by the 15-second timeout when a file has to be rejected.

---

## Comparison with other carving tools

| Tool | Language | Tier 1 | Tier 2 | Tier 3 | Lateral movement parsing |
|------|----------|--------|--------|--------|--------------------------|
| **masstin `carve-image`** | Rust | Yes | Detection | Planned | **Yes — full pipeline** |
| EVTXtract (Ballenthin) | Python | Yes | Yes | Yes | No — outputs raw XML |
| bulk_extractor-rec | C++ | Yes | Yes | No | No — outputs raw files |
| EvtxCarv | Python | Yes | Yes | Fragment reassembly | No — outputs raw files |

Masstin is the only tool that carves EVTX chunks **and** immediately parses them for lateral movement, producing a ready-to-use timeline and graph database input — and the only one hardened against the upstream parser's own bugs.

---

## When to use `carve-image` vs `parse-image`

| Scenario | Use |
|----------|-----|
| Normal forensic analysis | `parse-image` — extracts from NTFS + VSS |
| Logs deleted, VSS intact | `parse-image` — VSS recovery handles it |
| Logs deleted, VSS deleted, UAL intact | `parse-image` — UAL provides 3-year history |
| **Everything deleted** | **`carve-image` — recovers from unallocated space** |
| Maximum recovery | Both: `parse-image` first, then `carve-image` on the same image |

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Forensic images and VSS recovery | [parse-image](/en/tools/masstin-vss-recovery/) |
| MountPoints2 registry | [MountPoints2](/en/artifacts/mountpoints2-lateral-movement/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
