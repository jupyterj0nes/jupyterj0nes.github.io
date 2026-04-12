---
layout: post
title: "EVTX Carving: Recovering Deleted Event Logs from Unallocated Space"
date: 2026-04-12 02:00:00 +0100
category: tools
lang: en
ref: tool-masstin-evtx-carving
tags: [masstin, carving, evtx, forensics, dfir, unallocated, recovery, tools]
description: "Masstin's carve-image action scans forensic disk images for EVTX chunks in unallocated space, recovering lateral movement events after attackers delete logs."
comments: true
---

## The last resort: when even VSS is gone

The attacker was thorough. They cleared every event log. They deleted the Volume Shadow Copies with `vssadmin delete shadows /all`. They even wiped the UAL databases. Your Security.evtx is empty, your VSS stores are gone, and there's nothing left to parse.

Or is there?

When Windows deletes a file, the data doesn't disappear from disk — the space is simply marked as "available" in the filesystem. The actual bytes — including complete EVTX chunks — remain on disk until they're overwritten by new data. **Masstin's `carve-image` scans the raw disk for these remnants and recovers them.**

## How EVTX files are structured on disk

An EVTX file consists of:

```
[File Header - 4KB] [Chunk 0 - 64KB] [Chunk 1 - 64KB] [Chunk 2 - 64KB] ...
```

Each 64KB chunk starts with the magic signature `ElfChnk\x00` and contains dozens to hundreds of event records. Each chunk is self-contained — it has its own string table, template table, and records. This means a single chunk found in unallocated space can be parsed independently, even without the rest of the EVTX file.

Each individual record within a chunk starts with the magic `\x2a\x2a\x00\x00` and contains:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Magic: `0x2A2A0000` |
| 4 | 4 | Record size (u32) |
| 8 | 8 | Record ID (u64) |
| 16 | 8 | Timestamp (FILETIME) |
| 24 | var | BinXML event data |
| size-4 | 4 | Size copy (validation) |

## What masstin carves

### Tier 1: Complete chunk recovery (full fidelity)

Masstin scans the entire disk image sector by sector (512-byte alignment) looking for the 8-byte `ElfChnk\x00` signature. When found, it reads the full 64KB chunk and validates it by attempting to parse it with the evtx crate. Valid chunks are grouped by provider (e.g., `Microsoft-Windows-Security-Auditing`, `Microsoft-Windows-TerminalServices-LocalSessionManager`) and assembled into synthetic EVTX files.

These synthetic EVTX files are then parsed through masstin's existing pipeline — the same 32+ Event IDs, the same CSV format, the same graph loading. **Carved events are indistinguishable from live events in the output.**

### Tier 2: Orphan record detection (metadata)

Records that exist outside valid chunks (partially overwritten chunks) are detected by scanning for the `\x2a\x2a\x00\x00` magic. These are validated with:

- Size field in range (28-65024 bytes)
- Trailing size copy matches
- BinXML preamble byte (`0x0F`)
- Timestamp in reasonable range (2000-2030)

Orphan records are counted and reported. Full XML recovery from orphan records requires template matching (Tier 3, planned for a future release).

## Usage

```bash
# Carve a single forensic image
masstin -a carve-image -f server.e01 -o carved-timeline.csv

# Carve multiple images
masstin -a carve-image -f DC01.e01 -f SRV-FILE.vmdk -o carved.csv

# Future: scan only unallocated space (faster)
masstin -a carve-image -f server.e01 -o carved.csv --carve-unalloc
```

The output is the same 14-column CSV as `parse-image`, with `log_filename` showing the carved origin:

```
HRServer_Disk0.e01_carved_Microsoft-Windows-Security-Auditing.evtx
```

## Real-world results

Carving the DEFCON DFIR CTF 2018 HRServer image (12.6 GB E01):

| Metric | Result |
|--------|--------|
| Image size | 12.6 GB (compressed E01) |
| Disk size | ~50 GB (expanded) |
| Chunks found | 1,092 |
| Orphan records | 8,451 |
| Synthetic EVTX files | 94 (grouped by provider) |
| **Lateral movement events recovered** | **37,772** |
| Scan time | ~3 minutes |

The carved events include Security.evtx (32,195 events), SMBServer (5,374), TerminalServices (90), and RdpCoreTS (136) — complete lateral movement timeline recovered from raw disk.

## Performance

Carving speed depends on I/O:

| Storage | Speed | Time for 100 GB |
|---------|-------|----------------|
| NVMe local | ~3 GB/s | ~35 seconds |
| SSD SATA | ~500 MB/s | ~3.5 minutes |
| E01 on SSD | ~200-400 MB/s | ~5-8 minutes |
| E01 on HDD | ~100-150 MB/s | ~12-17 minutes |
| Network share | ~50-100 MB/s | ~17-33 minutes |

The scan is sequential (one pass, no seeks) — the bottleneck is always disk read speed, not CPU.

## Comparison with other carving tools

| Tool | Language | Tier 1 (chunks) | Tier 2 (records) | Tier 3 (template match) | Lateral movement parsing |
|------|----------|-----------------|-----------------|------------------------|-------------------------|
| **masstin carve-image** | Rust | Yes | Detection only | Planned | **Yes — full pipeline** |
| EVTXtract (Ballenthin) | Python | Yes | Yes | Yes | No — outputs raw XML |
| bulk_extractor-rec | C++ | Yes | Yes | No | No — outputs raw files |
| EvtxCarv | Python | Yes | Yes | Fragment reassembly | No — outputs raw files |

Masstin is the only tool that carves EVTX chunks **and** immediately parses them for lateral movement, producing a ready-to-use timeline and graph database input.

## When to use carve-image vs parse-image

| Scenario | Use |
|----------|-----|
| Normal forensic analysis | `parse-image` — extracts from NTFS + VSS |
| Logs deleted, VSS intact | `parse-image` — VSS recovery handles it |
| Logs deleted, VSS deleted, UAL intact | `parse-image` — UAL provides 3-year history |
| **Everything deleted** | **`carve-image` — recovers from unallocated space** |
| Maximum recovery | Both: `parse-image` first, then `carve-image` on same image |

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Forensic images and VSS recovery | [parse-image](/en/tools/masstin-vss-recovery/) |
| MountPoints2 registry | [MountPoints2](/en/artifacts/mountpoints2-lateral-movement/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
