---
layout: post
title: "Terminal Services EVTX: Forensic Tracking of RDP Sessions"
date: 2026-04-07 09:00:00 +0100
category: artifacts
section: lateral-windows
order: 20
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

**File:** `Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx`, in `C:\Windows\System32\winevt\Logs\`. The other logs in this article are in the same folder, named after the channel with `%4` in place of the slash.

This is the most valuable log for tracking RDP sessions on the destination machine. It records every phase of the session lifecycle.

### Event ID 21 — Successful Session Logon

Written when a session is opened and created successfully. Careful: a session opened at the machine's physical console writes it too. They are told apart by the source field, which then says `LOCAL` instead of an address.

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

### Event ID 1102 — Outbound RDP Connection, with the Address

The client writes: *The client has initiated a multi-transport connection to the server*, followed by the server's **address**. It goes with 1024 in an outbound connection, and between the two they give the destination's name and address.

**Do not confuse it with 1102 in Security.evtx.** There the same number means "the audit log was cleared". They are two different events that share a number because they live in different logs. Before interpreting an Event ID, always check which log it comes from.

---

## RemoteConnectionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational`

### Event ID 1149 — User Authentication Accepted

The event text is *Remote Desktop Services: User authentication succeeded*. It is written on the destination machine when the remote desktop service accepts a connection with a user name.

| Field | Description |
|-------|------------|
| User | Account it connected with |
| Domain | Domain provided |
| Source Network Address | Source IP |

Masstin writes it as `SUCCESSFUL_LOGON`.

> **Read it with care:** despite its name, a 1149 does not prove on its own that a desktop was opened. It says the connection arrived and network authentication was accepted. To state that there was a session, look next for **21** in LocalSessionManager and **4624 type 10** in Security.evtx. A 1149 with neither is a connection that never became a session.
>
> Its great value is that this log rotates far less than Security.evtx: it often keeps the source address of connections from months ago.

---

## RdpCoreTS (Operational)

**Log:** `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS/Operational`

### Event ID 131 — Connection Accepted

The text is *The server accepted a new TCP connection from client*, with the client's address and port. It is written on the destination as soon as the connection arrives, **before any authentication**.

| Field | Description |
|-------|------------|
| ConnType | TCP or UDP |
| ClientIP | Address and port of the connecting client |

> **Relevance:** it is the only one of these events left behind even when nobody gets as far as typing a user. A scan or a brute force against RDP leaves the source address here, with no account. Masstin writes it as `CONNECT`.

### Event ID 140 — Wrong User Name or Password

The text is *A connection from the client computer with an IP address of … failed because the user name or password is not correct*. It is the network authentication failure seen from the destination, with the client's address. Masstin writes it as `FAILED_LOGON`.

---

## Terminal Services Event Summary

| Log | Event ID | Machine | Description | Relevance |
|-----|:--------:|:-------:|-------------|-----------|
| LocalSessionManager | 21 | Destination | Session logon | High — confirms established RDP session |
| LocalSessionManager | 22 | Destination | Shell start | Medium — confirms active desktop |
| LocalSessionManager | 24 | Destination | Disconnect | Medium — session still active |
| LocalSessionManager | 25 | Destination | Reconnect | High — possible origin change |
| RDPClient | 1024 | Source | Outbound connection (destination name) | High — says where this machine connected to |
| RDPClient | 1102 | Source | Outbound connection (destination address) | High — completes 1024 |
| RemoteConnectionManager | 1149 | Destination | Authentication accepted | High — keeps the source for months |
| RdpCoreTS | 131 | Destination | Connection accepted, unauthenticated | Medium — source address of scans |
| RdpCoreTS | 140 | Destination | Wrong user name or password | High — RDP brute force |

---

## Reconstructing a Complete RDP Session

To reconstruct an RDP session from start to finish, correlate the events in this order. Those marked Security.evtx are in another file, `Security.evtx`, on the same destination machine:

1. **131** (RdpCoreTS) — The connection arrives: source address
2. **1149** (RemoteConnectionManager) — Authentication accepted: account and address
3. **4624 type 10** (Security.evtx) — Logon
4. **21** (LocalSessionManager) — Session created
5. **22** (LocalSessionManager) — Desktop started
6. *...attacker activity...*
7. **24** (LocalSessionManager) — Disconnection
8. **25** (LocalSessionManager) — Possible reconnection
9. **4779** (Security.evtx) — RDP disconnection recorded
10. **4647/4634** (Security.evtx) — Logoff

On the **source** machine, look for **1024** and **1102** (RDPClient) to confirm where the connection was started from.

---

## How Masstin Processes Terminal Services

[Masstin](/en/tools/masstin-lateral-movement-rust/) reads these four logs automatically: Event IDs 21, 22, 24 and 25 from LocalSessionManager, 1149 from RemoteConnectionManager, 1024 and 1102 from RDPClient and 131 and 140 from RdpCoreTS. It puts them in the CSV timeline together with the Security.evtx events and other artifacts.

```bash
masstin -a parse -d /evidence/logs/ -o timeline.csv
```

This lets you see in a single chronological view how the attacker moved via RDP between different machines, correlating sources and destinations without opening each EVTX individually.

---

## Conclusion

Terminal Services logs are indispensable for any investigation involving RDP. While Security.evtx gives you the logons, these specialized logs provide the full context: who attempted to connect (even unsuccessfully), when the shell started, when the session was disconnected, and from where it was reconnected.

To process these artifacts at scale and correlate them with the rest of your lateral movement evidence, use [masstin](/en/tools/masstin-lateral-movement-rust/).
