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

## Available Actions

| Action | Description |
|--------|-------------|
| `parse-windows` | Parses Windows EVTX files and generates the lateral movement CSV timeline |
| `parse-linux` | Parses Linux logs (secure, messages, audit.log, utmp, wtmp, btmp, lastlog) |
| `parser-elastic` | Parses Winlogbeat logs in JSON format exported from Elasticsearch |
| `parse-cortex` | Queries EDR APIs for network connection data |
| `parse-cortex-evtx-forensics` | Queries EVTX logs collected by EDR forensic collection agents |
| `merge` | Combines multiple CSVs into a single chronologically sorted timeline |
| `load-neo4j` | Uploads a CSV to a Neo4j graph database for visualization |
| `load-memgraph` | Uploads a CSV to a Memgraph graph database for visualization |

## Documentation Index

### Artifacts

| Artifact | Masstin action | Article |
|----------|---------------|---------|
| Security.evtx | `parse-windows` | [Security.evtx and lateral movement](/en/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | `parse-windows` | [Terminal Services EVTX](/en/artifacts/terminal-services-evtx/) |
| SMB EVTX | `parse-windows` | [SMB EVTX events](/en/artifacts/smb-evtx-events/) |
| Windows Prefetch | — | [Windows Prefetch](/en/artifacts/windows-prefetch-forensics/) |
| Linux logs | `parse-linux` | [Linux forensic artifacts](/en/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | `parser-elastic` | [Winlogbeat: JSON artifacts](/en/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | `parse-cortex` / `parse-cortex-evtx-forensics` | [Cortex XDR: forensic artifacts](/en/artifacts/cortex-xdr-artifacts/) |

### Graph Databases

| Database | Masstin action | Article |
|----------|---------------|---------|
| Neo4j | `load-neo4j` | [Neo4j and Cypher: lateral movement visualization](/en/tools/neo4j-cypher-visualization/) |
| Memgraph | `load-memgraph` | [Memgraph: in-memory visualization](/en/tools/memgraph-visualization/) |

## Supported Artifacts

### Windows Event Logs (EVTX)

| Event Log | Event IDs | What it detects |
|-----------|-----------|-----------------|
| Security.evtx | 4624, 4625, 4634, 4647, 4648, 4768, 4769, 4770, 4771, 4776, 4778, 4779 | Logons, logoffs, Kerberos, NTLM, RDP reconnect |
| TerminalServices-LocalSessionManager | 21, 22, 24, 25 | Incoming/outgoing RDP sessions |
| TerminalServices-RDPClient | 1024, 1102 | Outgoing RDP connections |
| TerminalServices-RemoteConnectionManager | 1149 | Incoming RDP connections accepted |
| RdpCoreTS | 131 | RDP transport negotiation |
| SMBServer/Security | 1009, 551 | SMB server connections and auth |
| SMBClient/Security | 31001 | SMB client share access |
| SMBClient/Connectivity | 30803-30808 | SMB connectivity events |

### Linux

| Source | What it captures |
|--------|-----------------|
| `/var/log/secure`, `/var/log/messages` | SSH success, failure, connection attempts |
| `/var/log/audit/audit.log` | Authentication events via audit subsystem |
| `utmp` / `wtmp` | Active and historical login sessions |
| `btmp` | Failed login attempts |
| `lastlog` | Last login per user |

### Other Sources

| Source | What it captures |
|--------|-----------------|
| Winlogbeat JSON | All 28 Windows Event IDs in JSON format |
| EDR (network) | Network connections to RDP (3389), SMB (445), SSH (22) ports |
| EDR (EVTX Forensics) | EVTX logs collected by forensic agents |

## Compressed Triage Support

Masstin can directly process compressed triage packages generated by tools like **Velociraptor** or EDR offline collectors. It recursively decompresses the packages and identifies all EVTX files within them, even when there are archived logs with duplicate filenames.

```bash
masstin -a parse-windows -d /evidence/triage_packages/ -o timeline.csv
```

## Usage

### Parse Windows EVTX

```bash
# Parse a directory with artifacts from multiple machines
masstin -a parse-windows -d /evidence/machine1/logs -d /evidence/machine2/logs -o timeline.csv

# Parse individual EVTX files
masstin -a parse-windows -f Security.evtx -f System.evtx -o timeline.csv

# Time filtering
masstin -a parse-windows -d /evidence/ -o timeline.csv \
  --start-time "2024-08-12 00:00:00" \
  --end-time "2024-08-14 00:00:00"

# Overwrite existing output
masstin -a parse-windows -d /evidence/ -o timeline.csv --overwrite
```

![Masstin CLI output](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

### Parse Linux logs

```bash
masstin -a parse-linux -d /evidence/var/log/ -o linux-timeline.csv
```

### Parse Winlogbeat JSON

```bash
masstin -a parser-elastic -d /evidence/winlogbeat/ -o elastic-timeline.csv
```

### Parse EDR

```bash
# Network connections
masstin -a parse-cortex --cortex-url api-xxxx.xdr.example.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o edr-network.csv

# EVTX collected by forensic agents
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.example.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o edr-evtx.csv
```

### Merge: combine multiple timelines

```bash
masstin -a merge -f timeline1.csv -f timeline2.csv -o merged.csv
```

### Load into graph database

```bash
# Neo4j
masstin -a load-neo4j -f timeline.csv --database localhost:7687 --user neo4j

# Memgraph
masstin -a load-memgraph -f timeline.csv --database localhost:7687
```

### CSV Output Format

| Field | Description |
|-------|-------------|
| `time_created` | Event timestamp (UTC) |
| `dst_computer` | Destination hostname |
| `event_id` | Windows Event ID or equivalent |
| `subject_user_name` | Source user account |
| `subject_domain_name` | Source domain |
| `target_user_name` | Target user account |
| `target_domain_name` | Target domain |
| `logon_type` | Logon type (3=Network/SMB, 10=RDP, SSH) |
| `src_computer` | Source hostname |
| `src_ip` | Source IP address |
| `process` | Process that initiated the action |
| `log_filename` | Original log file |

## Key Features

### Automatic IP -> Hostname Resolution

Masstin analyzes IP-hostname association frequency within the logs themselves to automatically resolve IPs to machine names, without needing an external DNS.

### Connection Grouping

To reduce noise in investigations with thousands of events, masstin groups repetitive connections between the same machines, letting you see patterns without drowning in data.

### Pre-built Cypher Queries

The repository includes ready-to-use Cypher queries for graph databases that enable:

- Visualizing the complete lateral movement graph
- Identifying machines with the most incoming connections (potential targets)
- Detecting anomalous movement patterns
- Tracing a specific user/attacker's progression
- Reconstructing the temporal attack path between two hosts

## Why Rust?

| Aspect | Python (sabonis) | Rust (masstin) |
|--------|------------------|----------------|
| Performance | Baseline | ~90% faster |
| Dependencies | Python + libs | None (static binary) |
| Deployment | Install Python + pip | Copy binary |
| Artifacts | 7+ types | 10+ types |
| Graph databases | Manual CSV export | Direct upload to Neo4j and Memgraph |
| IP resolution | Manual | Automatic |

## Roadmap

- Event reconstruction even when EVTX logs have been deleted or tampered with
- VPN log parsing
- Generic parser for custom log formats
