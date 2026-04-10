---
layout: post
title: "Masstin CSV Format and Event Classification"
date: 2026-04-08 01:00:00 +0100
category: tools
lang: en
ref: tool-masstin-csv-format
tags: [masstin, csv, event-type, lateral-movement, dfir, tools]
description: "Complete reference for masstin's CSV output format: 14 columns, event_type classification, Event ID mapping, logon_id for session correlation, and detail column."
comments: true
---

## CSV Structure

All masstin actions produce a unified CSV with 14 columns, regardless of the source (Windows EVTX, Linux logs, Winlogbeat JSON, or Cortex XDR):

| # | Column | Description |
|---|--------|-------------|
| 1 | `time_created` | Event timestamp |
| 2 | `dst_computer` | Destination hostname (machine that received the connection) |
| 3 | `event_type` | Event classification (see below) |
| 4 | `event_id` | Original Event ID from the source (e.g., `4624`, `SSH_SUCCESS`) |
| 5 | `logon_type` | Windows logon type as reported by the event (e.g., `2`, `3`, `7`, `10`, `11`) |
| 6 | `target_user_name` | User account targeted by the action |
| 7 | `target_domain_name` | Domain of the target user |
| 8 | `src_computer` | Source hostname (machine that initiated the connection) |
| 9 | `src_ip` | Source IP address |
| 10 | `subject_user_name` | User account that initiated the action |
| 11 | `subject_domain_name` | Domain of the subject user |
| 12 | `logon_id` | Logon session ID for correlation (e.g., `0x1A2B3C`) |
| 13 | `detail` | Additional context depending on event type |
| 14 | `log_filename` | Source artifact file |

---

## Event Type Classification

Masstin classifies every event into one of four categories:

| event_type | Meaning | When |
|---|---|---|
| `SUCCESSFUL_LOGON` | Authentication succeeded | User authenticated correctly and session was established |
| `FAILED_LOGON` | Authentication failed | Incorrect credentials, locked account, or pre-auth failure |
| `LOGOFF` | Session ended | User logged off or session was disconnected |
| `CONNECT` | Connection event | Network-level connection with no authentication result |

---

## Event ID Mapping

### Security.evtx

| Event ID | event_type | Description | detail column |
|---|---|---|---|
| 4624 | `SUCCESSFUL_LOGON` | Successful logon | Process name |
| 4625 | `FAILED_LOGON` | Failed logon | SubStatus code (e.g., `0xC000006A` = wrong password) |
| 4634 | `LOGOFF` | Logoff | |
| 4647 | `LOGOFF` | User-initiated logoff | |
| 4648 | `SUCCESSFUL_LOGON` | Logon with explicit credentials (runas) | Process name |
| 4768 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Kerberos TGT request | Based on Status field |
| 4769 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Kerberos Service Ticket | Based on Status field |
| 4770 | `SUCCESSFUL_LOGON` | Kerberos TGT renewal | |
| 4771 | `FAILED_LOGON` | Kerberos pre-auth failure | |
| 4776 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | NTLM authentication | Based on Status field |
| 4778 | `SUCCESSFUL_LOGON` | Session reconnected | |
| 4779 | `LOGOFF` | Session disconnected | |
| 5140 | `SUCCESSFUL_LOGON` | Network share accessed | ShareName (e.g., `\\*\IPC$`) |
| 5145 | `SUCCESSFUL_LOGON` | Network share object checked | ShareName\FileName |

### Terminal Services (RDP)

| Event ID | Source | event_type | Description |
|---|---|---|---|
| 21 | LocalSessionManager | `SUCCESSFUL_LOGON` | RDP session logon succeeded |
| 22 | LocalSessionManager | `SUCCESSFUL_LOGON` | RDP shell started |
| 24 | LocalSessionManager | `LOGOFF` | RDP session disconnected |
| 25 | LocalSessionManager | `SUCCESSFUL_LOGON` | RDP session reconnected |
| 1024 | RDPClient | `CONNECT` | Outgoing RDP connection |
| 1102 | RDPClient | `CONNECT` | Outgoing RDP connection |
| 1149 | RemoteConnectionManager | `SUCCESSFUL_LOGON` | RDP authentication succeeded |
| 131 | RdpCoreTS | `CONNECT` | RDP transport accepted |

