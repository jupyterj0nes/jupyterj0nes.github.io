---
layout: post
title: "Security.evtx: Key Events for Detecting Lateral Movement"
date: 2026-04-07 08:00:00 +0100
category: artifacts
lang: en
ref: artifact-security-evtx
tags: [evtx, security, lateral-movement, logon, kerberos, ntlm, rdp, dfir, masstin]
description: "Complete forensic guide to Security.evtx Event IDs that reveal lateral movement: logons (4624/4625), Kerberos (4768-4771), NTLM (4776), explicit credentials (4648), and RDP sessions (4778/4779)."
comments: true
---

## Why Security.evtx Is Your Best Forensic Ally

In any incident response investigation, **Security.evtx** is the first artifact every analyst reaches for. This log concentrates authentication, authorization, and auditing events from the Windows operating system — and it's precisely where an attacker's lateral movement leaves its traces.

The problem is usually not a lack of data, but an excess of it. Security.evtx can contain millions of events on an Active Directory server. The key is knowing **which Event IDs to look for** and how to interpret them in context.

Tools like [masstin](/en/tools/masstin-lateral-movement-rust/) parse these events automatically and unify them into a lateral movement timeline, saving you hours of manual analysis.

---

## Logon and Logoff Events

### Event ID 4624 — Successful Logon

This is arguably the most important event for tracking lateral movement. Every time an account authenticates on a machine, a 4624 is generated on that destination machine.

What matters isn't just whether the event exists — it's the **Logon Type**:

| Logon Type | Meaning | Forensic Relevance |
|:----------:|---------|-------------------|
| 2 | Interactive logon (console) | User was physically present or via KVM |
| 3 | Network logon | SMB, share access, PsExec, remote WMI — **classic lateral movement** |
| 7 | Screen unlock | Generally irrelevant for lateral movement |
| 10 | Remote interactive logon (RDP) | **Full RDP session** — lateral movement via Remote Desktop |
| 11 | Cached credentials logon | Offline logon, no DC contact |

**Key fields to examine:**
- **TargetUserName / TargetDomainName**: who authenticated.
- **IpAddress / IpPort**: where the connection came from. For logon types 3 and 10, this is the attacker's IP.
- **LogonProcessName**: `NtLmSsp` for NTLM, `Kerberos` for Kerberos, `User32` for interactive logons.
- **AuthenticationPackageName**: distinguishes NTLM from Kerberos.
- **WorkstationName**: source machine name (NTLM only).

> **Forensic tip:** A type 3 logon from a workstation to a server using a Domain Admin account at 3:00 AM is an immediate red flag.

### Event ID 4625 — Failed Logon

Failed logons are indicators of access attempts. A spike in 4625 events may indicate:
- **Brute force** against local or domain accounts.
- **Password spraying** (many accounts, few passwords).
- **Expired stolen credentials** that the attacker is trying to reuse.

| Sub Status Code | Meaning |
|:---------------:|---------|
| 0xC000006A | Wrong password |
| 0xC0000064 | Nonexistent user |
| 0xC0000072 | Disabled account |
| 0xC000006D | Generic logon failure |
| 0xC0000234 | Account locked out |

**Key correlation:** If you see a burst of 4625 events followed by a successful 4624 with the same account, the attacker found the correct credentials.

### Event ID 4634 / 4647 — Logoff

| Event ID | Type | Description |
|:--------:|------|-------------|
| 4634 | System logoff | System closes the session (timeout, network disconnect) |
| 4647 | User-initiated logoff | User actively logged off |

These events let you calculate **session duration**. A type 3 logon session lasting 2 seconds suggests automated access (PsExec, WMI). A type 10 session lasting 45 minutes suggests manual operation via RDP.

---

## Explicit Credentials

### Event ID 4648 — Logon with Explicit Credentials (RunAs)

Generated when a process authenticates with credentials different from those of the current session. This includes:
- Use of **runas.exe** or **RunAs** from the GUI.
- Tools like **PsExec** with the `-u` flag.
- Any API calling `LogonUser()` with supplied credentials.

| Field | What to Review |
|-------|---------------|
| SubjectUserName | Who executed the action |
| TargetUserName | What account was used to authenticate |
| TargetServerName | What server was targeted |
| ProcessName | What executable did it (e.g., `C:\Windows\System32\runas.exe`) |

> **Forensic tip:** If the `SubjectUserName` is a service account and the `TargetUserName` is a Domain Admin, you have a clear case of privilege escalation followed by lateral movement.

---

## Kerberos Events

Kerberos events are fundamental for reconstructing authentication in Active Directory environments. They are generated **on the Domain Controller**.

### Event ID 4768 — TGT Request (AS-REQ)

Logged when a user requests a Ticket Granting Ticket from the KDC. This is the first step in Kerberos authentication.

