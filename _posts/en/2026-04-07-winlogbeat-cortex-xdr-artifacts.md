---
layout: post
title: "Winlogbeat and Cortex XDR: Lateral Movement Forensic Artifacts"
date: 2026-04-07 12:00:00 +0100
category: artifacts
lang: en
ref: artifact-winlogbeat-cortex
tags: [winlogbeat, cortex-xdr, lateral-movement, dfir, masstin, siem, xql, json]
description: "How to leverage Winlogbeat JSON logs and Cortex XDR network events and EVTX forensics to detect lateral movement, and how masstin parses these artifacts."
comments: true
---

## Beyond Native EVTX: Forwarded Logs and EDR

In a real enterprise environment, forensic artifacts aren't always available in their native format. Windows Event Logs are forwarded to SIEMs via agents like **Winlogbeat**, transforming them into JSON format. EDR platforms like **Cortex XDR** capture their own network events and can export forensic data in proprietary formats.

For a forensic analyst, knowing how to parse these formats is just as important as knowing the native Event IDs. It doesn't help to know that 4624 indicates a logon if you can't extract it from a Winlogbeat JSON or a Cortex XDR XQL query.

[Masstin](/en/tools/masstin-lateral-movement-rust/) supports both formats, allowing you to integrate forwarded logs and EDR data into the same lateral movement timeline.

---

## Winlogbeat: EVTX in JSON Format

### What Is Winlogbeat

Winlogbeat is a lightweight Elastic agent that forwards Windows Event Logs to Elasticsearch, Logstash, or other destinations. It converts each EVTX event into a structured JSON document, preserving all original event fields but reorganizing them into the Elastic Common Schema (ECS) field hierarchy.

### Winlogbeat JSON Structure

A Security.evtx 4624 event in Winlogbeat format has this structure:

```json
{
  "@timestamp": "2026-04-07T14:23:01.000Z",
  "event": {
    "code": "4624",
    "provider": "Microsoft-Windows-Security-Auditing",
    "action": "logged-in"
  },
  "winlog": {
    "event_id": 4624,
    "channel": "Security",
    "computer_name": "SERVER01.domain.com",
    "event_data": {
      "TargetUserName": "admin",
      "TargetDomainName": "DOMAIN",
      "LogonType": "3",
      "IpAddress": "10.0.1.50",
      "IpPort": "52341",
      "LogonProcessName": "NtLmSsp",
      "AuthenticationPackageName": "NTLM",
      "WorkstationName": "WKS01"
    }
  },
  "host": {
    "name": "SERVER01"
  },
  "source": {
    "ip": "10.0.1.50",
    "port": 52341
  },
  "user": {
    "name": "admin",
    "domain": "DOMAIN"
  }
}
```

### Key Fields for Lateral Movement

| Winlogbeat Field | Original EVTX Field | Forensic Use |
|-----------------|---------------------|-------------|
| `winlog.event_id` | Event ID | Identify event type |
| `winlog.event_data.TargetUserName` | TargetUserName | Authenticated account |
| `winlog.event_data.LogonType` | LogonType | Type 3 (network), type 10 (RDP) |
| `winlog.event_data.IpAddress` | IpAddress | Source IP |
| `winlog.computer_name` | Computer | Destination machine |
| `winlog.event_data.AuthenticationPackageName` | AuthenticationPackageName | NTLM vs Kerberos |
| `winlog.event_data.WorkstationName` | WorkstationName | Source machine name (NTLM) |
| `@timestamp` | TimeCreated | Event timestamp |

### How Masstin Parses Winlogbeat

Masstin automatically recognizes Winlogbeat JSON files and extracts the fields relevant to lateral movement. The JSON format can come in two variants:

1. **NDJSON (Newline Delimited JSON):** One JSON document per line, typical of Elasticsearch exports.
2. **JSON array:** An array of documents, less common but supported.

```bash
masstin parse -i /path/to/winlogbeat/*.json -o timeline.csv
```

Masstin maps ECS/Winlogbeat fields to its internal normalized format, so Winlogbeat events appear in the timeline with the same structure as those parsed directly from EVTX.

> **Practical advantage:** When you don't have access to the original EVTX files (rotated, deleted, or inaccessible), Winlogbeat data forwarded to Elasticsearch may be your only source of events. Masstin lets you work with them directly.

### Common Winlogbeat Scenarios

| Scenario | What to Do |
|----------|-----------|
| Original EVTX available | Parse directly with masstin — more efficient |
| Data only in Elasticsearch | Export as NDJSON and parse with masstin |
| Partially rotated EVTX | Combine available EVTX + Winlogbeat export to fill gaps |
| Retroactive investigation | Winlogbeat data in the SIEM may cover months of retention |

---

## Cortex XDR: Network Events

### What Cortex XDR Captures

Palo Alto Cortex XDR is an EDR/XDR platform that, among other capabilities, records **network events** from each endpoint where it has an agent installed. These events include inbound and outbound connections with IP, port, process, and user details.

For lateral movement, the most relevant ports are:

| Port | Protocol | Relevance |
|:----:|----------|-----------|
| 3389 | RDP | Remote Desktop sessions |
| 445 | SMB | Share access, PsExec, WMI |
| 22 | SSH | Remote access to Linux servers |
| 5985/5986 | WinRM | Remote execution via PowerShell |
| 135 | RPC/DCOM | Remote WMI, DCOM lateral movement |

### Cortex XDR Network Events

Cortex XDR network events record each network connection established by endpoint processes:

