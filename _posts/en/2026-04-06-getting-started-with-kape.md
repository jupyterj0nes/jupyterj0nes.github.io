---
layout: post
title: "Getting Started with KAPE: Triage Like a Pro"
date: 2026-04-06 09:00:00 +0100
category: tools
lang: en
tags: [kape, triage, collection, tools]
description: "A practical guide to KAPE (Kroll Artifact Parser and Extractor) — how to collect and process forensic artifacts efficiently."
comments: true
---

KAPE (Kroll Artifact Parser and Extractor) is a triage tool designed to collect and process forensic artifacts quickly. It's become an essential tool in the DFIR toolkit.

## Why KAPE?

- **Speed:** Collects artifacts in minutes, not hours
- **Targets:** Pre-built collection profiles for common artifacts
- **Modules:** Automated processing with tools like Eric Zimmerman's suite
- **Portable:** Runs from a USB drive — no installation needed

## Basic Usage

### Collecting artifacts (Targets)

```bash
kape.exe --tsource C: --tdest D:\Evidence\Collection --target KapeTriage
```

### Processing collected data (Modules)

```bash
kape.exe --msource D:\Evidence\Collection --mdest D:\Evidence\Processed --module !EZParser
```

### Collect and process in one step

```bash
kape.exe --tsource C: --tdest D:\Evidence\Collection --target KapeTriage --mdest D:\Evidence\Processed --module !EZParser
```

## Essential Targets

| Target | What it collects |
|--------|-----------------|
| `KapeTriage` | Comprehensive triage collection |
| `!SANS_Triage` | SANS-recommended artifacts |
| `RegistryHives` | SAM, SYSTEM, SOFTWARE, NTUSER.DAT |
| `EventLogs` | Windows Event Logs (.evtx) |
| `Prefetch` | Prefetch files |
| `$MFT` | Master File Table |

## Pro Tips

1. **Always validate your targets** before deploying in the field
2. **Update regularly** — new targets and modules are added frequently
3. **Use compound targets** (`!` prefix) for comprehensive collections
4. **Document your collection command** — it's part of your chain of custody

> KAPE doesn't replace a full disk image, but for triage and rapid response, nothing beats it.