### SMB

| Event ID | Source | event_type | Description | detail column |
|---|---|---|---|---|
| 1009 | SMBServer/Security | `SUCCESSFUL_LOGON` | SMB connection accepted | |
| 551 | SMBServer/Security | `FAILED_LOGON` | SMB authentication failed | |
| 31001 | SMBClient/Security | `SUCCESSFUL_LOGON` | SMB share access | ShareName |
| 5140 | Security.evtx | `SUCCESSFUL_LOGON` | Network share accessed | ShareName (e.g., `\\*\IPC$`) |
| 5145 | Security.evtx | `SUCCESSFUL_LOGON` | Network share object checked | ShareName\FileName |
| 30803-30808 | SMBClient/Connectivity | `CONNECT` | SMB connectivity events | |

### WinRM and WMI

| Event ID | Source | event_type | Description | detail column |
|---|---|---|---|---|
| 6 | WinRM/Operational | `CONNECT` | PowerShell Remoting session initiated (source system) | `WinRM: <connection>` |
| 5858 | WMI-Activity/Operational | `CONNECT` | Remote WMI execution (destination system, only when ClientMachine differs from Computer) | `WMI: <operation>` |

### Linux

| Event ID | event_type | Description | detail column |
|---|---|---|---|
| `SSH_SUCCESS` | `SUCCESSFUL_LOGON` | SSH authentication succeeded | Auth method (password/publickey) |
| `SSH_FAILED` | `FAILED_LOGON` | SSH authentication failed | Auth method |
| `SSH_CONNECT` | `CONNECT` | SSH connection (xinetd) | |

### Cortex XDR

| Source | event_type | Description |
|---|---|---|
| Network (ports 3389/445/22) | `CONNECT` | Network-level connection data |
| EVTX Forensics | Same as Security.evtx | Classified by Event ID |

---

## The logon_id Column

The `logon_id` field contains the session identifier extracted from the `TargetLogonId` field in Security.evtx events (4624, 4634, 4647, 4648). This enables session correlation: matching a logon event with its corresponding logoff to determine session duration.

For Terminal Services events, the `SessionId` is used when available. For Linux, Cortex, and SMB events, this field is empty.

---

## The detail Column

The `detail` column provides additional context that varies by event type:

| Event | Content in detail |
|---|---|
| 4624, 4648 | Process name that initiated the logon |
| 4625 | SubStatus hex code indicating failure reason |
| 5140 | ShareName (e.g., `\\*\IPC$`, `\\*\C$`, `\\*\SYSVOL`) |
| 5145 | ShareName\RelativeTargetName |
| SMB 31001 | ShareName |
| SSH events | Authentication method (`password`, `publickey`) |
| Cortex Network | Command line of the process that generated the connection |
| Other events | Empty |

### Common 4625 SubStatus Codes

| SubStatus | Meaning |
|---|---|
| `0xC000006A` | Wrong password |
| `0xC0000064` | User does not exist |
| `0xC0000072` | Account disabled |
| `0xC0000234` | Account locked out |
| `0xC0000070` | Logon outside allowed hours |
| `0xC000006D` | Bad username or authentication info |
| `0xC0000071` | Expired password |
| `0xC0000224` | Password must change at next logon |

---

## Data Preservation

Masstin preserves original values from the evidence. Node names (hostnames, IPs) and properties are stored without transformation. Only relationship types in graph databases are normalized (uppercase, underscores) due to Cypher language restrictions. See the [Neo4j](/en/tools/neo4j-cypher-visualization/) and [Memgraph](/en/tools/memgraph-visualization/) articles for details.
