---
layout: post
title: "Masstin: Lateral Movement Analysis at Rust Speed"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: en
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, evtx, tools]
description: "Masstin is a Rust-based DFIR tool that parses 10+ forensic artifact types and generates unified lateral movement timelines, with direct Neo4j integration."
comments: true
---

## The problem

You're in the middle of an incident response. You've got 50 compromised machines, each with rotated event logs, your SIEM only forwarded a fraction of the events, and you need to reconstruct how the attacker moved through the network. **Now.**

Generic tools give you too much noise. Manually reviewing EVTX files is not an option. You need something that extracts *only* lateral movement data from all those artifacts, unifies them into a single timeline, and lets you visualize the relationships between machines.

That's what **masstin** is for.

## What is Masstin?

Masstin is a DFIR tool written in **Rust** that parses 10+ forensic artifact types and merges them into a **unified chronological CSV timeline**, focused exclusively on lateral movement. It's the evolution of [sabonis](/en/tools/sabonis-pivoting-lateral-movement/), rewritten from scratch to achieve ~90% better performance.

- **Repository:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **License:** GPLv3
- **Platforms:** Windows and Linux (prebuilt binaries, no dependencies)

## Supported artifacts

Masstin parses the following Windows Event Log (.evtx) types:

| Event Log | Relevant Event IDs | What it detects |
|-----------|-------------------|-----------------|
| Security.evtx | 4624, 4625, 4648 | Logons, failed logons, explicit logons |
| TerminalServices-LocalSessionManager | 21, 22, 23, 24, 25 | Incoming/outgoing RDP sessions |
| SMBServer | SMB connections | Network share access |
| SMBClient | Outgoing SMB connections | Lateral movement via SMB |
| System.evtx | 7045 | Remote service installation |
| WinRM | WinRM connections | Remote execution via PowerShell |
| PowerShell | Script blocks, modules | Remote script execution |

## Usage

### Parsing: generate the CSV timeline

```bash
# Parse a directory with artifacts from multiple machines
masstin -a parse -d /evidence/machine1/logs -d /evidence/machine2/logs -o timeline.csv

# Parse individual EVTX files
masstin -a parse -f Security.evtx -f System.evtx -o timeline.csv

# Overwrite existing output
masstin -a parse -d /evidence/ -o timeline.csv --overwrite
```

### Loading into Neo4j: graph visualization

```bash
masstin -a load -f timeline.csv --database localhost:7687 --user neo4j
```

### CSV output format

Each CSV row contains:

| Field | Description |
|-------|-------------|
| `timestamp` | Event timestamp |
| `dest_computer` | Destination machine |
| `event_id` | Windows Event ID |
| `username` | User who performed the action |
| `domain` | User's domain |
| `logon_type` | Logon type (3=network, 10=RDP, etc.) |
| `src_computer` | Source machine |
| `src_ip` | Source IP address |
| `log_filename` | Source log file |

## Key features

### Automatic IP → Hostname resolution

Masstin analyzes IP-hostname association frequency within the logs themselves to automatically resolve IPs to machine names, without needing an external DNS.

### Connection grouping

To reduce noise in investigations with thousands of events, masstin groups repetitive connections between the same machines, letting you see patterns without drowning in data.

### Pre-built Cypher queries

The repository includes ready-to-use Cypher queries for Neo4j that enable:

- Visualizing the complete lateral movement graph
- Identifying machines with the most incoming connections (potential targets)
- Detecting anomalous movement patterns
- Tracing a specific user/attacker's progression

## Why Rust?

| Aspect | Python (sabonis) | Rust (masstin) |
|--------|------------------|----------------|
| Performance | Baseline | ~90% faster |
| Dependencies | Python + libs | None (static binary) |
| Deployment | Install Python + pip | Copy binary |
| Artifacts | 7+ types | 10+ types |
| Neo4j | Manual CSV export | Direct upload |
| IP resolution | Manual | Automatic |

In investigations with dozens of machines and GBs of logs, the performance difference isn't a luxury — it's a necessity.

## Upcoming posts

Future articles will cover:

- Step-by-step installation guide
- Deep dive into each supported artifact type
- Neo4j setup for visualization
- Advanced Cypher queries for complex investigations
- Case study: reconstructing a ransomware attack with masstin
