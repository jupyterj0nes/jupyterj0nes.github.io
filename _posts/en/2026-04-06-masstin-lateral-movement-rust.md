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

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "masstin",
  "alternateName": "Masstin",
  "description": "Masstin is a Rust-based DFIR tool that parses Windows EVTX, Linux logs, UAL databases, Cortex XDR exports, custom logs and forensic disk images (E01/dd/VMDK including streamOptimized) into a unified lateral movement timeline, with Neo4j and Memgraph graph visualization.",
  "url": "https://weinvestigateanything.com/en/tools/masstin-lateral-movement-rust/",
  "downloadUrl": "https://github.com/jupyterj0nes/masstin/releases/latest",
  "softwareVersion": "0.13.0",
  "applicationCategory": "SecurityApplication",
  "applicationSubCategory": "Digital Forensics and Incident Response",
  "operatingSystem": "Windows, Linux, macOS",
  "programmingLanguage": "Rust",
  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
  "codeRepository": "https://github.com/jupyterj0nes/masstin",
  "author": {
    "@type": "Person",
    "name": "Toño Díaz",
    "url": "https://github.com/jupyterj0nes",
    "sameAs": "https://www.linkedin.com/in/antoniodiazcastano/"
  },
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "keywords": "DFIR, lateral movement, EVTX, UAL, VSS, Neo4j, Memgraph, Velociraptor, KAPE, Cortex XDR, incident response, digital forensics, Rust, EVTX carving, BitLocker, Windows Security events, 4624, 4778, 4779"
}
</script>

