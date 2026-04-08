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

You're in the middle of an incident response. You've got 50 compromised machines, each with rotated event logs, your SIEM only forwarded a fraction of the events, and you need to reconstruct how the attacker moved through the network. **Now.**

Generic tools give you too much noise. Manually reviewing EVTX files is not an option. You need something that extracts *only* lateral movement data from all those artifacts, unifies them into a single timeline, and lets you visualize the relationships between machines.

That's what **masstin** is for.

## What is Masstin?

Masstin is a DFIR tool written in **Rust** that parses forensic artifacts and merges them into a **unified chronological CSV timeline**, focused exclusively on lateral movement. It's the evolution of [sabonis](/en/tools/sabonis-pivoting-lateral-movement/), rewritten from scratch to achieve ~90% better performance.

- **Repository:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **License:** AGPL-3.0
- **Platforms:** Windows, Linux and macOS (prebuilt binaries, no dependencies)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-artifact parsing** | 30+ Windows Event IDs + Linux logs + Winlogbeat JSON + Cortex XDR |
| **Unified timeline** | All sources merged into a single chronological CSV with [14 standardized columns](/en/tools/masstin-csv-format/) |
| **Event classification** | Every event classified as `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF`, or `CONNECT` — [full mapping](/en/tools/masstin-csv-format/) |
| **Compressed triage support** | Processes ZIP packages from Velociraptor or Cortex XDR, including password-protected archives |
| **Graph database support** | Direct upload to [Neo4j](/en/tools/neo4j-cypher-visualization/) or [Memgraph](/en/tools/memgraph-visualization/) with Cypher queries |
| **Auto IP-to-hostname** | Frequency-based resolution from the logs themselves |
| **Connection grouping** | Reduces noise by grouping repetitive connections |
| **Session correlation** | `logon_id` field for matching logon/logoff events — [details](/en/tools/masstin-csv-format/) |
| **Silent mode** | `--silent` flag for Velociraptor and automation integration |
| **Cross-platform** | Windows, Linux & macOS — zero dependencies |

---

## Available Actions

| Action | Description |
|--------|-------------|
| `parse-windows` | Parses Windows EVTX files and generates the lateral movement timeline |
| `parse-linux` | Parses Linux logs (auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog) |
| `parser-elastic` | Parses Winlogbeat logs in JSON format exported from Elasticsearch |
| `parse-cortex` | Queries EDR APIs for network connection data |
| `parse-cortex-evtx-forensics` | Queries EVTX logs collected by EDR forensic collection agents |
| `merge` | Combines multiple CSVs into a single chronologically sorted timeline |
| `load-neo4j` | Uploads a CSV to a Neo4j graph database for visualization |
| `load-memgraph` | Uploads a CSV to a Memgraph graph database for visualization |

---

## Quick Start

Download the latest binary from the [Releases page](https://github.com/jupyterj0nes/masstin/releases) — no installation needed.

```bash
# Parse Windows EVTX from a directory
masstin -a parse-windows -d /evidence/logs/ -o timeline.csv

# Parse Linux logs (supports ZIP with auto-password detection)
masstin -a parse-linux -d /evidence/triage/ -o linux-timeline.csv

# Load into Memgraph for visualization
masstin -a load-memgraph -f timeline.csv --database localhost:7687
```

![Masstin CLI output](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

---

## Documentation

### Artifacts

Detailed documentation for every artifact masstin parses:

| Artifact | Masstin action | Article |
|----------|---------------|---------|
| Security.evtx (30+ Event IDs) | `parse-windows` | [Security.evtx and lateral movement](/en/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | `parse-windows` | [Terminal Services EVTX](/en/artifacts/terminal-services-evtx/) |
| SMB EVTX | `parse-windows` | [SMB EVTX events](/en/artifacts/smb-evtx-events/) |
| Windows Prefetch | -- | [Windows Prefetch](/en/artifacts/windows-prefetch-forensics/) |
| Linux logs (auth.log, secure, utmp/wtmp) | `parse-linux` | [Linux forensic artifacts](/en/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | `parser-elastic` | [Winlogbeat: JSON artifacts](/en/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | `parse-cortex` / `parse-cortex-evtx-forensics` | [Cortex XDR: forensic artifacts](/en/artifacts/cortex-xdr-artifacts/) |

### Output Format

| Topic | Article |
|-------|---------|
| CSV columns, event_type classification, Event ID mapping | [CSV Format and Event Classification](/en/tools/masstin-csv-format/) |

### Graph Databases

| Database | Masstin action | Article |
|----------|---------------|---------|
| Neo4j | `load-neo4j` | [Neo4j and Cypher: lateral movement visualization](/en/tools/neo4j-cypher-visualization/) |
| Memgraph | `load-memgraph` | [Memgraph: in-memory visualization](/en/tools/memgraph-visualization/) |

---

## Why Rust?

| Aspect | Python (sabonis) | Rust (masstin) |
|--------|------------------|----------------|
| Performance | Baseline | ~90% faster |
| Dependencies | Python + libs | None (static binary) |
| Deployment | Install Python + pip | Copy binary |
| Artifacts | 7+ types | 10+ types |
| Graph databases | Manual CSV export | Direct upload to Neo4j and Memgraph |
| IP resolution | Manual | Automatic |

---

## Roadmap

- Event reconstruction even when EVTX logs have been deleted or tampered with
- VPN log parsing
- Generic parser for custom log formats
