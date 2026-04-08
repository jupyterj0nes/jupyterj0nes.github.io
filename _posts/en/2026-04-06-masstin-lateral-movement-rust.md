---
layout: post
title: "Masstin: Lateral Movement Analysis at Rust Speed"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: en
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, memgraph, evtx, tools]
description: "Masstin is a Rust-based DFIR tool that parses forensic artifacts and generates unified lateral movement timelines, with graph database visualization."
comments: true
---

![Masstin Logo](/assets/images/masstin-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 600px;" }

## The problem

An attacker has compromised your network. They've moved laterally across Windows servers, Linux machines, and cloud infrastructure. Your evidence is scattered: EVTX files from 50 machines, Linux auth logs from a dozen servers, network data from your EDR. Each source has a different format, different timestamps, different field names. You need to reconstruct the attacker's path — every hop, every credential used, every failed attempt — and you need it **now**.

Masstin solves this by parsing **all** these sources and merging them into a **single chronological timeline** where a Windows RDP logon, a Linux SSH brute-force, and an EDR network connection all appear side by side, in the same format, ready for analysis or graph visualization.

---

## What is Masstin?

A DFIR tool written in **Rust** that parses forensic artifacts from Windows, Linux, and EDR platforms, and unifies lateral movement data into a single timeline. One command, multiple evidence sources, one coherent view of the attack.

- **Repository:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **License:** AGPL-3.0
- **Platforms:** Windows, Linux and macOS — zero dependencies, single binary

---

## Key Features

| Feature | Description | Details |
|---------|-------------|---------|
| **Multi-directory incident analysis** | Analyze dozens of machines at once with multiple `-d` flags — critical for ransomware investigations where you need the full lateral movement chain | |
| **Cross-platform timeline** | Windows EVTX + Linux SSH + EDR data merged into one CSV with `merge` — an RDP logon, an SSH brute-force, and a Cortex connection appear side by side | |
| **30+ Event IDs, 9 Windows sources** | Security.evtx, Terminal Services (4 logs), SMBServer, SMBClient (2 logs), RdpCoreTS — covering RDP, SMB, Kerberos, NTLM, and share access | [Artifacts →](/en/artifacts/security-evtx-lateral-movement/) |
| **Event classification** | Every event classified as `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF`, or `CONNECT` — filter by type instead of memorizing Event IDs | [CSV Format →](/en/tools/masstin-csv-format/) |
| **Recursive decompression** | Auto-extracts ZIP/triage packages recursively, handles archived logs with duplicate filenames, auto-detects common forensic passwords | |
| **Linux smart inference** | Auto-detects hostname (`/etc/hostname`, syslog header), infers year (`dpkg.log`, `wtmp`), supports Debian (`auth.log`) and RHEL (`secure`), both RFC3164 and RFC5424 | [Linux artifacts →](/en/artifacts/linux-forensic-artifacts/) |
| **Graph visualization** | Direct upload to [Neo4j](/en/tools/neo4j-cypher-visualization/) or [Memgraph](/en/tools/memgraph-visualization/) with connection grouping (earliest date + count) and automatic IP-to-hostname resolution | |
| **Temporal path reconstruction** | Cypher query to find the chronologically coherent path between two nodes — reconstructs the exact attacker route ensuring each hop happened after the previous one | [Neo4j →](/en/tools/neo4j-cypher-visualization/) |
| **Session correlation** | `logon_id` field enables matching logon/logoff events to determine session duration | [CSV Format →](/en/tools/masstin-csv-format/) |
| **Silent mode** | `--silent` flag suppresses all output for integration with Velociraptor, SOAR platforms, and automation pipelines | |
| **Transparent reporting** | CLI shows artifact discovery, processing progress, hostname/year inferences, and per-artifact event counts | |

```bash
# Analyze an entire incident: multiple machines, one timeline
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -d /evidence/WS-ADMIN -o timeline.csv

# Cross-platform: merge Windows + Linux into a single view
masstin -a merge -f windows.csv -f linux.csv -o full-timeline.csv
```

![Masstin CLI output](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

---

## Available Actions

| Action | Description |
|--------|-------------|
| `parse-windows` | Parse Windows EVTX from directories or files (supports compressed triage packages) |
| `parse-linux` | Parse Linux logs: auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog |
| `parser-elastic` | Parse Winlogbeat JSON logs exported from Elasticsearch |
| `parse-cortex` | Query Cortex XDR API for network connections (RDP/SMB/SSH) |
| `parse-cortex-evtx-forensics` | Query Cortex XDR API for forensic EVTX collections across multiple machines |
| `merge` | Combine multiple CSVs into a single chronological timeline |
| `load-neo4j` | Upload timeline to Neo4j for graph visualization |
| `load-memgraph` | Upload timeline to Memgraph for in-memory graph visualization |

---

## Quick Start

Download the latest binary from the [Releases page](https://github.com/jupyterj0nes/masstin/releases) — no installation needed. Or build from source:

```bash
git clone https://github.com/jupyterj0nes/masstin.git
cd masstin && cargo build --release
```

---

## Documentation Index

### Artifacts

| Artifact | Article |
|----------|---------|
| Security.evtx (30+ Event IDs) | [Security.evtx and lateral movement](/en/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/en/artifacts/terminal-services-evtx/) |
| SMB EVTX | [SMB EVTX events](/en/artifacts/smb-evtx-events/) |
| Linux logs (auth.log, secure, utmp/wtmp) | [Linux forensic artifacts](/en/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat artifacts](/en/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR artifacts](/en/artifacts/cortex-xdr-artifacts/) |
| Windows Prefetch | [Windows Prefetch](/en/artifacts/windows-prefetch-forensics/) |

### Output Format

| Topic | Article |
|-------|---------|
| 14-column CSV, event_type, Event ID mapping, logon_id, detail | [CSV Format and Event Classification](/en/tools/masstin-csv-format/) |

### Graph Databases

| Database | Article |
|----------|---------|
| Neo4j | [Neo4j and Cypher: visualization and queries](/en/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: in-memory visualization](/en/tools/memgraph-visualization/) |