![Masstin Logo](/assets/images/masstin-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 600px;" loading="lazy"}

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
| **Unified cross-OS image parsing** | **Single `parse-image` command auto-detects OS per partition** — NTFS gets Windows parsing (EVTX + UAL + VSS), ext4 gets Linux parsing (auth.log, wtmp, etc.) — all merged into one timeline. Point at a folder of mixed images and get a single CSV. Zero manual steps.  | [Forensic images](/en/tools/masstin-vss-recovery/) |
| Multi-directory incident analysis | Analyze dozens of machines at once with multiple `-d` flags, critical for ransomware investigations | [Parse evidence](#parse-evidence) |
| Cross-platform timeline | Windows EVTX + Linux SSH + EDR data in one timeline — `parse-image` auto-merges across OS boundaries | [Windows](/en/artifacts/security-evtx-lateral-movement/) / [Linux](/en/artifacts/linux-forensic-artifacts/) / [Cortex](/en/artifacts/cortex-xdr-artifacts/) |
| 32+ Event IDs from 11 EVTX sources + Scheduled Tasks XML | Security.evtx, Terminal Services, SMBServer, SMBClient, RdpCoreTS, WinRM, WMI-Activity + remote task detection — covering RDP, SMB, Kerberos, NTLM, share access, PowerShell Remoting, WMI and Scheduled Tasks | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) / [RDP](/en/artifacts/terminal-services-evtx/) / [SMB](/en/artifacts/smb-evtx-events/) |
| Event classification | Every event classified as `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` or `CONNECT` | [CSV Format — event_type](/en/tools/masstin-csv-format/) |
| Recursive decompression | Auto-extracts ZIP/triage packages recursively, handles archived logs with duplicate filenames, auto-detects common forensic passwords | [Linux artifacts — triage support](/en/artifacts/linux-forensic-artifacts/) |
| Linux smart inference | Auto-detects hostname, infers year from `dpkg.log`, supports Debian (`auth.log`) and RHEL (`secure`), RFC3164 and RFC5424 formats | [Linux artifacts — inference](/en/artifacts/linux-forensic-artifacts/) |
| Graph visualization with noise reduction | Direct upload to Neo4j or Memgraph with connection grouping (earliest date + count) and automatic IP-to-hostname resolution | [Neo4j](/en/tools/neo4j-cypher-visualization/) / [Memgraph](/en/tools/memgraph-visualization/) |
| Temporal path reconstruction | Cypher query to find the chronologically coherent attacker route between two nodes | [Neo4j — temporal path](/en/tools/neo4j-cypher-visualization/) / [Memgraph — temporal path](/en/tools/memgraph-visualization/) |
| Session correlation | `logon_id` field enables matching logon/logoff events to determine session duration | [CSV Format — logon_id](/en/tools/masstin-csv-format/) |
| Silent mode | `--silent` flag suppresses all output for integration with Velociraptor, SOAR platforms and automation pipelines | [Actions table](#available-actions) |
| **Bulk evidence processing** | Point `-d` at an evidence folder — masstin recursively finds all E01/VMDK/dd images, auto-detects OS per partition, extracts all artifacts from live + VSS, per-image artifact grouping in summary. One command for an entire incident | [Forensic images](/en/tools/masstin-vss-recovery/) |
| BitLocker detection | Detects BitLocker-encrypted partitions (`-FVE-FS-` signature) and warns the analyst — no wasted time on unreadable data | [Forensic images](/en/tools/masstin-vss-recovery/) |
| streamOptimized VMDK | Full support for compressed VMDKs (OVA exports, cloud templates). Also handles incomplete SFTP uploads (`.filepart` fallback) | [Forensic images](/en/tools/masstin-vss-recovery/) |
| VSS snapshot recovery | Detect and extract EVTX from Volume Shadow Copies — recover event logs deleted by attackers | [VSS recovery](/en/tools/masstin-vss-recovery/) |
| Mounted volume support | Point `-d D:` at a mounted volume or use `--all-volumes` — live EVTX + VSS recovery from connected disks, no imaging needed | [Forensic images](/en/tools/masstin-vss-recovery/) |
| UAL parsing | Auto-detect User Access Logging ESE databases — 3-year server logon history surviving event log clearing | [UAL](/en/tools/masstin-ual/) |
| MountPoints2 registry | Extract NTUSER.DAT from each user profile and parse MountPoints2 — reveals user→server share connections with timestamps, survives log clearing. Dirty hive + transaction log support | [MountPoints2](/en/artifacts/mountpoints2-lateral-movement/) |
| EVTX carving | `carve-image` scans raw disk for EVTX chunks in unallocated space — recovers events after logs AND VSS are deleted. Implements Tier 1 (full 64 KB chunks) + Tier 2 (orphan record detection); Tier 3 (template matching) is planned. Builds synthetic EVTX files grouped by provider and parses them through the full pipeline. Hardened against upstream parser bugs (infinite loops, multi-GB OOMs) via thread isolation + `alloc_error_hook`; `--skip-offsets` for pathological E01s | [EVTX carving](/en/tools/evtx-carving-unallocated/) |
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
# Forensic images — auto-detects Windows and Linux, single merged timeline
masstin -a parse-image -f DC01.e01 -f ubuntu-server.vmdk -o timeline.csv

# Scan entire evidence folder — any mix of Windows/Linux images
masstin -a parse-image -d /evidence/all_machines/ -o full_timeline.csv

# Parse extracted logs from directories
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -o windows.csv
masstin -a parse-linux -d /evidence/linux-triage/ -o linux.csv
```

![Masstin CLI output](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

### Visualize in a graph database

```bash
# Load into Memgraph (no auth needed)
masstin -a load-memgraph -f full-timeline.csv --database localhost:7687

# Load into Neo4j
masstin -a load-neo4j -f full-timeline.csv --database localhost:7687 --user neo4j
```

![Lateral movement graph in Memgraph Lab](/assets/images/memgraph_output1.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

### Reconstruct the attacker's path

The temporal path query finds the chronologically coherent route between two nodes:

```cypher
MATCH path = (start:host {name:'10.10.1.50'})-[*]->(end:host {name:'SRV-BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path ORDER BY length(path) LIMIT 5
```

![Temporal path in Memgraph](/assets/images/memgraph_temporal_path.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

---

## Available Actions

| Action | Description |
|--------|-------------|
| `parse-windows` | Parse Windows EVTX from directories or files (supports compressed triage packages) |
| `parse-linux` | Parse Linux logs: auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog |
| `parser-elastic` | Parse Winlogbeat JSON logs exported from Elasticsearch |
| `parse-cortex` | Query Cortex XDR API for network connections (RDP/SMB/SSH) |
| `parse-image` | **Auto-detects OS per partition.** Open E01/dd/VMDK images (including streamOptimized), scan evidence folders (`-d /evidence/`), mounted volumes (`-d D:`), or `--all-volumes`. Detects BitLocker. NTFS → EVTX + UAL + VSS + Tasks. ext4 → Linux logs. All merged into one CSV |
| `parse-massive` | Like `parse-image` but also includes loose EVTX and log files from `-d` directories — use when evidence is a mix of disk images and extracted triage packages |
| `carve-image` | **Last resort recovery.** Scans raw disk for EVTX chunks in unallocated space. Recovers lateral movement events after logs + VSS are deleted. Use `--carve-unalloc` for unallocated-only scan |
| `parse-cortex-evtx-forensics` | Query Cortex XDR API for forensic EVTX collections across multiple machines |
| `parse-custom` | Parse arbitrary text logs (VPN, firewall, proxy, web app) using YAML rule files. Bring your own log format — see [masstin custom parsers](/en/tools/masstin-custom-parsers/) |
| `merge` | Combine multiple CSVs into a single chronological timeline |
| `load-neo4j` | Upload timeline to Neo4j for graph visualization |
| `load-memgraph` | Upload timeline to Memgraph for in-memory graph visualization |
| `merge-neo4j-nodes` | Fuse two `:host` graph nodes after loading (e.g., when an IP and a hostname were not auto-unified). No APOC required |
| `merge-memgraph-nodes` | Same as above, for Memgraph. No MAGE required |

---

## Documentation

### Artifacts

| Artifact | Article |
|----------|---------|
| Security.evtx (14 Event IDs) | [Security.evtx and lateral movement](/en/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/en/artifacts/terminal-services-evtx/) |
| SMB EVTX | [SMB EVTX events](/en/artifacts/smb-evtx-events/) |
| WinRM, WMI-Activity + Scheduled Tasks | PowerShell Remoting (Event 6), remote WMI (Event 5858) and remotely created tasks (Author field) | [WinRM, WMI & Tasks](/en/artifacts/winrm-wmi-schtasks-lateral-movement/) |
| MountPoints2 (NTUSER.DAT) | Remote share connections from registry — user→server with timestamps, survives log clearing | [MountPoints2](/en/artifacts/mountpoints2-lateral-movement/) |
| Linux logs | [Linux forensic artifacts](/en/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat artifacts](/en/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR artifacts](/en/artifacts/cortex-xdr-artifacts/) |
| **Custom parsers (BYO logs)** | VPN, firewall, proxy, web app — define your own log format with a YAML rule file and parse it like any other source. [masstin custom parsers](/en/tools/masstin-custom-parsers/) |

### Output Format and Advanced Features

| Topic | Article |
|-------|---------|
| CSV columns, event_type, Event ID mapping, logon_id, detail | [CSV Format and Event Classification](/en/tools/masstin-csv-format/) |
| Forensic image analysis and VSS recovery | [Recovering deleted logs from VSS](/en/tools/masstin-vss-recovery/) |
| User Access Logging (UAL) | [Server access history from ESE databases](/en/tools/masstin-ual/) |
| vshadow-rs — pure Rust VSS parser | [vshadow-rs](/en/tools/vshadow-rs/) |
| Triage detection (KAPE / Velociraptor / Cortex) — automatic recognition of triage packages inside `parse-image` and `parse-massive` | [Triage detection in masstin](/en/tools/masstin-triage-detection/) |

### Graph Databases

| Database | Article |
|----------|---------|
| Neo4j | [Neo4j and Cypher: visualization and queries](/en/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: in-memory visualization](/en/tools/memgraph-visualization/) |
