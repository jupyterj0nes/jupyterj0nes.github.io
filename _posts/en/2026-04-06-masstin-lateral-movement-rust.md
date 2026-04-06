---
layout: post
title: "Masstin: Lateral Movement at Rust Speed"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: en
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, tools]
description: "Masstin is the evolution of Sabonis, rewritten in Rust. It parses 10+ forensic artifact types and generates unified lateral movement timelines."
comments: true
---

## What is Masstin?

**Masstin** is the evolution of [Sabonis](/en/tools/sabonis-pivoting-lateral-movement/), rewritten from scratch in Rust to achieve ~90% better performance. It's a DFIR tool that parses 10+ forensic artifact types and unifies them into a chronological CSV timeline focused on lateral movement.

- **Repository:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **License:** GPLv3
- **Language:** Rust
- **Platforms:** Windows and Linux (no dependencies)

## Why Rust?

Masstin was born from real investigation needs:

- **Multiple machines** with rotated logs
- **Incomplete SIEM forwarding** — you need to parse the originals
- **Massive data volumes** where Python fell short

Rust provided the speed needed without sacrificing functionality.

## Key features

- Parsing of **10+ forensic artifact types**
- Unified chronological **CSV** timeline
- **Direct Neo4j upload** for graph visualization
- **Pre-built Cypher queries** ready to use
- **Automatic IP → hostname resolution**
- **Connection grouping** to reduce noise
- Cross-platform, no dependencies

## Sabonis vs Masstin

| | Sabonis | Masstin |
|--|---------|---------|
| Language | Python | Rust |
| Performance | Baseline | ~90% faster |
| Artifacts | 7+ types | 10+ types |
| Neo4j | CSV export | Direct upload |
| Cypher queries | Manual | Pre-built |
| IP resolution | No | Automatic |
| Dependencies | Python + libs | None |

## Upcoming posts

This is the main Masstin page. Future posts will cover:

- Building and installation
- Supported artifact types
- Neo4j setup
- Advanced Cypher queries
- Performance comparison with Sabonis
- Real-world investigation cases