| Field | Relevance |
|-------|-----------|
| TargetUserName | Account requesting the TGT |
| IpAddress | IP where the request originated |
| TicketEncryptionType | 0x17 (RC4) indicates possible Pass-the-Hash or AS-REP Roasting |
| PreAuthType | Pre-authentication type used |

> **Related attack:** Attackers performing **AS-REP Roasting** target accounts without required pre-authentication. You'll see 4768 events with `PreAuthType` 0 (no pre-auth).

### Event ID 4769 — Service Ticket Request (TGS-REQ)

Generated when a user with a valid TGT requests a service ticket to access a resource.

| Field | Relevance |
|-------|-----------|
| ServiceName | Requested service (e.g., `cifs/server.domain.com`, `http/web01`) |
| TargetUserName | Account requesting the ticket |
| IpAddress | Request origin |
| TicketEncryptionType | 0x17 (RC4) may indicate **Kerberoasting** |

> **Related attack:** In a **Kerberoasting** attack, the adversary requests service tickets for accounts with configured SPNs, then attempts to crack the ticket offline. Look for bursts of 4769 events with `TicketEncryptionType` 0x17 from a single IP.

### Event ID 4770 — TGT Renewal

Generated when an existing TGT is renewed. An abnormal volume of renewals from an unexpected IP may indicate a **Golden Ticket** (the attacker indefinitely renews a forged TGT).

### Event ID 4771 — Kerberos Pre-Authentication Failure

The Kerberos equivalent of 4625. Indicates that the supplied password doesn't match what's stored in AD.

| Failure Code | Meaning |
|:------------:|---------|
| 0x6 | Principal does not exist |
| 0x12 | Credentials expired |
| 0x17 | Password expired |
| 0x18 | **Wrong password** — most common in brute force |
| 0x25 | Clock skew |

---

## NTLM Authentication

### Event ID 4776 — NTLM Credential Validation

Generated on the Domain Controller when it receives an NTLM validation request (pass-through authentication). If the result is successful, the `Status` field will be `0x0`.

| Field | Relevance |
|-------|-----------|
| TargetUserName | Authenticated account |
| Workstation | Machine where the authentication originated |
| Status | 0x0 = success, 0xC000006A = wrong password |

> **Forensic tip:** In a modern environment with Kerberos, heavy 4776 traffic may indicate a **downgrade attack** where the adversary forces NTLM to capture hashes or perform relay attacks.

---

## RDP Sessions

### Event ID 4778 — RDP Session Reconnect

Generated when a user reconnects to an existing RDP session (one that was disconnected, not closed).

### Event ID 4779 — RDP Session Disconnect

Generated when a user disconnects from an RDP session without closing it.

| Field | Description |
|-------|-------------|
| AccountName | Session user |
| ClientName | Client machine name |
| ClientAddress | Client machine IP |
| SessionName | Session name (e.g., `RDP-Tcp#5`) |

These events complement 4624 type 10 events for complete RDP activity reconstruction, including disconnections and reconnections.

---

## Event ID Summary

| Event ID | Category | Description | Lateral Movement Relevance |
|:--------:|----------|-------------|---------------------------|
| 4624 | Logon | Successful logon | High (types 3 and 10) |
| 4625 | Logon | Failed logon | Medium-High (brute force, spraying) |
| 4634 | Logoff | System logoff | Medium (session duration) |
| 4647 | Logoff | User logoff | Medium (session duration) |
| 4648 | Credentials | Explicit logon (RunAs) | High (escalation + movement) |
| 4768 | Kerberos | TGT request | High (AS-REP Roasting, Golden Ticket) |
| 4769 | Kerberos | Service Ticket request | High (Kerberoasting) |
| 4770 | Kerberos | TGT renewal | Medium (Golden Ticket) |
| 4771 | Kerberos | Pre-auth failure | Medium-High (Kerberos brute force) |
| 4776 | NTLM | NTLM validation | High (NTLM relay, downgrade) |
| 4778 | RDP | RDP reconnect | Medium (session tracking) |
| 4779 | RDP | RDP disconnect | Medium (session tracking) |

---

## How Masstin Parses Security.evtx

[Masstin](/en/tools/masstin-lateral-movement-rust/) automatically extracts events 4624 (types 3 and 10), 4625, 4648, and others from Security.evtx, normalizing them into a unified CSV format with fields like timestamp, source IP, destination host, username, and event type. This lets you build a complete lateral movement timeline without manually reviewing each EVTX file.

```bash
masstin parse -i /path/to/artifacts/ -o timeline.csv
```

The output includes all Security.evtx events alongside those from other logs (Terminal Services, SMB, etc.), sorted chronologically and ready for analysis or Neo4j ingestion.

---

## Conclusion

Security.evtx is the cornerstone of any Windows lateral movement investigation. Knowing these Event IDs, their relevant fields, and how to correlate them is what separates a superficial review from a complete forensic reconstruction.

If you need to process these artifacts at scale, [masstin](/en/tools/masstin-lateral-movement-rust/) lets you do it in seconds instead of hours.