| Field | Description |
|-------|-------------|
| Timestamp | Connection time |
| Source IP | IP of the machine initiating the connection |
| Source Port | Ephemeral port of the source machine |
| Destination IP | IP of the destination machine |
| Destination Port | Service port (3389, 445, 22, etc.) |
| Process Name | Process that established the connection (e.g., `mstsc.exe`, `svchost.exe`) |
| User | User under which the process runs |
| Action | Connection established, blocked, etc. |
| Direction | Inbound or outbound |

> **Forensic value:** Cortex XDR network events provide the **endpoint perspective**, complementing network logs (firewalls, proxies) and EVTX. They show not only that a connection occurred, but **which process** initiated it.

### Filtering by Lateral Movement Ports

To extract only connections relevant to lateral movement:

```
# Outbound RDP connections
destination_port = 3389 AND direction = "outbound"

# Outbound SMB connections
destination_port = 445 AND direction = "outbound"

# Outbound SSH connections
destination_port = 22 AND direction = "outbound"
```

### How Masstin Parses Cortex XDR Network Events

Masstin accepts Cortex XDR network event exports and automatically filters connections to ports relevant to lateral movement:

```bash
masstin parse -i /path/to/cortex_network_events.csv -o timeline.csv
```

Events are integrated into the timeline with the same normalized fields, enabling correlation between a network connection seen by Cortex XDR and a logon recorded in Security.evtx or a session event in Terminal Services.

---

## Cortex XDR: EVTX Forensics via XQL

### What Is XQL

XQL (XDR Query Language) is the query language for Cortex XDR. It allows searching events stored in the platform, including Windows events forwarded by the Cortex agent.

### XQL Queries for Lateral Movement

#### Successful Network Logons (4624 Type 3)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 4624
  AND action_evtlog_data_fields->LogonType = "3"
| fields _time, agent_hostname, action_evtlog_data_fields->TargetUserName,
         action_evtlog_data_fields->IpAddress,
         action_evtlog_data_fields->AuthenticationPackageName
| sort asc _time
```

#### RDP Logons (4624 Type 10)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 4624
  AND action_evtlog_data_fields->LogonType = "10"
| fields _time, agent_hostname, action_evtlog_data_fields->TargetUserName,
         action_evtlog_data_fields->IpAddress
| sort asc _time
```

#### RDP Sessions (Terminal Services)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id in (21, 22, 24, 25)
  AND action_evtlog_provider_name = "Microsoft-Windows-TerminalServices-LocalSessionManager"
| fields _time, agent_hostname, action_evtlog_data_fields->User,
         action_evtlog_data_fields->Address,
         action_evtlog_event_id
| sort asc _time
```

#### Remote Service Installation (7045)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 7045
| fields _time, agent_hostname, action_evtlog_data_fields->ServiceName,
         action_evtlog_data_fields->ImagePath,
         action_evtlog_data_fields->AccountName
| sort asc _time
```

#### Network Connections to Lateral Movement Ports

```sql
dataset = xdr_data
| filter event_type = NETWORK
  AND action_remote_port in (3389, 445, 22, 5985)
  AND action_network_connection_type = "outgoing"
| fields _time, agent_hostname, action_remote_ip, action_remote_port,
         actor_process_image_name, actor_effective_username
| sort asc _time
```

### Exporting for Masstin

XQL query results can be exported as CSV or JSON from the Cortex XDR interface. These exports are directly parseable by masstin:

```bash
# Export XQL results as CSV from Cortex XDR UI
# Then parse with masstin
masstin parse -i /path/to/cortex_xql_export.csv -o timeline.csv
```

---

## Integrated Workflow

The recommended workflow when you have data from multiple sources:

| Step | Action | Source |
|:----:|--------|--------|
| 1 | Collect native EVTX from machines with KAPE or similar | Direct EVTX |
| 2 | Export Winlogbeat data from Elasticsearch | NDJSON |
| 3 | Export Cortex XDR network events | CSV |
| 4 | Run XQL queries for forwarded EVTX | CSV export |
| 5 | Parse everything together with masstin | Unified timeline |
| 6 | Ingest into Neo4j for graph visualization | Movement relationships |

```bash
# Everything in a single command
masstin parse -i /path/to/all/artifacts/ -o complete_timeline.csv
```

Masstin automatically detects the format of each file (native EVTX, Winlogbeat JSON, Cortex CSV) and processes them in a unified manner.

---

## Summary Table

| Source | Format | What It Provides | Limitations |
|--------|--------|-----------------|-------------|
| Native EVTX | Binary (.evtx) | Complete data, all fields | Requires machine access, log rotation |
| Winlogbeat | JSON (NDJSON) | Extended retention in SIEM | May lack context if not all fields are forwarded |
| Cortex XDR (network) | CSV | Network connections by process | Only endpoints with installed agent |
| Cortex XDR (XQL) | CSV/JSON | EVTX forwarded via agent | Depends on forwarding configuration |

---

## Conclusion

In a real investigation, you rarely have the luxury of having all original EVTX files from every machine. Logs forwarded by Winlogbeat and Cortex XDR data can be the difference between having visibility and having blind spots.

[Masstin](/en/tools/masstin-lateral-movement-rust/) is designed to work with this reality, accepting multiple input formats and unifying them into a single lateral movement timeline. Whether your data comes from native EVTX, Elasticsearch exports, or Cortex XDR XQL queries, masstin processes and correlates them in seconds.
