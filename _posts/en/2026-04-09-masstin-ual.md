---
layout: post
title: "Masstin UAL: Server Access Logging that Survives Event Log Clearing"
date: 2026-04-09 14:00:00 +0100
category: tools
lang: en
ref: tool-masstin-ual
tags: [masstin, ual, user-access-logging, forensics, dfir, lateral-movement, ese, tools]
description: "How masstin parses Windows Server User Access Logging (UAL/SUM) databases to recover 3 years of server access history — even when event logs have been cleared."
comments: true
---

## The problem

You collect forensic evidence from a Domain Controller. The Security event log has been rolling over every few hours on this busy server — or worse, the attacker cleared it. You need to know who accessed this server, from which IP, and when. The event logs can't tell you.

**User Access Logging (UAL)** can.

## What is UAL?

User Access Logging is a Windows Server feature (2012, 2012 R2, 2016, 2019, 2022) that **silently records every client access** by role and service. It stores:

- **Username** (domain\user)
- **Source IP address**
- **First seen** and **last seen** timestamps
- **Access count**
- **Server role** accessed (File Server/SMB, Remote Access/RDP, DHCP, AD DS, Web Server, etc.)

The critical advantage: **UAL retains data for up to 3 years** and is stored in ESE databases that are separate from event logs. Attackers who clear event logs rarely know about UAL.

### Where it lives

```
C:\Windows\System32\LogFiles\Sum\
├── Current.mdb              # Active year (updated every 24h)
├── {GUID}.mdb               # Current year snapshot
├── {GUID}.mdb               # Previous year
├── {GUID}.mdb               # Two years ago
└── SystemIdentity.mdb       # Server metadata + role mappings
```

The format is **ESE (Extensible Storage Engine)** — the same database engine used by Active Directory and Exchange.

---

## How masstin parses UAL

