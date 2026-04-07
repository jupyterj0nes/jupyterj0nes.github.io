---
layout: post
title: "Cortex XDR: Lateral Movement Forensic Artifacts"
date: 2026-04-07 13:00:00 +0100
category: artifacts
lang: en
ref: artifact-cortex-xdr
tags: [cortex-xdr, lateral-movement, dfir, masstin, edr, palo-alto]
description: "How masstin leverages Cortex XDR in two modes -- network connections and EVTX forensic collection -- to detect lateral movement."
comments: true
---

## Cortex XDR as a Forensic Source

Palo Alto Cortex XDR is an EDR/XDR platform that provides visibility into endpoint activity. For lateral movement analysis, Cortex XDR offers two complementary data sources that [masstin](/en/tools/masstin-lateral-movement-rust/) can leverage:

1. **Network connections mode:** network connection data captured by Cortex XDR agents on each endpoint.
2. **EVTX Forensics mode:** Windows Event Logs collected by forensic collection agents deployed to endpoints.

---

## Mode 1: Network Connections

### What It Captures

Cortex XDR agents record network connections established by processes on each endpoint. For lateral movement, the most relevant ports are:

| Port | Protocol | Relevance |
|:----:|----------|-----------|
| 3389 | RDP | Remote Desktop sessions |
| 445 | SMB | Share access, PsExec, WMI |
| 22 | SSH | Remote access to servers |

Masstin queries the Cortex XDR API for network connection data on these ports, extracting information about which machines connected to each other, when, and through which protocols.

### What Information You Get

Cortex XDR network events provide the **endpoint perspective**, complementing network logs (firewalls, proxies) and EVTX. They include data such as:

- Connection timestamp
- Source and destination IP and port
- Process that established the connection
- User under which the process runs
- Connection direction (inbound or outbound)

> **Forensic value:** Cortex XDR network events show not only that a connection occurred on a lateral movement port, but **which process** initiated it. This allows distinguishing between a legitimate RDP connection via `mstsc.exe` and a suspicious connection from an unexpected process.

### How Masstin Retrieves This Data

```bash
masstin -a parse-cortex --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-network.csv
```

Masstin queries the Cortex XDR API directly, filters connections to ports relevant to lateral movement, and generates the CSV timeline in the same normalized format as all other artifacts.

---

## Mode 2: EVTX Forensics (Forensic Collection)

### What Are Cortex XDR Forensic Collection Agents

Cortex XDR allows deploying **forensic collection agents** to endpoints during an investigation. These are lightweight agents that are temporarily installed on target machines to collect forensic artifacts -- including Windows Event Log (EVTX) files -- and send them to the Cortex XDR cloud for analysis.

Forensic collection agents are especially useful when:

- You don't have direct access to the compromised machines
- You need to collect evidence from multiple endpoints in a centralized manner
- Local logs may have been tampered with and you need a cloud copy
- The organization already has Cortex XDR deployed and doesn't want to install additional tools

### What Logs They Collect

The forensic collection agents capture Windows Event Logs from the endpoints, including the logs most relevant to lateral movement:

- **Security.evtx** -- logons, authentication, Kerberos, NTLM
- **TerminalServices-LocalSessionManager** -- RDP sessions
- **SMBServer/Security** and **SMBClient/Security** -- SMB connections
- **System.evtx** -- remote service installation

Once collected, these logs are available in the Cortex XDR platform and can be queried.

### How Masstin Retrieves This Data

```bash
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-evtx.csv
```

Masstin queries the logs collected by the forensic agents and extracts lateral movement events, generating them in the same normalized CSV format.

> **Practical advantage:** Instead of having to physically access each machine or deploy triage tools like KAPE, you can leverage the existing Cortex XDR infrastructure to collect EVTX files remotely and centrally, then analyze them with masstin.

---

## Mode Comparison

| Aspect | Network Connections | EVTX Forensics |
|--------|-------------------|----------------|
| **Data source** | Network events captured by Cortex agents | EVTX logs collected by forensic agents |
| **What it provides** | Connections by process to key ports | Full Windows Event Log events |
| **Ports/Event IDs** | 3389, 445, 22 | 4624, 4625, 4648, 21, 22, 7045, etc. |
| **Masstin action** | `parse-cortex` | `parse-cortex-evtx-forensics` |
| **When to use** | Complement EVTX with endpoint network data | When you lack direct access to EVTX files |

---

## Integrated Workflow

The recommended workflow when Cortex XDR is available:

| Step | Action | Source |
|:----:|--------|--------|
| 1 | Deploy forensic collection agents on key endpoints | Cortex XDR |
| 2 | Retrieve network connections via API | `parse-cortex` |
| 3 | Retrieve collected forensic EVTX logs | `parse-cortex-evtx-forensics` |
| 4 | Supplement with native EVTX if available | `parse` |
| 5 | Unify everything into a single timeline | `merge` |
| 6 | Visualize in Neo4j | `load` |

Data from both Cortex XDR modes integrates into the timeline with the same normalized fields as native EVTX, enabling correlation between a network connection seen by Cortex and a logon recorded in Security.evtx.

---

## Conclusion

Cortex XDR provides two complementary forensic data sources for lateral movement. Network connections give you the perspective of which processes are communicating over suspicious ports, while EVTX forensic collection gives you access to full Windows Event Logs without needing to physically access each machine.

[Masstin](/en/tools/masstin-lateral-movement-rust/) integrates both sources into a single timeline, allowing you to combine them with native EVTX, Winlogbeat data, and Linux logs for a complete picture of lateral movement.
