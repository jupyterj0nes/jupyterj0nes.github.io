---
layout: post
title: "Persistence Boromir: Detecting All 24 Windows Persistence Mechanisms"
date: 2026-04-06 06:00:00 +0100
category: tools
lang: en
ref: tool-boromir
tags: [boromir, persistence, windows, forensics, tools]
description: "Persistence Boromir detects and catalogs 24 Windows persistence mechanisms, generating a timeline of all persistence artifacts found."
comments: true
---

## What is Persistence Boromir?

**Persistence Boromir** is a Python forensic tool that detects and catalogs **24 different persistence mechanisms** on compromised Windows systems. Named after Boromir from The Lord of the Rings — because just like Boromir couldn't resist the temptation of the ring, malware can't resist the temptation to establish persistence.

- **Repository:** [github.com/jupyterj0nes/Persistence_Boromir](https://github.com/jupyterj0nes/Persistence_Boromir)
- **Language:** Python

## What mechanisms does it detect?

Boromir covers a wide spectrum of Windows persistence techniques:

### Registry
- Run / RunOnce
- Image File Execution Options (IFEO)
- AppPaths
- Shell extensions

### Execution
- Windows Services
- Scheduled Tasks
- Startup folders

### Hijacking
- DLL injection vectors
- COM Object hijacking
- WerFaultHangs

### And more...
Up to **24 different techniques** cataloged and analyzed.

## How does it work?

1. **Scans** the system looking for all 24 persistence mechanisms
2. **Catalogs** each artifact found with its details
3. **Generates a timeline** so the analyst can focus on the incident's "red zone"
4. **Exports to CSV** with timezone support

## Why does it matter?

During incident response, one of the first questions is: *"How is the attacker persisting?"*. Boromir automates the search for the most common (and some uncommon) mechanisms, saving hours of manual analysis.

## Upcoming posts

This is the main Persistence Boromir page. Future posts will cover:

- All 24 persistence mechanisms explained one by one
- Running Boromir on a compromised system
- Interpreting results
- Integration with other triage tools
- Practical persistence detection cases
