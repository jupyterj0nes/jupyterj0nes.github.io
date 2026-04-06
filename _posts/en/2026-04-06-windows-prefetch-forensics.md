---
layout: post
title: "Windows Prefetch: What It Reveals and How to Analyze It"
date: 2026-04-06 10:00:00 +0100
category: artifacts
lang: en
ref: windows-prefetch
tags: [windows, prefetch, execution, artifacts]
description: "A deep dive into Windows Prefetch files — what they store, where to find them, and what they tell us during an investigation."
comments: true
---

Prefetch files are one of the most valuable artifacts in Windows forensics. They provide evidence of **program execution**, including timestamps, run counts, and referenced files.

## What is Prefetch?

Windows Superfetch/Prefetch is a performance optimization feature that monitors application loading patterns. Every time an executable runs, Windows creates (or updates) a `.pf` file in `C:\Windows\Prefetch\`.

## File Format

```
<EXECUTABLE_NAME>-<HASH>.pf
```

For example:
```
CMD.EXE-4A81B364.pf
POWERSHELL.EXE-022A1004.pf
```

The hash is calculated based on the file path and, in some cases, command-line arguments.

## What Can We Extract?

| Field | Forensic Value |
|-------|---------------|
| Executable name | What ran |
| Run count | How many times |
| Last execution time | When (up to 8 timestamps in Win10+) |
| Referenced files/dirs | What it touched |
| Volume information | Where it ran from |

## Analysis with PECmd

Eric Zimmerman's **PECmd** is the go-to tool for parsing Prefetch files:

```bash
PECmd.exe -f "C:\Windows\Prefetch\CMD.EXE-4A81B364.pf"
```

Or process the entire Prefetch directory:

```bash
PECmd.exe -d "C:\Windows\Prefetch" --csv "C:\output" --csvf prefetch_results.csv
```

## Key Investigative Questions

- **Was a specific tool executed?** Check for its `.pf` file.
- **When was it last run?** Look at the last 8 execution timestamps.
- **What files did it access?** The referenced files list can reveal lateral movement, data staging, or exfiltration paths.
- **Was it run from a USB?** Volume serial numbers in the Prefetch data can indicate removable media.

## Limitations

- Prefetch is **disabled by default on SSDs** in some Windows versions (though Windows 10/11 keeps it enabled).
- Maximum of **1024 Prefetch files** (older ones get deleted).
- Only available on **Windows client** editions (not Server by default).
- Timestamps can be manipulated via timestomping, but the Prefetch metadata itself is harder to forge.

## Quick Reference

- **Location:** `C:\Windows\Prefetch\`
- **Tools:** PECmd, WinPrefetchView, Autopsy
- **Registry key to check status:** `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters`
  - `EnablePrefetcher = 3` → Enabled for both applications and boot

> Prefetch files are your first stop when answering the fundamental forensic question: *"Did this program run on this system?"*
