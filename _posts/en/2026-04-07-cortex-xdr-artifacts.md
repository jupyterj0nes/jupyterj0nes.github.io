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

Cortex XDR agents record network connections established by processes on each endpoint. For lateral movement, the default admin port set masstin queries is:

| Port | Protocol | Relevance |
|:----:|----------|-----------|
| 22   | SSH | Remote access to servers |
| 445  | SMB | Share access, PsExec |
| 3389 | RDP | Remote Desktop sessions |
| 5985 | WinRM (HTTP)  | PowerShell Remoting |
| 5986 | WinRM (HTTPS) | PowerShell Remoting |

`--admin-ports` widens the set further to include 135 (RPC), 139 (NetBIOS), 1433 (MSSQL), 3306 (MySQL) and 5900 (VNC) for broader pivot visibility. `--ignore-local` pushes loopback/link-local/self-connection filtering server-side so less data has to traverse the stream, and `--start-time`/`--end-time` over wide windows auto-paginate via time bisection when an individual window hits the 1M API cap.

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

The same backing dataset (`forensics_event_log`) also receives logs uploaded by the **Cortex XDR offline collector**, so triage packages gathered from air-gapped or unreachable hosts and pushed into the tenant are queried through the exact same path as those collected remotely by the forensic agent.

Forensic collection agents are especially useful when:

- You don't have direct access to the compromised machines
- You need to collect evidence from multiple endpoints in a centralized manner
- Local logs may have been tampered with and you need a cloud copy
- The organization already has Cortex XDR deployed and doesn't want to install additional tools

### What Logs They Collect

Masstin's query covers the full lateral-movement event set from `parse-windows`, across ten Windows Event Log providers:

- **Security** -- logons (4624/4625/4648), logoffs (4634/4647), Kerberos (4768/4769/4770/4771), NTLM (4776), session reconnect/disconnect (4778/4779), network share access (5140)
- **TerminalServices-LocalSessionManager/Operational** -- RDP session lifecycle (21, 22, 24, 25)
- **TerminalServices-RemoteConnectionManager/Operational** -- incoming RDP connections (1149)
- **TerminalServices-RDPClient/Operational** -- outgoing RDP (1024, 1102)
- **RemoteDesktopServices-RdpCoreTS/Operational** -- RDP transport (131)
- **SMBServer/Security** -- SMB server-side logons (1009, 551)
- **SmbClient/Security** and **SMBClient/Connectivity** -- SMB client (31001, 30803-30808)
- **WinRM/Operational** -- PowerShell Remoting session init (6)
- **WMI-Activity/Operational** -- remote WMI (5858)

The regex extraction against the localized `message` field ships with English, Spanish, German, French and Italian keyword variants and auto-paginates via time window bisection if a single query saturates the 1M API cap.

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
| **Data source** | Network events captured by Cortex agents | EVTX logs collected by the forensic agent or uploaded by the offline collector |
| **What it provides** | Connections by process to admin ports | Full Windows Event Log events |
| **Ports/Event IDs** | 22, 445, 3389, 5985, 5986 by default; `--admin-ports` adds 135, 139, 1433, 3306, 5900 | 32 event IDs across 10 providers (Security, TS-LSM/RCM/RDPClient/RdpCoreTS, SMB Server/Client/Connectivity, WinRM, WMI-Activity) |
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
