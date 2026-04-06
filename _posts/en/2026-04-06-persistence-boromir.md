---
layout: post
title: "Persistence Boromir: No One Persists Without Being Detected"
date: 2026-04-06 06:00:00 +0100
category: tools
lang: en
ref: tool-boromir
tags: [boromir, persistence, windows, registry, forensics, tools]
description: "Persistence Boromir detects and catalogs 24 persistence mechanisms on compromised Windows systems, generating a chronological timeline of all artifacts found."
comments: true
---

## "One does not simply persist without being detected"

The name is no coincidence. Just like Boromir couldn't resist the temptation of the One Ring, malware can't resist the temptation to establish **persistence**. And just like Boromir eventually revealed his intentions, this tool reveals *all* the ways something persists on a Windows system.

## What is Persistence Boromir?

Persistence Boromir is a Python forensic tool created by **Alejandro Gamboa** ([AI3xGP](https://github.com/AI3xGP/Persistence_Boromir)), with contributions from [@skyg4mb](https://github.com/skyg4mb) and [@jupyterj0nes](https://github.com/jupyterj0nes). Its goal is to detect and catalog **24 different persistence mechanisms** on compromised Windows systems, generating a timeline that allows the analyst to focus on the incident's "red zone."

- **Original repository:** [github.com/AI3xGP/Persistence_Boromir](https://github.com/AI3xGP/Persistence_Boromir)
- **My fork:** [github.com/jupyterj0nes/Persistence_Boromir](https://github.com/jupyterj0nes/Persistence_Boromir)
- **Language:** Python
- **Author:** Alejandro Gamboa (AI3xGP)
- **Role:** Contributor

## Why does persistence matter?

During incident response, there's a question that always comes up in the early phases:

> *"How is the attacker maintaining access to the system?"*

If you don't identify all persistence mechanisms, the attacker will return after you "clean" the system. And we're not just talking about Run registry keys — there are **24 documented techniques**, many of them little-known even to experienced analysts.

## The 24 persistence mechanisms

### Windows Registry

| Mechanism | MITRE Technique | Description |
|-----------|----------------|-------------|
| Run / RunOnce | T1547.001 | Execution at logon |
| Image File Execution Options | T1546.012 | Process execution hijacking |
| AppPaths | T1546 | Application path redirection |
| Shell Extensions | T1546.015 | COM shell extensions |
| Winlogon | T1547.004 | Logon process hooks |
| AppInit_DLLs | T1546.010 | DLLs loaded into every process |

### Execution and services

| Mechanism | MITRE Technique | Description |
|-----------|----------------|-------------|
| Windows Services | T1543.003 | Malicious services |
| Scheduled Tasks | T1053.005 | Scheduled tasks |
| Startup Folders | T1547.001 | Startup folders |

### Hijacking and advanced techniques

| Mechanism | MITRE Technique | Description |
|-----------|----------------|-------------|
| DLL Search Order Hijacking | T1574.001 | Exploiting DLL search order |
| COM Object Hijacking | T1546.015 | COM object hijacking |
| WerFaultHangs | — | Windows error handler abuse |
| Logon Scripts | T1037.001 | Scripts executed at logon |

And many more, totaling **24 techniques**.

## How it works

Boromir scans the system (or a forensic image) looking for all known persistence mechanisms:

```bash
python boromir.py --target /evidence/mounted_image/ --output results.csv --timezone "Europe/Madrid"
```

### Output

The output CSV includes:

| Field | Description |
|-------|-------------|
| Timestamp | When the persistence was created/modified |
| Mechanism | What type of persistence it is |
| Path | Where it's located (registry key, file path, etc.) |
| Value | What it executes |
| Details | Additional information |

### The "red zone"

By sorting results chronologically, you can identify the **red zone** — the time period when the attacker established their persistence mechanisms. This gives you:

- **When** the infection occurred
- **What** was installed as persistence
- **Correlation** with other artifacts (logs, prefetch, etc.)

## When to use Boromir

- **Initial triage** — Is there malicious persistence on this machine?
- **Post-cleanup** — Have we removed *all* persistence mechanisms?
- **Hunting** — Proactive persistence hunting across the infrastructure
- **Training** — Understanding all 24 Windows persistence mechanisms

## Upcoming posts

- Detailed analysis of each persistence mechanism
- Step-by-step execution guide
- Interpreting results and detecting false positives
- Integration with KAPE and other triage tools
- Case study: detecting persistence in a real incident
