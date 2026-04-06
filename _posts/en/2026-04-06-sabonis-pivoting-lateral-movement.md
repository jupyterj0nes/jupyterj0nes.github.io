---
layout: post
title: "Sabonis: The Pivot That Connects the Dots of Lateral Movement"
date: 2026-04-06 08:00:00 +0100
category: tools
lang: en
ref: tool-sabonis
tags: [sabonis, lateral-movement, evtx, pcap, squid, neo4j, tools]
description: "Sabonis is a Python DFIR tool that parses EVTX, PCAP, and Squid proxy logs to extract, merge, and visualize lateral movement in Neo4j."
comments: true
---

## Why "Sabonis"?

Arvydas Sabonis was one of the greatest pivots in basketball history. His ability to read the game, connect his teammates, and find the impossible pass made him unique. This tool does exactly that: it **pivots on forensic data** to find the lateral movement connections that other analyses miss.

## What is Sabonis?

Sabonis is a DFIR tool written in **Python** that provides a fast way to parse EVTX, PCAP, and Squid proxy log files, extracting exclusively the information related to **lateral movement**.

- **Repository:** [github.com/jupyterj0nes/sabonis](https://github.com/jupyterj0nes/sabonis)
- **License:** GPLv3
- **Language:** Python

> **Note:** Sabonis has been succeeded by [masstin](/en/tools/masstin-lateral-movement-rust/), its Rust rewrite with ~90% better performance and more supported artifacts. If you're starting a new project, we recommend masstin. Sabonis remains relevant for understanding the underlying logic and for environments where Python is more convenient.

## Supported data sources

Unlike masstin which focuses on EVTX, sabonis has a broader scope:

### Windows Event Logs (.evtx)

Extracts and merges lateral movement from **7+ EVTX file types**:

- **Security.evtx** — Logons (4624), failed logons (4625), explicit logons (4648)
- **TerminalServices** — RDP sessions
- **SMBServer/SMBClient** — Network share access
- **System.evtx** — Remotely installed services
- **WinRM** — Remote execution
- **PowerShell** — Remote script blocks

### Network captures (PCAP)

Extracts all lateral movements from PCAP files, identifying inter-machine connections by protocol.

### Squid proxy logs

Parses Squid proxy events to correlate network activity with host artifacts.

## Workflow

### 1. Pre-processing

EVTX files must first be converted using `pivotfoot.sh`:

```bash
./pivotfoot.sh /evidence/evtx/
```

### 2. Parsing and CSV generation

```bash
# Parse EVTX
python sabonis.py parse evtx --directory /evidence/evtx/ -o lateral_movement.csv

# Parse PCAP
python sabonis.py parse pcap -f capture.pcap -o network_lateral.csv

# Parse Squid
python sabonis.py parse squid -f access.log -o proxy_lateral.csv

# Useful options
python sabonis.py parse evtx --directory /evidence/ -o output.csv \
  --ignore_local \
  --exclusionlist exclusions.txt \
  --timezone "Europe/Madrid"
```

### 3. Loading into Neo4j

```bash
python sabonis.py load2neo -f lateral_movement.csv --database localhost:7687 --user neo4j
```

## Key options

| Option | Description |
|--------|-------------|
| `--ignore_local` | Filters local connections, showing only remote ones |
| `--exclusionlist` | List of IPs/hosts to exclude from analysis |
| `--focuslist` | List of IPs/hosts to focus on exclusively |
| `--timezone` | Standardize timestamps across time zones |

## The Neo4j advantage

When you have 20 machines, each with thousands of logon events, CSV tables become unmanageable. In Neo4j:

- Each **machine** is a node
- Each **lateral connection** is a relationship
- You can query things like: *"What machines did user ADMIN touch in the last 24 hours?"*

The repository includes a **Cypher Playbook** with pre-built queries for the most common investigation scenarios.

## Upcoming posts

- Environment installation and setup
- Practical EVTX analysis with sabonis
- Parsing PCAPs for lateral movement
- Neo4j setup + Cypher Playbook
- Detailed sabonis vs masstin comparison
