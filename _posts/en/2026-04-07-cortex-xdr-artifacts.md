---
layout: post
title: "Cortex XDR: Lateral Movement Forensic Artifacts"
date: 2026-04-07 13:00:00 +0100
category: artifacts
section: lateral-feeds
order: 10
lang: en
ref: artifact-cortex-xdr
tags: [cortex-xdr, lateral-movement, dfir, masstin, edr, palo-alto]
description: "How masstin reads three sources from a Cortex XDR tenant -- network connections, the agents' event logs and the forensic collection -- to detect lateral movement."
comments: true
---

## Cortex XDR as a Forensic Source

Palo Alto Cortex XDR is an EDR/XDR platform that provides visibility into endpoint activity. For lateral movement analysis, a Cortex XDR tenant holds three things that [masstin](/en/tools/masstin-lateral-movement-rust/) can read:

1. **Network connections:** the ones the Cortex XDR agents record on each endpoint.
2. **The agents' event logs:** the Windows events every agent sends by itself, with no triage.
3. **EVTX Forensics:** the Windows Event Logs the forensics add-on collected (triages, hunts, offline collector).

One action, `parse-cortex`, reads all three into a single timeline. If the tenant does not have one of them, it says so and carries on with the rest. `--cortex-sources network,eventlog,forensics` picks which.

Every command in this article needs three values from the tenant: its API URL, an API key and that key's ID. Before running any query, check that they work: it is a single command and it is in the section "Before reading anything: check the connection", further down.

---

## Source 1: Network Connections

### What It Captures

Cortex XDR agents record network connections established by processes on each endpoint. For lateral movement, the ports masstin queries by default are:

| Port | Protocol | Relevance |
|:----:|----------|-----------|
| 22   | SSH | Remote access to servers |
| 445  | SMB | Share access, PsExec |
| 3389 | RDP | Remote Desktop sessions |
| 5985 | WinRM (HTTP)  | PowerShell Remoting |
| 5986 | WinRM (HTTPS) | PowerShell Remoting |

Three options change what is asked for:

- `--admin-ports` adds ports 135 (RPC), 139 (NetBIOS), 1433 (MSSQL), 3306 (MySQL) and 5900 (VNC) to that list, to see more pivoting routes (hops from one machine to another).
- `--ignore-local` drops the connections that say nothing about lateral movement: loopback ones (the machine talking to itself, `127.0.0.1`), link-local ones and those from a host to itself. The filter is applied inside Cortex, so that data is never downloaded.
- `--start-time` and `--end-time` bound the period. The API returns at most one million results per query. If the period holds more, masstin splits it into smaller pieces and asks for them one by one, with nothing for you to do.

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
masstin -a parse-cortex --cortex-url https://api-xxxx.xdr.xx.paloaltonetworks.com \
  --cortex-sources network \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-network.csv
```

Masstin queries the Cortex XDR API directly, filters connections to ports relevant to lateral movement, and generates the CSV timeline in the same normalized format as all other artifacts.

---

## Source 2: The event logs the agents send

This is the one most people do not know they have. With nothing deployed and no triage requested, every Cortex agent is already sending the tenant the Windows security events that matter for lateral movement: logons and logoffs (4624, 4625, 4634, 4647, 4648), Kerberos (4768 to 4771), NTLM (4776), RDP reconnects (4778, 4779) and share access (5140, 5145). From every machine with an agent.

Masstin runs each event through the same mapping it uses for an EVTX, so the row you get is the one the original file would give.

```bash
masstin -a parse-cortex --cortex-url https://api-xxxx.xdr.xx.paloaltonetworks.com \
  --cortex-sources eventlog --ignore-local \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-eventlog.csv
```

Most of those events are logons local to the machine itself. `--ignore-local` keeps the ones that came from another machine, which are the ones you care about here.

---

## Source 3: EVTX Forensics (Forensic Collection)

### What Are Cortex XDR Forensic Collection Agents

Cortex XDR allows deploying **forensic collection agents** to endpoints during an investigation. These are lightweight agents that are temporarily installed on target machines to collect forensic artifacts -- including Windows Event Log (EVTX) files -- and send them to the Cortex XDR cloud for analysis.

The same backing dataset (`forensics_event_log`) also receives logs uploaded by the **Cortex XDR offline collector**, so triage packages gathered from air-gapped or unreachable hosts and pushed into the tenant are queried through the exact same path as those collected remotely by the forensic agent.

Forensic collection agents are especially useful when:

- You don't have direct access to the compromised machines
- You need to collect evidence from multiple endpoints in a centralized manner
- Local logs may have been tampered with and you need a cloud copy
- The organization already has Cortex XDR deployed and doesn't want to install additional tools

### What Logs They Collect

Masstin's query covers the full lateral-movement event set masstin reads from EVTX, across ten Windows Event Log providers:

- **Security** -- logons (4624/4625/4648), logoffs (4634/4647), Kerberos (4768/4769/4770/4771), NTLM (4776), session reconnect/disconnect (4778/4779), network share access (5140)
- **TerminalServices-LocalSessionManager/Operational** -- RDP session lifecycle (21, 22, 24, 25)
- **TerminalServices-RemoteConnectionManager/Operational** -- incoming RDP connections (1149)
- **TerminalServices-RDPClient/Operational** -- outgoing RDP (1024, 1102)
- **RemoteDesktopServices-RdpCoreTS/Operational** -- RDP transport (131)
- **SMBServer/Security** -- SMB server-side logons (1009, 551)
- **SmbClient/Security** and **SMBClient/Connectivity** -- SMB client (31001, 30803-30808)
- **WinRM/Operational** -- PowerShell Remoting session init (6)
- **WMI-Activity/Operational** -- remote WMI (5858)

The regex extraction against the localized `message` field ships with English, Spanish, German, French and Italian keyword variants. As with the network source, if a period holds more than one million results masstin splits it into pieces and asks for them one by one.

### How Masstin Retrieves This Data

```bash
masstin -a parse-cortex --cortex-url https://api-xxxx.xdr.xx.paloaltonetworks.com \
  --cortex-sources forensics \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-evtx.csv
