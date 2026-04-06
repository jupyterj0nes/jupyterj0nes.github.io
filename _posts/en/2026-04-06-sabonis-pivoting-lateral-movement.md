---
layout: post
title: "Sabonis: Pivoting on Lateral Movement with Forensic Artifacts"
date: 2026-04-06 08:00:00 +0100
category: tools
lang: en
ref: tool-sabonis
tags: [sabonis, lateral-movement, evtx, neo4j, tools]
description: "Sabonis is a Python DFIR tool that parses forensic artifacts (EVTX, Squid, PCAP) to extract lateral movement evidence and visualize it in Neo4j."
comments: true
---

## What is Sabonis?

**Sabonis** is a DFIR pivoting tool built in Python that parses forensic artifacts to extract evidence of lateral movement. It's named after Arvydas Sabonis — because just like the legendary Lithuanian pivot, this tool pivots on data to find the connections that matter.

- **Repository:** [github.com/jupyterj0nes/sabonis](https://github.com/jupyterj0nes/sabonis)
- **License:** GPLv3
- **Language:** Python

## What artifacts does it process?

Sabonis can parse and correlate data from 7+ source types:

| Source | Type |
|--------|------|
| Windows Event Logs (.evtx) | Security, System, RDP, WinRM, PowerShell, SMB... |
| Squid Proxy Logs | Proxy logs |
| PCAP | Network captures |

## How does it work?

1. **Parses** the provided forensic artifacts
2. **Extracts** lateral movement evidence (RDP connections, WinRM sessions, authentications, etc.)
3. **Merges** all data into unified CSV files
4. **Exports** to Neo4j for graph visualization via Cypher queries

## Why Neo4j?

When investigating lateral movement in a compromised network, tables and CSVs fall short. You need to see the **relationships** between machines, users, and connections. Neo4j turns that data into an interactive graph where you can:

- See at a glance which machines communicate with each other
- Identify lateral movement patterns
- Trace the attacker's progression through the network
- Detect anomalous connections

## Upcoming posts

This is the main Sabonis page. Future posts will cover:

- Installation and setup
- Parsing each artifact type
- Loading data into Neo4j
- Useful Cypher queries for investigations
- Practical use cases

> **Note:** Sabonis has evolved into [masstin](/en/tools/masstin-lateral-movement-rust/), its Rust rewrite with ~90% better performance. If you're starting a new project, consider using masstin directly.
