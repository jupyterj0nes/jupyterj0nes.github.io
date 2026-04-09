---
layout: post
title: "vshadow-rs: Pure Rust VSS Parser for Forensic Images"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: en
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, tools]
description: "Pure Rust parser for Windows Volume Shadow Copy (VSS) snapshots. Identify, timeline and recover files from VSS stores in E01 and dd forensic images, cross-platform."
comments: true
---

## The problem

Attackers clear Windows event logs. But if Volume Shadow Copies exist on the disk, the old logs are still there — frozen in time. The challenge: existing tools can't access them easily.

| Tool | Limitation |
|------|-----------|
| **vshadowmount** | Requires FUSE, Linux only |
| **EVTXECmd --vss** | Requires Windows VSS COM API, live systems only |
| **Both** | Cannot read from E01 forensic images directly |

## What is vshadow-rs?

A **pure Rust** library and CLI tool that reads the VSS on-disk format directly from E01, raw/dd, or partition images. No Windows APIs, no C dependencies, works on Windows, Linux, and macOS.

- **Repository:** [github.com/jupyterj0nes/vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
- **Crate:** [crates.io/crates/vshadow](https://crates.io/crates/vshadow)
- **License:** AGPL-3.0

---

## Key Features

| Feature | Description |
|---------|-------------|
| Inspect VSS stores | List all shadow copy snapshots with GUIDs, creation times and delta sizes |
| List files | Browse NTFS directories inside any VSS store or the live volume |
| **Delta detection** | Compare VSS snapshots against the live volume — find deleted and changed files |
| **MACB timelines** | Generate forensic timelines from the delta with full NTFS timestamp precision |
| Extract files | Extract files from VSS stores to disk — recover deleted event logs |
| E01 support | Read directly from Expert Witness Format images, no ewfmount needed |
| Auto partition detection | Finds NTFS partitions automatically via GPT and MBR partition tables |
| Cross-platform | Windows, Linux and macOS — single binary, zero dependencies |
| Library + CLI | Use as a Rust crate or as a standalone command-line tool |

---

## Install

```bash
cargo install vshadow
```

---

## CLI Usage

### Inspect: find VSS stores

```bash
vshadow-rs info -f evidence.E01
```

### List: browse files in a VSS store or live volume

```bash
# Live volume
vshadow-rs list -f evidence.E01 --live -p "Windows/System32/winevt/Logs"

# VSS store 0
vshadow-rs list -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs"
```

### List-delta: find what changed between VSS and live volume

This is what makes vshadow-rs unique. It compares the snapshot filesystem against the live volume and shows only the files that were **deleted** or **changed**.

```bash
# Show delta for all VSS stores
vshadow-rs list-delta -f evidence.E01

# Focus on event logs only
vshadow-rs list-delta -f evidence.E01 -p "Windows/System32/winevt/Logs"

# Export delta to CSV
vshadow-rs list-delta -f evidence.E01 -o delta.csv
```

<img src="/assets/images/vshadow-rs-list-delta.png" alt="vshadow-rs list-delta output" width="700">

The output shows each changed file with its size on the live volume vs. the VSS store, making it immediately obvious when logs have been cleared.

### Extract: recover files from VSS stores

```bash
vshadow-rs extract -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recovered/
```

### Timeline: generate MACB timeline from VSS delta

Generates a full MACB (Modified, Accessed, Changed, Born) timeline CSV from the delta — only files that exist in VSS but not on the live volume, or that changed.

```bash
# Expanded format: 8 rows per file (SI + FN timestamps)
vshadow-rs timeline -f evidence.E01 -o timeline.csv

# MACB format: 1 row per file with MACB flags
vshadow-rs timeline -f evidence.E01 --format macb -o timeline.csv

# Include live volume in the timeline
vshadow-rs timeline -f evidence.E01 --include-live -o timeline.csv
```

### Typical forensic workflow

```bash
# 1. Check for VSS stores
vshadow-rs info -f suspect.E01

# 2. Find what changed between VSS and live volume
vshadow-rs list-delta -f suspect.E01 -p "Windows/System32/winevt/Logs"

# 3. Extract pre-deletion logs from VSS
vshadow-rs extract -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recovered/

# 4. Generate a timeline of deleted/modified files
vshadow-rs timeline -f suspect.E01 -o timeline.csv

# 5. Parse recovered logs with masstin
masstin -a parse-windows -d ./recovered/ -o lateral.csv
```

---

## What makes vshadow-rs unique

1. **Delta detection** (`list-delta`): no other tool compares VSS snapshots against the live volume to show exactly what changed. This is the fastest way to find cleared logs, deleted files, and tampered evidence.

2. **MACB timelines from shadows** (`timeline`): generate forensic timelines from the delta — only the relevant changes, not the entire filesystem.

3. **Direct E01 support**: read forensic images without mounting, converting, or extracting.

4. **Pure Rust, cross-platform**: no FUSE, no Windows APIs, no C libraries. Works on any OS.

5. **Library + CLI**: use the `vshadow` crate in your own Rust tools, or use the `vshadow-rs` binary from the command line.

---

## Comparison with existing tools

| Feature | vshadowmount | vshadowinfo | **vshadow-rs** |
|---------|-------------|-------------|-----------------|
| List VSS stores | No | Yes | **Yes** |
| Show GUIDs, dates | No | Yes | **Yes** |
| Show delta size | No | No | **Yes** |
| Mount as FUSE filesystem | Yes | No | No |
| **List files in VSS store** | Via mount | No | **Yes** |
| **Extract files from VSS** | Via mount | No | **Yes** |
| **Compare VSS vs live (delta)** | No | No | **Yes** |
| **MACB timeline from delta** | No | No | **Yes** |
| **List files in live volume** | No | No | **Yes** |
| **Read E01 directly** | No | No | **Yes** |
| **Auto-detect GPT/MBR** | No | No | **Yes** |
| Cross-platform | Linux only | Linux/Mac/Win | **Win/Linux/Mac** |

---

## How VSS works

Volume Shadow Copy uses a copy-on-write mechanism at the block level (16 KiB blocks):

1. **Snapshot creation**: the catalog records metadata (GUID, timestamp)
2. **Block modification**: when a block is about to be overwritten, the **old** data is copied to a store area first
3. **Reconstruction**: read from the store for changed blocks, from the live volume for unchanged blocks

vshadow-rs parses the on-disk structures: volume header at `0x1E00`, catalog (linked list of 16 KiB blocks), and block descriptors (32-byte entries mapping original offsets to stored data).

---

## Library Usage

```rust
use vshadow::VssVolume;

let mut reader = /* any Read+Seek source */;
let vss = VssVolume::new(&mut reader)?;

for i in 0..vss.store_count() {
    let mut store = vss.store_reader(&mut reader, i)?;
    // store implements Read + Seek — pass to ntfs crate
}
```

---

## Integration with masstin

[Masstin](/en/tools/masstin-lateral-movement-rust/) uses vshadow-rs to process forensic images with a single command:

```bash
masstin -a parse-image-windows -f evidence.E01 -o timeline.csv
```

This extracts EVTX from both the live volume and all VSS snapshots, generating a unified lateral movement timeline that includes events the attacker deleted.