```

Masstin queries the logs collected by the forensic agents and extracts lateral movement events, generating them in the same normalized CSV format. This source alone also exists as a separate advanced action, `parse-cortex-evtx-forensics`, which is why you will see that name in other articles.

> **Practical advantage:** Instead of having to physically access each machine or deploy triage tools like KAPE, you can leverage the existing Cortex XDR infrastructure to collect EVTX files remotely and centrally, then analyze them with masstin.

---

## Source Comparison

| Aspect | Network Connections | Agents' event logs | EVTX Forensics |
|--------|-------------------|--------------------|----------------|
| **Data source** | Network events captured by Cortex agents | Security events every agent sends by itself | EVTX logs collected by the forensic agent or uploaded by the offline collector |
| **What it provides** | Connections by process to admin ports | Logons, logoffs, Kerberos, NTLM and shares from every machine with an agent | Full Windows Event Log events, with the RDP, SMB and WinRM channels |
| **Ports/Event IDs** | 22, 445, 3389, 5985, 5986 by default; `--admin-ports` adds 135, 139, 1433, 3306, 5900 | 4624, 4625, 4634, 4647, 4648, 4768-4771, 4776, 4778, 4779, 5140, 5145 | 32 event IDs across 10 providers (Security, TS-LSM/RCM/RDPClient/RdpCoreTS, SMB Server/Client/Connectivity, WinRM, WMI-Activity) |
| **`--cortex-sources`** | `network` | `eventlog` | `forensics` |
| **When to use** | Complement EVTX with endpoint network data | Always: it is already there and nothing has to be deployed | When you need the channels the agent does not send |

---

## Before reading anything: check the connection

Masstin reads the tenant with XQL, the Cortex XDR query language. Every XQL query spends "compute units" from a quota the tenant has, so it is worth not wasting them.

The first thing that fails with an API is the key. So that you do not find out halfway through a query that spends compute units, masstin can ask first:

```bash
masstin -a parse-cortex --cortex-url https://api-xxxx.xdr.xx.paloaltonetworks.com --cortex-check
```

It makes a single request, the XQL quota one, which costs nothing. If the tenant accepts, it tells you what kind of key it is (Standard or Advanced) and how much quota you have used today. If not, it shows you what the tenant answered and what that usually means: a URL that does not exist, an ID that does not belong to that key, a role that may not run XQL. Nothing is read or written, and the exit code is 0 when the tenant accepts, in case you want it in a script.

The key and its ID are asked on the console, or read from `CORTEX_API_KEY` and `CORTEX_API_KEY_ID`. They never go on the command line. The three values (the URL, the key and its ID) come from the Cortex XDR console, where API keys are created; the first step of the window's wizard, described next, tells you where each one is.

---

## The wizard in the window

If you would rather not type the command, masstin's window (`masstin -a view`) walks you through it. **Evidence › Cortex XDR API** opens a five-step wizard:

1. **Tenant.** It tells you where the three values you need live in Cortex (the URL, the key's ID and the key) and has a button that checks the connection. Green if it works, with the kind of key and today's quota. Red if not, with the reason.
2. **What to read.** The three sources, as cards you tick or untick.
3. **Which events.** The period, with buttons for the last 24 hours, 3, 7 and 30 days, and the filters.
4. **Timeline.** Where it is written, and a summary in words of what is about to happen.
5. **Run.** The phases as they pass and a bar with the share of the period already read.

The key travels to the process in its environment. It does not show up on the command line or in the log, and it is not saved to disk.

The wizard, `--cortex-check` and the progress bar come with masstin 1.5.0.

---

## Integrated Workflow

The recommended workflow when Cortex XDR is available:

| Step | Action | Source |
|:----:|--------|--------|
| 1 | Only if you want source 3 (the RDP, SMB and WinRM channels): deploy forensic collection agents on key endpoints. The other two sources need nothing deployed | Cortex XDR |
| 2 | Check that the key works | `parse-cortex --cortex-check` |
| 3 | Read the tenant's three sources into one timeline | `parse-cortex` |
| 4 | Supplement with native EVTX if available | `parse` |
| 5 | Unify everything into a single timeline | `merge` |
| 6 | Look at it in masstin's window or in a graph | `view` / `load-neo4j` |

Data from the three Cortex XDR sources integrates into the timeline with the same normalized fields as native EVTX, enabling correlation between a network connection seen by Cortex and a logon recorded in Security.evtx.

---

## Conclusion

Cortex XDR provides three complementary forensic data sources for lateral movement. Network connections tell you which processes are talking over suspicious ports, the agents' event logs give you the logons of the whole estate without asking for anything, and EVTX forensic collection gives you full Windows Event Logs without physically reaching each machine.

[Masstin](/en/tools/masstin-lateral-movement-rust/) integrates all three into a single timeline, allowing you to combine them with native EVTX, Winlogbeat data, and Linux logs for a complete picture of lateral movement.
