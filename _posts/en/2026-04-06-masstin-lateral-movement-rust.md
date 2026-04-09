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

An attacker has compromised your network. They've moved laterally across Windows servers, Linux machines, and cloud infrastructure. Your evidence is scattered: EVTX files from 50 machines, Linux auth logs from a dozen servers, network data from your EDR. You need to reconstruct the attacker's path — every hop, every credential used, every failed attempt — and you need it **now**.

Masstin parses **all** these sources and merges them into a **single chronological timeline** where a Windows RDP logon, a Linux SSH brute-force, and an EDR network connection appear side by side, in the same format, ready for analysis or graph visualization.

- **Repository:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **License:** AGPL-3.0
- **Platforms:** Windows, Linux and macOS — zero dependencies, single binary

---

## Key Features

| Feature | Description | Article |
|---------|-------------|---------|
| Multi-directory incident analysis | Analyze dozens of machines at once with multiple `-d` flags, critical for ransomware investigations | [Parse evidence](#parse-evidence) |
| Cross-platform timeline | Windows EVTX + Linux SSH + EDR data merged into one CSV with `merge` | [Windows](/en/artifacts/security-evtx-lateral-movement/) / [Linux](/en/artifacts/linux-forensic-artifacts/) / [Cortex](/en/artifacts/cortex-xdr-artifacts/) |
| 30+ Event IDs from 9 Windows sources | Security.evtx, Terminal Services, SMBServer, SMBClient, RdpCoreTS — covering RDP, SMB, Kerberos, NTLM and share access | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) / [RDP](/en/artifacts/terminal-services-evtx/) / [SMB](/en/artifacts/smb-evtx-events/) |
| Event classification | Every event classified as `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` or `CONNECT` | [CSV Format — event_type](/en/tools/masstin-csv-format/) |
| Recursive decompression | Auto-extracts ZIP/triage packages recursively, handles archived logs with duplicate filenames, auto-detects common forensic passwords | [Linux artifacts — triage support](/en/artifacts/linux-forensic-artifacts/) |
| Linux smart inference | Auto-detects hostname, infers year from `dpkg.log`, supports Debian (`auth.log`) and RHEL (`secure`), RFC3164 and RFC5424 formats | [Linux artifacts — inference](/en/artifacts/linux-forensic-artifacts/) |
| Graph visualization with noise reduction | Direct upload to Neo4j or Memgraph with connection grouping (earliest date + count) and automatic IP-to-hostname resolution | [Neo4j](/en/tools/neo4j-cypher-visualization/) / [Memgraph](/en/tools/memgraph-visualization/) |
| Temporal path reconstruction | Cypher query to find the chronologically coherent attacker route between two nodes | [Neo4j — temporal path](/en/tools/neo4j-cypher-visualization/) / [Memgraph — temporal path](/en/tools/memgraph-visualization/) |
| Session correlation | `logon_id` field enables matching logon/logoff events to determine session duration | [CSV Format — logon_id](/en/tools/masstin-csv-format/) |
| Silent mode | `--silent` flag suppresses all output for integration with Velociraptor, SOAR platforms and automation pipelines | [Actions table](#available-actions) |
| **Bulk evidence processing** | Point `-d` at an evidence folder — masstin recursively finds all E01/VMDK/dd images, extracts EVTX + UAL from live + VSS of each, one command for an entire incident | |
| Forensic image analysis | Open E01, dd/raw, and VMDK images directly — Windows (NTFS + VSS + UAL) and Linux (ext4) — pure Rust, no mounting | [VSS recovery](/en/tools/masstin-vss-recovery/) |
| VSS snapshot recovery | Detect and extract EVTX from Volume Shadow Copies — recover event logs deleted by attackers | [VSS recovery](/en/tools/masstin-vss-recovery/) |
| Mounted volume support | Point `-d D:` at a mounted volume or use `--all-volumes` — live EVTX + VSS recovery from connected disks, no imaging needed | |
| UAL parsing | Auto-detect User Access Logging ESE databases — 3-year server logon history surviving event log clearing | [UAL](/en/tools/masstin-ual/) |
| Transparent reporting | CLI shows artifact discovery, processing progress, hostname/year inferences and per-artifact event counts | [Parse evidence](#parse-evidence) |

---

## Install

### Download pre-built binary (recommended)

> **No Rust toolchain needed.** Just download and run.

| Platform | Download |
|----------|----------|
| Windows | [`masstin-windows.exe`](https://github.com/jupyterj0nes/masstin/releases/latest) |
| Linux | [`masstin-linux`](https://github.com/jupyterj0nes/masstin/releases/latest) |
| macOS | [`masstin-macos`](https://github.com/jupyterj0nes/masstin/releases/latest) |

Go to [**Releases**](https://github.com/jupyterj0nes/masstin/releases) and download the binary for your platform. That's it.

### Build from source (alternative)

```bash
git clone https://github.com/jupyterj0nes/masstin.git
cd masstin && cargo build --release
```

### Parse evidence

```bash
# Analyze an entire incident: multiple machines, one timeline
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -d /evidence/WS-ADMIN -o timeline.csv

# Parse Linux logs (auto-extracts ZIPs, detects passwords)
masstin -a parse-linux -d /evidence/linux-triage/ -o linux.csv

# Merge Windows + Linux into a single cross-platform view
masstin -a merge -f timeline.csv -f linux.csv -o full-timeline.csv
```

![Masstin CLI output](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

### Visualize in a graph database

```bash
# Load into Memgraph (no auth needed)
masstin -a load-memgraph -f full-timeline.csv --database localhost:7687

# Load into Neo4j
masstin -a load-neo4j -f full-timeline.csv --database localhost:7687 --user neo4j
```

![Lateral movement graph in Memgraph Lab](/assets/images/memgraph_output1.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

### Reconstruct the attacker's path

The temporal path query finds the chronologically coherent route between two nodes:

```cypher
MATCH path = (start:host {name:'10.10.1.50'})-[*]->(end:host {name:'SRV-BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path ORDER BY length(path) LIMIT 5
```

![Temporal path in Memgraph](/assets/images/memgraph_temporal_path.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

---

## Available Actions

| Action | Description |
|--------|-------------|
| `parse-windows` | Parse Windows EVTX from directories or files (supports compressed triage packages) |
| `parse-linux` | Parse Linux logs: auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog |
| `parser-elastic` | Parse Winlogbeat JSON logs exported from Elasticsearch |
| `parse-cortex` | Query Cortex XDR API for network connections (RDP/SMB/SSH) |
| `parse-image-windows` | Open E01/dd/VMDK images, scan evidence folders (`-d /evidence/`), mounted volumes (`-d D:`), or `--all-volumes`. Extracts EVTX + UAL from live + VSS |
| `parse-image-linux` | Open E01/dd/VMDK images with ext4 partitions. Extracts auth.log, secure, messages, wtmp and other Linux logs |
| `parse-cortex-evtx-forensics` | Query Cortex XDR API for forensic EVTX collections across multiple machines |
| `merge` | Combine multiple CSVs into a single chronological timeline |
| `load-neo4j` | Upload timeline to Neo4j for graph visualization |
| `load-memgraph` | Upload timeline to Memgraph for in-memory graph visualization |

---

## Documentation

### Artifacts

| Artifact | Article |
|----------|---------|
| Security.evtx (30+ Event IDs) | [Security.evtx and lateral movement](/en/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/en/artifacts/terminal-services-evtx/) |
| SMB EVTX | [SMB EVTX events](/en/artifacts/smb-evtx-events/) |
| Linux logs | [Linux forensic artifacts](/en/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat artifacts](/en/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR artifacts](/en/artifacts/cortex-xdr-artifacts/) |

### Output Format and Advanced Features

| Topic | Article |
|-------|---------|
| CSV columns, event_type, Event ID mapping, logon_id, detail | [CSV Format and Event Classification](/en/tools/masstin-csv-format/) |
| Forensic image analysis and VSS recovery | [Recovering deleted logs from VSS](/en/tools/masstin-vss-recovery/) |
| User Access Logging (UAL) | [Server access history from ESE databases](/en/tools/masstin-ual/) |
| vshadow-rs — pure Rust VSS parser | [vshadow-rs](/en/tools/vshadow-rs/) |

### Graph Databases

| Database | Article |
|----------|---------|
| Neo4j | [Neo4j and Cypher: visualization and queries](/en/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: in-memory visualization](/en/tools/memgraph-visualization/) |
