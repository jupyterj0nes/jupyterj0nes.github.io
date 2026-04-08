---
layout: post
title: "Recovering Deleted Event Logs from Volume Shadow Copies with Masstin"
date: 2026-04-09 01:00:00 +0100
category: tools
lang: en
ref: tool-masstin-vss-recovery
tags: [masstin, vss, shadow-copy, forensics, dfir, evtx, tools]
description: "How masstin extracts EVTX files from both live volumes and Volume Shadow Copy snapshots inside forensic disk images, recovering event logs deleted by attackers."
comments: true
---

## The scenario

An attacker compromises a Windows server, moves laterally across the network, and before leaving — clears the Security event log. When the forensic analyst receives the disk image, the live Security.evtx is nearly empty.

But Windows Volume Shadow Copies preserve the old data. If System Protection was enabled, the event logs from before the clearing are still on disk, frozen inside a VSS snapshot.

The challenge has always been accessing them: mounting images, running vshadowmount on Linux, extracting files manually, then parsing them. Multiple tools, multiple steps, easy to miss.

**Masstin does it all in one command.**

## One command, full recovery

```bash
masstin -a parse-image-windows -f HRServer_Disk0.e01 -o timeline.csv
```

This single command:

1. **Opens the forensic image** (E01 or dd/raw)
2. **Finds NTFS partitions** automatically (GPT and MBR)
3. **Extracts EVTX** from the live volume
4. **Detects VSS snapshots** using the [vshadow-rs](/en/tools/vshadow-rs/) crate
5. **Extracts EVTX from each VSS store** — recovering deleted logs
6. **Deduplicates** events that exist in both live and VSS
7. **Generates a unified timeline** with all events classified

![Masstin parse-image-windows output](/assets/images/masstin_cli_parse_image.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

## Example

Processing a 50 GB E01 image of a Windows Server where the attacker had cleared the event logs:

| Metric | Result |
|--------|--------|
| Image size | 50.00 GB |
| NTFS partition | 1 (offset 0x1F500000) |
| VSS snapshots | 1 (created 2018-08-07, 149.9 MB delta) |
| EVTX from live volume | 296 files |
| EVTX from VSS store | 128 files |
| Total after dedup | 424 unique EVTX files |
| Events from live | 6,947 |
| Events recovered from VSS | 34,586 |
| **Total unique events** | **41,533** |
| Duplicates removed | 1,406 |
| **Processing time** | **~5 seconds** |

The VSS snapshot contained **34,586 events that were no longer on the live volume** — including the Security.evtx with full authentication history that the attacker had cleared.

## Descriptive source tracking

Every event in the output CSV includes a descriptive `log_filename` that tells you exactly where it came from:

```
HRServer_Disk0.e01:live:Security.evtx          ← from the current live volume
HRServer_Disk0.e01:vss_0:Security.evtx         ← recovered from VSS snapshot 0
```

This allows the analyst to immediately distinguish between current evidence and recovered evidence, and to know exactly which VSS store provided each event.

## Multiple images at once

For large-scale incidents or ransomware investigations, point masstin at multiple forensic images:

```bash
masstin -a parse-image-windows \
  -f DC01.e01 \
  -f SRV-FILE.e01 \
  -f WS-ADMIN.e01 \
  -o full-incident-timeline.csv
```

Each image is processed independently: partitions detected, VSS snapshots enumerated, EVTX extracted and deduplicated. The result is a single timeline spanning all machines — including events recovered from shadow copies on every server.

## Failed logon details

When masstin encounters a failed logon (Event 4625), the `detail` column now shows a human-readable description:

| detail | Meaning |
|--------|---------|
| `Wrong password (0xC000006A)` | Incorrect password |
| `User does not exist (0xC0000064)` | Account not found |
| `Account locked out (0xC0000234)` | Too many failed attempts |
| `Account disabled (0xC0000072)` | Account is disabled |
| `Expired password (0xC0000071)` | Password has expired |

## How it works

Masstin uses the [vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs) crate (pure Rust, cross-platform) to access VSS snapshots directly from forensic images:

1. **E01/dd → Read+Seek**: the `ewf` crate provides transparent access to E01 images
2. **Partition detection**: GPT and MBR tables parsed to find all NTFS volumes
3. **VSS detection**: reads the VSS header at partition offset `0x1E00`
4. **Block descriptor mapping**: identifies which 16 KiB blocks changed since the snapshot
5. **Snapshot reconstruction**: overlays stored blocks on the live volume to recreate the snapshot-time filesystem
6. **NTFS traversal**: navigates `Windows\System32\winevt\Logs\` in both live and snapshot
7. **Deduplication**: removes events that appear in both sources, preferring live volume

No mounting. No FUSE. No Windows APIs. Works on Windows, Linux, and macOS.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| vshadow-rs — VSS parser | [vshadow-rs](/en/tools/vshadow-rs/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
