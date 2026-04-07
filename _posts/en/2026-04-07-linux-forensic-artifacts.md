---
layout: post
title: "Linux Forensic Artifacts for Lateral Movement"
date: 2026-04-07 11:00:00 +0100
category: artifacts
lang: en
ref: artifact-linux-logs
tags: [linux, ssh, lateral-movement, dfir, masstin, logs, utmp, wtmp, btmp, audit]
description: "Forensic guide to Linux artifacts for detecting lateral movement: /var/log/secure, audit.log, utmp/wtmp/btmp, and lastlog for reconstructing SSH sessions and remote access."
comments: true
---

## Lateral Movement in Linux: Different Ecosystem, Same Principles

When we think about lateral movement, the conversation tends to center on Windows environments: EVTX, Kerberos, PsExec, RDP. But modern enterprise environments are hybrid, and attackers don't stop at operating system boundaries. Linux servers — especially those running web services, databases, or container infrastructure — are frequent targets.

The primary lateral movement vector in Linux is **SSH**. Unlike Windows, where multiple remote access protocols exist (RDP, WMI, WinRM, SMB), nearly all remote access in Linux goes through SSH. This simplifies analysis but also demands knowing exactly where to look.

[Masstin](/en/tools/masstin-lateral-movement-rust/) supports parsing Linux logs, integrating SSH activity into the same lateral movement timeline as Windows artifacts.

---

## /var/log/secure and /var/log/auth.log

Depending on the distribution, authentication events are recorded in:
- **/var/log/secure** — Red Hat, CentOS, Fedora, Rocky Linux
- **/var/log/auth.log** — Debian, Ubuntu

Both contain the same information; only the path differs.

### Successful SSH Logon

A successful SSH logon generates a line like this:

```
Apr  7 14:23:01 server sshd[12345]: Accepted publickey for admin from 10.0.1.50 port 52341 ssh2
```

| Field | Description |
|-------|-------------|
| Timestamp | Event date and time |
| Hostname | Machine where the logon occurred |
| PID | Process ID of the sshd process managing the session |
| Method | `publickey`, `password`, `keyboard-interactive`, `gssapi-with-mic` (Kerberos) |
| User | Account that logged in |
| Source IP | IP address the connection came from |
| Source Port | Client's ephemeral port |

> **Lateral movement indicators:**
> - Logon with `password` from an internal IP that normally uses public key.
> - Direct `root` logon (if `PermitRootLogin` is enabled).
> - Logon from an unrecognized IP or outside business hours.

### Failed SSH Logon

```
Apr  7 14:23:05 server sshd[12346]: Failed password for admin from 10.0.1.50 port 52342 ssh2
Apr  7 14:23:06 server sshd[12346]: Failed password for invalid user test from 10.0.1.50 port 52343 ssh2
```

| Pattern | Meaning |
|---------|---------|
| `Failed password for <user>` | Wrong password for existing user |
| `Failed password for invalid user <user>` | User does not exist on the system |
| `Connection closed by <IP> [preauth]` | Connection closed before authentication completed |
| `Too many authentication failures` | Multiple failed attempts — brute force |

> **Brute force detection:** A burst of `Failed password` entries followed by an `Accepted password` indicates successful brute force.

### Connection and Disconnection Events

```
Apr  7 14:23:01 server sshd[12345]: Connection from 10.0.1.50 port 52341
Apr  7 14:45:30 server sshd[12345]: Disconnected from user admin 10.0.1.50 port 52341
Apr  7 14:45:30 server sshd[12345]: pam_unix(sshd:session): session closed for user admin
```

These events allow you to calculate session duration and confirm the session was closed cleanly.

---

## /var/log/messages

On Red Hat-based distributions, `/var/log/messages` records general system events, including some SSH and PAM-related entries that don't appear in `/var/log/secure`.

| Entry Type | Example | Relevance |
|------------|---------|-----------|
| PAM session opened | `pam_unix(sshd:session): session opened for user admin` | Confirms SSH session start |
| PAM session closed | `pam_unix(sshd:session): session closed for user admin` | Confirms session end |
| systemd-logind | `New session 42 of user admin` | Session registered by systemd |
| su/sudo | `admin : TTY=pts/0 ; COMMAND=/bin/bash` | Post-logon privilege escalation |

---

## /var/log/audit/audit.log

The Linux audit subsystem (auditd) provides a higher level of detail than standard logs. It's especially useful when specific rules are configured to monitor SSH and remote access.

### SSH Events in audit.log

```
type=USER_AUTH msg=audit(1712502181.123:4567): pid=12345 uid=0 auid=4294967295 ses=4294967295 msg='op=PAM:authentication grantors=pam_unix acct="admin" exe="/usr/sbin/sshd" hostname=10.0.1.50 addr=10.0.1.50 terminal=ssh res=success'
```

| Field | Description |
|-------|-------------|
| type | `USER_AUTH` (authentication), `USER_LOGIN` (logon), `USER_LOGOUT` (logout) |
| pid | sshd process PID |
| acct | Authenticated account |
| exe | Executable that performed the authentication |
| hostname / addr | Source IP |
| res | `success` or `failed` |

Relevant audit record types for lateral movement:

| Audit Type | Description |
|-----------|-------------|
| USER_AUTH | PAM authentication result |
| USER_LOGIN | User logon completed |
| USER_LOGOUT | User logout |
| CRED_ACQ | Credentials acquired |
| CRED_DISP | Credentials released |
| USER_ACCT | Account verification (exists, not expired, etc.) |

> **audit.log advantage:** Unlike `/var/log/secure`, audit.log uses a structured format with precise Unix timestamps, making temporal correlation with other artifacts easier.

---

## utmp, wtmp, and btmp

These are **binary files** that record user session information. They cannot be read with `cat` — they require tools like `who`, `w`, `last`, `lastb`, and `utmpdump`.

### utmp — Active Sessions

**Location:** `/var/run/utmp`

Records currently open sessions on the system. This is what the `who` and `w` commands query.

| Field | Description |
|-------|-------------|
| ut_type | Record type (USER_PROCESS, LOGIN_PROCESS, etc.) |
| ut_user | Username |
| ut_line | Terminal (e.g., `pts/0`, `tty1`) |
| ut_host | Source IP or hostname (for remote sessions) |
| ut_time | Event timestamp |

> **Limitation:** utmp only contains active sessions. When a session closes, it's removed from utmp and written to wtmp.

### wtmp — Session History

**Location:** `/var/log/wtmp`

Records all logon and logout sessions, including system reboots. It's a cumulative historical record.

```bash
last -f /var/log/wtmp
```

Typical output:
```
admin    pts/0        10.0.1.50        Mon Apr  7 14:23 - 14:45  (00:22)
root     pts/1        10.0.1.100       Mon Apr  7 03:15 - 03:17  (00:02)
reboot   system boot  5.14.0-284.el9   Mon Apr  7 00:00
```

| Information | Forensic Relevance |
|-------------|-------------------|
| User + source IP | Who connected and from where |
| Terminal | `pts/*` = remote session (SSH/telnet), `tty*` = local console |
| Duration | Session length — short sessions may be automated |
| Reboots | The `reboot` event indicates system boots |

> **Forensic analysis:** Sessions by `root` from internal IPs at 3 AM lasting 2 minutes are highly suspicious.

### btmp — Failed Logon Attempts

**Location:** `/var/log/btmp`

Records all failed logon attempts. It's the Linux equivalent of Windows Event ID 4625.

```bash
lastb -f /var/log/btmp
```

Typical output:
```
admin    ssh:notty    10.0.1.50        Mon Apr  7 14:22 - 14:22  (00:00)
root     ssh:notty    192.168.1.200    Mon Apr  7 14:22 - 14:22  (00:00)
test     ssh:notty    10.0.1.50        Mon Apr  7 14:22 - 14:22  (00:00)
```

> **Attack detection:**
> - Multiple entries from the same IP with different users = **password spraying**.
> - Multiple entries with the same user from the same IP = **brute force**.
> - Attempts with users like `admin`, `test`, `root`, `oracle` = **dictionary attack**.

---

## lastlog — Last Logon Per User

**Location:** `/var/log/lastlog`

Records the date, time, and source of the last successful logon for each system user.

```bash
lastlog
```

Typical output:
```
Username         Port     From             Latest
root             pts/1    10.0.1.100       Mon Apr  7 03:15:22 +0100 2026
admin            pts/0    10.0.1.50        Mon Apr  7 14:23:01 +0100 2026
www-data                                   **Never logged in**
```

> **Forensic value:** If a service account like `www-data` or `postgres` shows a recent logon, it's a strong indicator of compromise — these accounts normally don't have interactive logons.

---

## Linux Artifact Summary

| Artifact | Location | Format | What It Records | Reading Tool |
|----------|----------|--------|----------------|-------------|
| secure / auth.log | `/var/log/secure` or `/var/log/auth.log` | Text | SSH authentication (successes, failures, connections) | `cat`, `grep` |
| messages | `/var/log/messages` | Text | System events, PAM, systemd | `cat`, `grep` |
| audit.log | `/var/log/audit/audit.log` | Structured text | Detailed authentication auditing | `ausearch`, `aureport` |
| utmp | `/var/run/utmp` | Binary | Active sessions | `who`, `w` |
| wtmp | `/var/log/wtmp` | Binary | Logon/logout history | `last` |
| btmp | `/var/log/btmp` | Binary | Failed logons | `lastb` |
| lastlog | `/var/log/lastlog` | Binary | Last logon per user | `lastlog` |

---

## How Masstin Parses Linux Artifacts

[Masstin](/en/tools/masstin-lateral-movement-rust/) supports parsing Linux authentication logs, extracting successful and failed logons from `/var/log/secure` (and `/var/log/auth.log`), and normalizing them into the same CSV format used for Windows artifacts.

```bash
masstin parse -i /path/to/linux/logs/ -o timeline.csv
```

This enables creating lateral movement timelines that cross operating system boundaries: an attacker moving from a Windows workstation to a Linux server via SSH will appear in the same timeline as their RDP or SMB movements.

---

## Conclusion

In hybrid environments, ignoring Linux artifacts leaves critical blind spots in your investigation. SSH authentication logs, binary utmp/wtmp/btmp records, and audit.log provide the same forensic richness as Windows EVTX files — you just need to know where to look.

[Masstin](/en/tools/masstin-lateral-movement-rust/) unifies these artifacts with Windows ones to give you a complete view of lateral movement across your entire infrastructure.
