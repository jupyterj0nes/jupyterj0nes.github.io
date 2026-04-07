---
layout: post
title: "Terminal Services EVTX: Forensic Tracking of RDP Sessions"
date: 2026-04-07 09:00:00 +0100
category: artifacts
lang: en
ref: artifact-terminal-services
tags: [evtx, rdp, terminal-services, lateral-movement, dfir, masstin, remote-desktop]
description: "Forensic analysis of Windows Terminal Services logs: LocalSessionManager, RDPClient, RemoteConnectionManager, and RdpCoreTS for reconstructing lateral movement RDP sessions."
comments: true
---

## RDP as a Lateral Movement Vector

Remote Desktop Protocol (RDP) is one of the most commonly abused legitimate tools attackers use to move laterally within a compromised network. Unlike techniques like PsExec or WMI, RDP gives the attacker a full desktop, allowing them to operate comfortably, run GUI-based tools, and blend in with normal administrative activity.

Windows logs RDP activity across several specialized event logs under the **Terminal Services** umbrella. While Security.evtx captures type 10 logons, Terminal Services logs provide additional details about the complete session lifecycle: connection, authentication, shell start, disconnection, and closure.

[Masstin](/en/tools/masstin-lateral-movement-rust/) parses these logs automatically to reconstruct RDP sessions as part of the lateral movement timeline.

---

## LocalSessionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-LocalSessionManager/Operational`

This is the most valuable log for tracking RDP sessions on the destination machine. It records every phase of the session lifecycle.

### Event ID 21 — Successful Session Logon

Generated when a user logs on remotely and the session is created successfully.

| Field | Description |
|-------|-------------|
| User | Account that logged on (DOMAIN\user) |
| SessionID | Numeric session identifier |
| Source Network Address | **Source machine IP** — key data for lateral movement |

> **Forensic context:** This event confirms the RDP session was fully established, not just that a connection attempt was made.

### Event ID 22 — Shell Start

Generated when the graphical shell (explorer.exe) starts within the RDP session. This confirms the user has an active desktop.

| Field | Description |
|-------|-------------|
| User | Session account |
| SessionID | Session ID |
| Source Network Address | Source IP |

> **Tip:** If you see a 21 without a subsequent 22, the session was created but the shell never started. This may indicate an automated session or a connection failure.

### Event ID 24 — Session Disconnected

Generated when an RDP session is disconnected without logging off. The session remains active on the server, consuming resources and potentially running attacker processes.

| Field | Description |
|-------|-------------|
| User | Session account |
| SessionID | Session ID |

> **Relevance:** Attackers frequently disconnect RDP sessions instead of closing them, allowing them to reconnect later without re-authenticating.

### Event ID 25 — Session Reconnected

Generated when a user reconnects to a previously disconnected session.

| Field | Description |
|-------|-------------|
| User | Reconnected account |
| SessionID | Session ID |
| Source Network Address | IP from which the reconnection occurred (may differ from the original) |

> **Investigation note:** Compare the IP from the original event 21 with the IP in event 25. If they differ, someone reconnected to the session from a different machine — a possible indicator that credentials were compromised.

---

## TerminalServices-RDPClient (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RDPClient/Operational`

This log is generated on the **source machine** (the RDP client), not the destination. It's essential for identifying which machine the attacker used to initiate the RDP connection.

### Event ID 1024 — Outbound RDP Connection Start

Generated when the RDP client (mstsc.exe or equivalent) initiates a connection to a remote server.

| Field | Description |
|-------|-------------|
| Value | Hostname or IP of the destination server |

> **Forensic importance:** This event on a compromised workstation tells you what other machines the attacker connected to via RDP. It provides the **source perspective**, complementing Event ID 21 on the destination.

### Event ID 1102 — Audit Log Cleared

While this Event ID shares its number with the Security.evtx audit log cleared event, in the RDPClient context it indicates the RDP client log was cleared. If an attacker wipes this log, it's an indicator of anti-forensics activity.

---

## RemoteConnectionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational`

### Event ID 1149 — RDP Connection Received

Generated on the destination machine when an RDP connection is received, **before authentication**. This means the event fires regardless of whether the credentials were correct.

| Field | Description |
|-------|-------------|
| User | Account used in the connection attempt |
| Domain | Domain provided |
| Source Network Address | Source IP |

> **Key forensic value:** A 1149 without a subsequent 21 indicates a failed RDP connection attempt. This is extremely useful for detecting reconnaissance or RDP brute force, especially when Security.evtx 4625 events are unavailable.

---

## RdpCoreTS (Operational)

**Log:** `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS/Operational`

### Event ID 131 — Transport Security Negotiation

Generated during the TLS/NLA negotiation phase of the RDP connection. It records the security protocol agreed upon between client and server.

| Field | Description |
|-------|-------------|
| ClientIP | Connecting client IP |
| SecurityProtocol | Negotiated protocol (TLS, CredSSP/NLA, etc.) |

> **Relevance:** Connections with reduced security (no NLA) may indicate insecure configurations or downgrade attacks.

---

## Terminal Services Event Summary

| Log | Event ID | Machine | Description | Relevance |
|-----|:--------:|:-------:|-------------|-----------|
| LocalSessionManager | 21 | Destination | Session logon | High — confirms established RDP session |
| LocalSessionManager | 22 | Destination | Shell start | Medium — confirms active desktop |
| LocalSessionManager | 24 | Destination | Disconnect | Medium — session still active |
| LocalSessionManager | 25 | Destination | Reconnect | High — possible origin change |
| RDPClient | 1024 | Source | Outbound connection | High — identifies source machine |
| RDPClient | 1102 | Source | Log cleared | High — anti-forensics |
| RemoteConnectionManager | 1149 | Destination | Connection received (pre-auth) | High — includes failed attempts |
| RdpCoreTS | 131 | Destination | Security negotiation | Medium — protocol and IP |

---

## Reconstructing a Complete RDP Session

To reconstruct an RDP session from start to finish, correlate events in this order:

1. **1149** (RemoteConnectionManager) — Connection received, source IP
2. **131** (RdpCoreTS) — Security negotiation
3. **4624 type 10** (Security.evtx) — Successful authentication
4. **21** (LocalSessionManager) — Session created
5. **22** (LocalSessionManager) — Shell started
6. *...attacker activity...*
7. **24** (LocalSessionManager) — Disconnect
8. **25** (LocalSessionManager) — Possible reconnection
9. **4779** (Security.evtx) — RDP disconnect recorded
10. **4647/4634** (Security.evtx) — Logoff

On the source machine, look for **1024** (RDPClient) to confirm which machine initiated the connection.

---

## How Masstin Processes Terminal Services

[Masstin](/en/tools/masstin-lateral-movement-rust/) parses TerminalServices-LocalSessionManager and RemoteConnectionManager logs automatically, extracting Event IDs 21, 22, 24, 25, and 1149, and integrating them into the unified CSV timeline alongside Security.evtx events and other artifacts.

```bash
masstin parse -i /path/to/evtx/ -o timeline.csv
```

This lets you see in a single chronological view how the attacker moved via RDP between different machines, correlating sources and destinations without opening each EVTX individually.

---

## Conclusion

Terminal Services logs are indispensable for any investigation involving RDP. While Security.evtx gives you the logons, these specialized logs provide the full context: who attempted to connect (even unsuccessfully), when the shell started, when the session was disconnected, and from where it was reconnected.

To process these artifacts at scale and correlate them with the rest of your lateral movement evidence, use [masstin](/en/tools/masstin-lateral-movement-rust/).
