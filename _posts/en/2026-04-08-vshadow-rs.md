---
layout: post
title: "vshadow-rs: Pure Rust VSS Parser for Forensic Images"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: en
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, tools]
description: "Pure Rust parser for Windows Volume Shadow Copy (VSS) snapshots. Read VSS stores from E01 and dd forensic images cross-platform, without Windows APIs."
comments: true
---

## The problem

Attackers clear Windows event logs. But if Volume Shadow Copies exist on the disk, the old logs are still there — frozen in time inside the shadow copy snapshots. The challenge is accessing them:

- **vshadowmount** requires FUSE and only works on Linux
- **EVTXECmd --vss** requires the Windows VSS COM API and only works on live systems
- **Neither** can read directly from E01 forensic images

## What is vshadow-rs?

A **pure Rust** library and CLI tool that reads the VSS on-disk format directly from any `Read + Seek` source — E01 images, raw/dd images, or partition dumps. No Windows APIs, no C dependencies, works on Windows, Linux, and macOS.

- **Repository:** [github.com/jupyterj0nes/vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
- **Crate:** [crates.io/crates/vshadow](https://crates.io/crates/vshadow)
- **License:** MIT / Apache 2.0

## CLI Usage

```bash
# Install
cargo install vshadow

# Inspect a forensic image for VSS stores
vshadow-info -f evidence.E01

# Specify partition offset manually
vshadow-info -f disk.dd --offset 0x26700000
```

The tool auto-detects NTFS partitions via GPT and MBR partition tables, then checks each one for VSS snapshots.

## Library Usage

```rust
use vshadow::VssVolume;

let mut reader = /* any Read+Seek: File, BufReader, ewf::EwfReader, etc. */;
let vss = VssVolume::new(&mut reader)?;

for i in 0..vss.store_count() {
    let info = vss.store_info(i)?;
    let mut store = vss.store_reader(&mut reader, i)?;
    // store implements Read + Seek — pass it to an NTFS parser
}
```

## Integration with masstin

[Masstin](/en/tools/masstin-lateral-movement-rust/) uses vshadow-rs to extract EVTX files from both the live volume and all VSS snapshots within forensic images:

```bash
masstin -a parse-image-windows -f evidence.E01 -o timeline.csv
```

This single command opens the image, finds NTFS partitions, extracts EVTX from the live volume, detects VSS stores, extracts EVTX from each snapshot, and generates a unified lateral movement timeline — including events that were deleted from the live volume but preserved in shadow copies.

## How VSS works

Volume Shadow Copy uses a copy-on-write mechanism:

1. When a snapshot is created, the current state of every 16 KiB block is recorded
2. When a block is later modified, the **old** data is copied to a store area before the write
3. To reconstruct the snapshot: read from the store area for changed blocks, from the current volume for unchanged blocks

vshadow-rs parses the on-disk structures: volume header at offset `0x1E00`, catalog (linked list of 16 KiB blocks with store metadata), and block descriptors (32-byte entries mapping original offsets to stored data locations).
