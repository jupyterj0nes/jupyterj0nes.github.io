---
layout: post
title: "Forensic Image Analysis: Cross-OS Auto-Detection and VSS Recovery with Masstin"
date: 2026-04-09 01:00:00 +0100
category: tools
lang: en
ref: tool-masstin-vss-recovery
tags: [masstin, vss, shadow-copy, forensics, dfir, evtx, tools]
description: "Masstin's parse-image auto-detects OS per partition (NTFS/ext4), extracts Windows EVTX+UAL+VSS and Linux logs from forensic images, and merges everything into a single timeline."
comments: true
---

## One command, any OS, any image

A ransomware incident hits your network. You receive a folder full of forensic images — Windows domain controllers, Linux web servers, file servers — all mixed together. Traditionally, you'd need to identify each OS, mount each image, run separate tools for Windows and Linux, then manually merge the results.

**Masstin's `parse-image` does it all in one command.** It auto-detects the operating system of every partition inside every image and applies the right parser automatically:

- **NTFS partition detected?** → Extracts EVTX + UAL from the live volume, recovers deleted logs from VSS snapshots, deduplicates
- **ext4 partition detected?** → Extracts auth.log, secure, messages, audit.log, wtmp, btmp, lastlog, infers hostname and year

All results are merged into a **single chronological CSV** — Windows RDP logons and Linux SSH sessions side by side.

```bash
# Single image — OS auto-detected
masstin -a parse-image -f HRServer_Disk0.e01 -o timeline.csv

# Mixed Windows + Linux images — single merged timeline
masstin -a parse-image -f DC01.e01 -f ubuntu-web.vmdk -o incident.csv

# Point at evidence folder — finds all images, any OS
masstin -a parse-image -d /evidence/all_machines/ -o full_timeline.csv
```

For each image, masstin:

1. **Opens the forensic image** (E01, dd/raw, or VMDK)
2. **Finds all partitions** automatically (GPT and MBR)
3. **Identifies the OS** per partition (NTFS signature or ext4 superblock)
4. **Extracts Windows artifacts** from NTFS: EVTX + UAL from live volume
5. **Recovers deleted logs** from VSS snapshots using [vshadow-rs](/en/tools/vshadow-rs/)
6. **Extracts Linux logs** from ext4: auth.log, wtmp, audit.log, etc.
7. **Parses each source** with its native parser
8. **Merges and deduplicates** into a single timeline

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

Every event in the output CSV includes a descriptive `log_filename` that tells you exactly where it came from — for both Windows and Linux sources:

```
HRServer_Disk0.e01:live:Security.evtx                    ← Windows: live volume
HRServer_Disk0.e01:vss_0:Security.evtx                   ← Windows: recovered from VSS snapshot 0
HRServer_Disk0.e01:UAL:Current.mdb                       ← Windows: UAL database
kali-linux.vmdk:partition_0:/var/log/auth.log             ← Linux: auth.log from ext4
ubuntu-server.e01:partition_0:/var/log/wtmp               ← Linux: wtmp login records
```

This allows the analyst to immediately distinguish between current evidence, recovered evidence, and the operating system of origin.

## Multiple images, mixed operating systems

For large-scale incidents, point masstin at any combination of Windows and Linux forensic images:

```bash
masstin -a parse-image \
  -f DC01.e01 \
  -f SRV-FILE.e01 \
  -f linux-web.vmdk \
  -f ubuntu-db.e01 \
  -o full-incident-timeline.csv
```

Each image is processed independently: partitions detected, OS identified per partition, appropriate artifacts extracted (EVTX + UAL + VSS for Windows, auth.log + wtmp for Linux), and everything merged into a single timeline spanning all machines and operating systems.

Or simply point at an evidence folder:

```bash
masstin -a parse-image -d /evidence/ -o timeline.csv
```

Masstin recursively finds all E01, VMDK, and dd/raw images in the folder, auto-detects the OS of each, and produces one unified CSV.

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

Masstin uses pure Rust parsers for everything — no external tools, no mounting, no FUSE:

1. **Image access**: E01 via `ewf` crate, VMDK via custom parser, dd/raw via direct file I/O
2. **Partition detection**: GPT and MBR tables parsed to find all partitions
3. **OS identification**: NTFS boot sector signature (`NTFS    `) or ext4 superblock magic (`0xEF53`) — each partition is classified independently
4. **Windows extraction** (NTFS partitions):
   - EVTX from `Windows\System32\winevt\Logs\`
   - UAL databases from `Windows\System32\LogFiles\Sum\`
   - VSS detection at offset `0x1E00`, block descriptor mapping, snapshot reconstruction via [vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
5. **Linux extraction** (ext4 partitions):
   - auth.log, secure, messages, audit.log from `/var/log/`
   - wtmp, btmp, utmp, lastlog, hostname
   - Year inference from `dpkg.log`, hostname from `/etc/hostname`
6. **Dual parsing**: Windows artifacts → `parse_events`, Linux artifacts → `parse_linux`
7. **Merge and deduplication**: both timelines merged chronologically, duplicates removed

Works on Windows, Linux, and macOS. Single binary, zero dependencies.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| vshadow-rs — VSS parser | [vshadow-rs](/en/tools/vshadow-rs/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
