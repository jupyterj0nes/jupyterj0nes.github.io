---
layout: post
title: "SMB EVTX: Forensic Events for SMB Lateral Movement"
date: 2026-04-07 10:00:00 +0100
category: artifacts
lang: en
ref: artifact-smb-events
tags: [evtx, smb, lateral-movement, dfir, masstin, shares, network]
description: "Forensic guide to SMBServer and SMBClient EVTX events for detecting lateral movement via Server Message Block: connections, authentication, and share access."
comments: true
---

## SMB: The Silent Protocol of Lateral Movement

Server Message Block (SMB) is Windows' native protocol for sharing files, printers, and services between networked machines. This makes it one of the most commonly leveraged vectors for lateral movement:

- **PsExec** uses SMB to copy an executable to the `ADMIN$` share and create a remote service.
- **Post-exploitation tools** like Cobalt Strike, Impacket, and CrackMapExec rely on SMB for remote command execution.
- **Data exfiltration** is often performed by copying files to network shares via SMB.
- **Ransomware** frequently spreads by encrypting accessible SMB shares.

Unlike logon events in Security.evtx, SMB-specific logs provide visibility into **network connections** at the protocol level, including failed attempts that may not generate events in other logs.

[Masstin](/en/tools/masstin-lateral-movement-rust/) parses SMBServer and SMBClient logs to integrate this activity into the lateral movement timeline.

---

## SMBServer/Security

**Log:** `Microsoft-Windows-SMBServer/Security`

These events are generated on the **destination machine** (the SMB server receiving connections).

### Event ID 1009 — SMB Connection Attempt

Generated when a client attempts to establish an SMB connection with the server. This event records the initial protocol phase, before authentication.

| Field | Description |
|-------|-------------|
| ClientName | Name or IP of the connecting machine |
| ServerName | Destination server name |
| ShareName | Share being accessed |

> **Forensic value:** An unusual volume of 1009 events from a single IP targeting multiple shares may indicate **share enumeration** — a common reconnaissance technique preceding lateral movement.

### Event ID 551 — SMB Authentication Failure

Generated when SMB authentication fails. This is distinct from Security.evtx 4625: event 551 is SMB protocol-specific and may capture failures not recorded in other logs.

| Field | Description |
|-------|-------------|
| ClientName | Source machine of the attempt |
| UserName | Account used in the authentication attempt |
| Status | Error code (similar to 4625 Sub Status codes) |

> **Correlation:** A burst of 551 events followed by successful share access (visible in SMBClient Event ID 31001 or a Security.evtx 4624 type 3) indicates the attacker performed successful brute force or password spraying.

---

## SMBClient/Security

**Log:** `Microsoft-Windows-SMBClient/Security`

These events are generated on the **source machine** (the SMB client initiating connections). They are essential for determining which machine the attacker used to access remote shares.

### Event ID 31001 — Connection to Remote Share

Generated when the SMB client successfully connects to a network share.

| Field | Description |
|-------|-------------|
| ServerName | Server connected to |
| ShareName | Name of the accessed share (e.g., `\\server\ADMIN$`, `\\server\C$`) |
| UserName | Account used for the connection |
| Reason | Connection reason/result |

> **Lateral movement indicators:**
> - Access to `ADMIN$` or `C$`: typical of PsExec, Impacket, and similar tools.
> - Access to non-standard shares from unexpected accounts: possible exfiltration.
> - Multiple connections to shares on different servers in a short timeframe: active lateral movement.

---

## SMBClient/Connectivity

**Log:** `Microsoft-Windows-SMBClient/Connectivity`

This log records the status of outbound SMB connections and provides diagnostic information about network connectivity.

### Event IDs 30803 - 30808 — Connectivity Status and Share Access

These events cover different aspects of SMB connectivity:

| Event ID | Description | Forensic Relevance |
|:--------:|-------------|-------------------|
| 30803 | TCP connection to SMB server established | Confirms network connectivity |
| 30804 | TCP connection to SMB server failed | Server not responding on port 445 |
| 30805 | SMB protocol negotiation completed | SMB version agreed (SMBv1, v2, v3) |
| 30806 | Protocol negotiation failed | Version incompatibility or misconfiguration |
| 30807 | SMB session established successfully | Authentication and session active |
| 30808 | Failed to establish SMB session | Protocol-level authentication error |

