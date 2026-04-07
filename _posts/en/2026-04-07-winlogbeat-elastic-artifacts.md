---
layout: post
title: "Winlogbeat: Lateral Movement Forensic Artifacts in JSON Format"
date: 2026-04-07 12:00:00 +0100
category: artifacts
lang: en
ref: artifact-winlogbeat
tags: [winlogbeat, lateral-movement, dfir, masstin, siem, elastic, json]
description: "How to leverage Winlogbeat JSON logs to detect lateral movement, and how masstin parses these artifacts."
comments: true
---

## Beyond Native EVTX: Forwarded Logs to the SIEM

In a real enterprise environment, forensic artifacts aren't always available in their native format. Windows Event Logs are forwarded to SIEMs via agents like **Winlogbeat**, transforming them into JSON format. For a forensic analyst, knowing how to parse these formats is just as important as knowing the native Event IDs.

It doesn't help to know that 4624 indicates a logon if you can't extract it from a Winlogbeat JSON when the original EVTX files are no longer available.

[Masstin](/en/tools/masstin-lateral-movement-rust/) supports Winlogbeat JSON as an input source, allowing you to integrate forwarded logs into the same lateral movement timeline.

---

## What Is Winlogbeat

Winlogbeat is a lightweight Elastic agent that forwards Windows Event Logs to Elasticsearch, Logstash, or other destinations. It converts each EVTX event into a structured JSON document, preserving all original event fields but reorganizing them into the Elastic Common Schema (ECS) field hierarchy.

---

## Winlogbeat JSON Structure

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

---

## Key Fields for Lateral Movement

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

---

## How Masstin Parses Winlogbeat

Masstin automatically recognizes Winlogbeat JSON files and extracts the fields relevant to lateral movement. The JSON format can come in two variants:

1. **NDJSON (Newline Delimited JSON):** One JSON document per line, typical of Elasticsearch exports.
2. **JSON array:** An array of documents, less common but supported.

```bash
masstin -a parser-elastic -d /path/to/winlogbeat/ -o timeline.csv
```

Masstin maps ECS/Winlogbeat fields to its internal normalized format, so Winlogbeat events appear in the timeline with the same structure as those parsed directly from EVTX.

> **Practical advantage:** When you don't have access to the original EVTX files (rotated, deleted, or inaccessible), Winlogbeat data forwarded to Elasticsearch may be your only source of events. Masstin lets you work with them directly.

---

## Common Winlogbeat Scenarios

| Scenario | What to Do |
|----------|-----------|
| Original EVTX available | Parse directly with masstin -- more efficient |
| Data only in Elasticsearch | Export as NDJSON and parse with masstin |
| Partially rotated EVTX | Combine available EVTX + Winlogbeat export to fill gaps |
| Retroactive investigation | Winlogbeat data in the SIEM may cover months of retention |

---

## Summary Table

| Source | Format | What It Provides | Limitations |
|--------|--------|-----------------|-------------|
| Native EVTX | Binary (.evtx) | Complete data, all fields | Requires machine access, log rotation |
| Winlogbeat | JSON (NDJSON) | Extended retention in SIEM | May lack context if not all fields are forwarded |

---

## Conclusion

In a real investigation, you rarely have the luxury of having all original EVTX files from every machine. Logs forwarded by Winlogbeat can be the difference between having visibility and having blind spots.

[Masstin](/en/tools/masstin-lateral-movement-rust/) is designed to work with this reality, accepting Winlogbeat JSON exports and unifying them into the same lateral movement timeline as native EVTX files.