Masstin uses [libesedb](https://github.com/libyal/libesedb) (Joachim Metz's forensic ESE library, same author as libvshadow) to read UAL databases directly — including **dirty databases** that were in use when the image was captured. No repair needed, no esentutl required.

### What masstin extracts

From the **CLIENTS** table in each `.mdb` file:

| UAL Field | Masstin Column | Description |
|-----------|---------------|-------------|
| `LastAccess` | `time_created` | Timestamp of most recent access |
| `InsertDate` | `time_created` | Timestamp of first access (second entry) |
| `AuthenticatedUserName` | `target_user_name` + `target_domain_name` | Split at `\` |
| `Address` | `src_ip` | IPv4, IPv6, or localhost (binary → readable) |
| Role (via `RoleGuid`) | `event_id` | Mapped to protocol: SMB, RDP, HTTP, LDAP, etc. |
| Server hostname | `dst_computer` | From `SystemIdentity.mdb` → `SYSTEM_IDENTITY` table |
| `TotalAccesses` | `detail` | Included as access count |

Each UAL record produces **two timeline entries**: one for the first access (`InsertDate`) and one for the most recent (`LastAccess`). This gives you two anchor points in your timeline.

### Role to protocol mapping

| UAL Role | Masstin `event_id` | What it means |
|----------|-------------------|---------------|
| File Server | `SMB` | SMB file share access, named pipes (PsExec, sc.exe) |
| Remote Access | `RDP` | Remote Desktop connections |
| Web Server | `HTTP` | IIS web server access |
| FTP Server | `HTTP` | FTP connections |
| Active Directory Domain Services | `LDAP` | AD authentication and queries |
| Active Directory Certificate Services | `CERT` | Certificate enrollment |
| DHCP Server | `DHCP` | DHCP lease requests |
| DNS Server | `DNS` | DNS queries |
| Print and Document Services | `PRINT` | Print server access |
| Other roles | `UAL` | Generic UAL access |

---

## Usage

### Automatic detection

When masstin scans a directory tree (with `-d`), it automatically looks for UAL databases in `Windows\System32\LogFiles\Sum\` and any subdirectory containing `.mdb` files:

```bash
# Point at an evidence root — masstin finds EVTX + UAL automatically
masstin -a parse-windows -d /evidence/C_drive/ -o timeline.csv

# Point directly at the Sum folder
masstin -a parse-windows -d /evidence/Windows/System32/LogFiles/Sum/ -o timeline.csv
```

### Direct file input

You can also pass individual `.mdb` files with `-f`:

```bash
masstin -a parse-windows -f Current.mdb -f SystemIdentity.mdb -o timeline.csv
```

> **Tip:** Always include `SystemIdentity.mdb` when using `-f` — it contains role name mappings and the server hostname.

### From forensic images

When using `parse-image-windows`, UAL databases are extracted from the NTFS filesystem automatically alongside EVTX files:

```bash
masstin -a parse-image-windows -f DC01.e01 -o timeline.csv
```

This extracts EVTX + UAL from the live volume and all VSS snapshots.

### From mounted volumes

```bash
masstin -a parse-image-windows -d D: -o timeline.csv
```

---

## Forensic analysis with UAL

### When event logs are gone

UAL is your fallback when Security.evtx has rolled over or been cleared. If the attacker used PsExec, mounted file shares, or accessed services via SMB, the **File Server** role will have recorded it — with the source IP, username, and timestamps going back years.

### Frequency analysis

UAL records the **total number of accesses** for each username/IP/role combination per year. A user with `TotalAccesses: 2` on a Domain Controller where admins typically show thousands of accesses is suspicious. Combined with timestamps around the incident timeframe, this is strong evidence of lateral movement.

### Correlating with other artifacts

UAL entries in the masstin timeline sit alongside EVTX events, Linux logs, and EDR data. When you see a `SMB` UAL entry from an IP that also appears in Security.evtx 4624 Type 3 logons, you have corroboration. When the EVTX is gone but the UAL record remains, you still have the access evidence.

### Working backwards to patient zero

If you know a compromised username, search the UAL timeline across all servers. The source IP addresses reveal which machines the attacker used as stepping stones. Follow the IPs backward through the timeline to find the beachhead host.

---

## Technical details

### ESE database handling

Masstin uses `libesedb` (via Rust FFI bindings) to read ESE databases. This is the same C library used by forensic tools like `esedbexport` and is maintained by Joachim Metz (author of libvshadow, libewf, and many other forensic libraries).

**Dirty databases**: ESE databases captured from running systems are typically in a "dirty shutdown" state. Unlike tools that require `esentutl.exe /p` to repair them first, libesedb reads dirty databases natively as a forensic library. No repair step needed.

### Deduplication

When multiple `.mdb` files contain the same record (e.g., `Current.mdb` and the yearly `{GUID}.mdb` snapshot), masstin's Polars deduplication removes the duplicates automatically — same as it does for EVTX events from live volume and VSS snapshots.

### Timestamp format

UAL stores timestamps as Windows FILETIME values (64-bit, 100-nanosecond intervals since 1601-01-01). Masstin converts these to `YYYY-MM-DD HH:MM:SS` UTC format, consistent with all other timeline entries.

---

## Comparison with other UAL tools

| Feature | SumECmd | KStrike | **masstin** |
|---------|:---:|:---:|:---:|
| Parse CLIENTS table | Yes | Yes | **Yes** |
| Parse SystemIdentity | Yes | Yes | **Yes** |
| Map RoleGuid to names | Yes | Yes | **Yes** |
| Handle dirty databases | No (needs esentutl) | No (needs esentutl) | **Yes (native)** |
| Merge with EVTX timeline | No | No | **Yes** |
| Extract from E01 images | No | No | **Yes** |
| Extract from VSS snapshots | No | No | **Yes** |
| Extract from mounted volumes | No | No | **Yes** |
| Graph database visualization | No | No | **Yes** |
| Cross-platform | Windows only (.NET) | Python | **Windows/Linux/macOS** |

---

## References

- [Microsoft: Get Started with User Access Logging](https://learn.microsoft.com/en-us/windows-server/administration/user-access-logging/get-started-with-user-access-logging)
- [CrowdStrike: User Access Logging Overview](https://www.crowdstrike.com/en-us/blog/user-access-logging-ual-overview/)
- [The DFIR Spot: Investigating Server Access with UAL](https://www.thedfirspot.com/post/sum-ual-investigating-server-access-with-user-access-logging)
- [SumECmd by Eric Zimmerman](https://github.com/EricZimmerman/Sum)
- [KStrike by Brian Moran](https://github.com/brimorlabs/KStrike)
- [libesedb by Joachim Metz](https://github.com/libyal/libesedb)