| Common Field | Description |
|--------------|-------------|
| ServerName | Server the connection was attempted to |
| ShareName | Requested share (when applicable) |
| Reason / ErrorCode | Failure reason (when applicable) |

> **Forensic sequence:** For a successful SMB connection, you'd expect: 30803 (TCP OK) -> 30805 (negotiation OK) -> 30807 (session OK). If intermediate steps are missing, something failed.

> **Reconnaissance detection:** Multiple 30804 events (TCP failures) toward different IPs on port 445 from a single machine indicate network scanning for accessible SMB servers.

---

## SMB Event Summary

| Log | Event ID | Machine | Description | Relevance |
|-----|:--------:|:-------:|-------------|-----------|
| SMBServer/Security | 1009 | Destination | Connection attempt | High — detects enumeration |
| SMBServer/Security | 551 | Destination | Authentication failure | High — SMB brute force |
| SMBClient/Security | 31001 | Source | Successful share connection | High — confirms remote access |
| SMBClient/Connectivity | 30803 | Source | TCP established | Medium — confirms connectivity |
| SMBClient/Connectivity | 30804 | Source | TCP failed | Medium — detects scanning |
| SMBClient/Connectivity | 30805 | Source | SMB negotiation successful | Medium — protocol version |
| SMBClient/Connectivity | 30806 | Source | SMB negotiation failed | Low — compatibility issues |
| SMBClient/Connectivity | 30807 | Source | SMB session established | High — access confirmed |
| SMBClient/Connectivity | 30808 | Source | SMB session failed | Medium-High — auth failure |

---

## Correlation with Other Artifacts

SMB events don't exist in isolation. For a complete investigation, correlate them with:

| Artifact | Event | What It Adds |
|----------|-------|-------------|
| Security.evtx | 4624 type 3 | Confirms successful network logon (often caused by SMB) |
| Security.evtx | 4625 | Failed logon — may correlate with SMBServer 551 |
| Security.evtx | 4648 | Explicit credentials — RunAs prior to SMB connection |
| System.evtx | 7045 | Service installation — PsExec creates a service after SMB copy |
| Prefetch | `psexesvc.exe` | Confirms PsExec execution on the destination |

---

## Common Attack Scenarios

### PsExec

1. **Source:** 31001 to `\\victim\ADMIN$` (executable copy)
2. **Destination:** 1009 (connection received)
3. **Destination:** 4624 type 3 (network logon)
4. **Destination:** 7045 (PSEXESVC service installation)

### CrackMapExec / Impacket SMBExec

1. **Source:** 30803 -> 30805 -> 30807 (TCP, negotiation, session)
2. **Source:** 31001 to `\\victim\ADMIN$` or `\\victim\IPC$`
3. **Destination:** 4624 type 3 with `LogonProcessName: NtLmSsp`
4. **Destination:** Possible 7045 (temporary service)

### Share Enumeration

1. **Source:** Multiple 30803 to different IPs (port 445 scanning)
2. **Source:** Multiple 31001 to different shares on the same server
3. **Destination:** Multiple 1009 from the same source IP

---

## How Masstin Parses SMB Logs

[Masstin](/en/tools/masstin-lateral-movement-rust/) extracts SMBServer and SMBClient events automatically and normalizes them into the CSV timeline, including source IP, accessed share, account used, and connection result.

```bash
masstin parse -i /path/to/artifacts/ -o timeline.csv
```

Combined with Security.evtx and Terminal Services events, SMB events complete the picture of network-based lateral movement, covering the three main vectors: RDP, SMB, and authentication.

---

## Conclusion

SMBServer and SMBClient logs are a source of forensic evidence that many analysts overlook, focusing solely on Security.evtx. However, these logs provide protocol-level details that can reveal enumeration, brute force, and share access that would otherwise remain hidden.

To integrate these artifacts into your lateral movement analysis automatically, [masstin](/en/tools/masstin-lateral-movement-rust/) is the right tool for the job.
