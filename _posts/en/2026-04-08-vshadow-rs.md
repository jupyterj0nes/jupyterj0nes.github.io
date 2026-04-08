---
layout: post
title: "vshadow-rs: Pure Rust VSS Parser for Forensic Images"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: en
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, tools]
description: "Pure Rust parser for Windows Volume Shadow Copy (VSS) snapshots. Inspect, list and extract files from VSS stores in E01 and dd forensic images, cross-platform."
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
| Inspect VSS stores | List all shadow copy snapshots with GUIDs, creation times and volume sizes |
| List files | Browse NTFS directories inside any VSS store or the live volume |
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
vshadow-info info -f evidence.E01
```

### List: browse files in a VSS store or live volume

```bash
# Live volume
vshadow-info list -f evidence.E01 --live -p "Windows/System32/winevt/Logs"

# VSS store 0
vshadow-info list -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs"
```

### Extract: recover files from VSS stores

```bash
# Extract from VSS store 0 (recover cleared event logs)
vshadow-info extract -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recovered/

# Extract from live volume
vshadow-info extract -f evidence.E01 --live -p "Windows/System32/winevt/Logs" -o ./evtx_live/
```

### Typical forensic workflow

```bash
# 1. Check for VSS stores
vshadow-info info -f suspect.E01

# 2. Compare file sizes between live and snapshot (cleared = smaller)
vshadow-info list -f suspect.E01 --live -p "Windows/System32/winevt/Logs"
vshadow-info list -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs"

# 3. Extract pre-deletion logs from VSS
vshadow-info extract -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recovered/

# 4. Parse recovered logs with masstin
masstin -a parse-windows -d ./recovered/ -o timeline.csv
```

---

## Comparison with existing tools

| Feature | vshadowmount | vshadowinfo | **vshadow-info** |
|---------|-------------|-------------|-----------------|
| List VSS stores | No | Yes | **Yes** |
| Show GUIDs, dates | No | Yes | **Yes** |
| Mount as FUSE filesystem | Yes | No | No |
| **List files in VSS store** | Via mount | No | **Yes** |
| **Extract files from VSS** | Via mount | No | **Yes** |
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
