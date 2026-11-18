---
layout: post
title: "WinRM, WMI and Scheduled Tasks: Hidden Lateral Movement Artifacts"
date: 2026-04-10 01:00:00 +0100
category: artifacts
section: lateral-windows
order: 40
lang: en
ref: artifact-winrm-wmi-schtasks
tags: [masstin, winrm, wmi, scheduled-tasks, lateral-movement, dfir, evtx, artifacts]
description: "How masstin extracts lateral movement evidence from WinRM, WMI-Activity and Scheduled Task artifacts — sources often overlooked by traditional EVTX analysis."
comments: true
---

## Beyond Security.evtx

Most lateral movement detection focuses on Security.evtx — Event IDs 4624, 4625, 5140 and their friends. But when attackers clear logs, disable auditing, or use techniques that bypass standard authentication events, these three artifact sources can fill the gaps:

- **WinRM/Operational** — PowerShell Remoting sessions
- **WMI-Activity/Operational** — Remote WMI command execution
- **Scheduled Tasks XML** — Tasks registered from a remote machine

Masstin parses all three automatically from forensic images. No extra configuration, no manual extraction.

## WinRM/Operational — Event ID 6

When an attacker uses PowerShell Remoting (`Enter-PSSession`, `Invoke-Command`), the **source system** logs Event ID 6 in `Microsoft-Windows-WinRM/Operational`. This event contains the `connection` field with the destination hostname or IP:

```
connection: dc01.domain.local/wsman?PSVersion=5.1.17763.592
```

Masstin extracts the destination host from this field and generates a `CONNECT` event. The `detail` column preserves the full connection string for context.

**Key point:** This event is logged on the **source** (attacker's machine), not the target. If you have images from both systems, WinRM Event 6 gives you the outbound connection that other logs miss.

| Field | Value |
|-------|-------|
| `dst_computer` | Destination host (taken from the event's connection string) |
| `src_computer` | Source system (the machine where the event was logged) |
| `event_id` | `6` |
| `event_type` | `CONNECT` |
| `detail` | `WinRM: <full connection string>` |

**Filtering:** Masstin automatically filters localhost connections (`localhost`, `127.0.0.1`, `::1`) and self-connections (destination hostname = source hostname), including FQDN vs NetBIOS name comparisons.

## WMI-Activity/Operational — Event ID 5858

Remote WMI execution (`wmic /node:host process call create`) generates Event ID 5858 on the **destination system**. This event contains the `ClientMachine` field — the hostname of the machine that initiated the WMI connection:

| Field | Value |
|-------|-------|
| `dst_computer` | Target system (where WMI ran) |
| `src_ip` / `src_computer` | `ClientMachine` (origin of the WMI connection) |
| `target_user_name` | User account used for the WMI call |
| `event_id` | `5858` |
| `event_type` | `CONNECT` |
| `detail` | `WMI: <WQL operation>` (truncated to 100 chars) |

**Filtering:** Masstin only generates events when `ClientMachine` differs from the local `Computer` name. This eliminates the vast majority of WMI noise (local Group Policy, scheduled tasks, etc.). FQDN vs short name comparison is handled automatically. System accounts (`SYSTEM`, `LOCAL SERVICE`, `NETWORK SERVICE`) are also filtered.

**Why this matters:** WMI is one of the stealthiest lateral movement techniques. Unlike PsExec (which creates services) or RDP (which generates extensive logging), WMI leaves minimal traces. Event 5858 is often the **only** artifact on the destination system.

## Scheduled Tasks — Remote Registration

When an attacker schedules a task remotely (via `schtasks /CREATE /S target` or similar tools), the task XML file in `Windows\System32\Tasks\` records the **source machine** in the `<Author>` field:

```xml
<RegistrationInfo>
    <Author>ATTACKER-PC\admin</Author>
    <Date>2024-03-15T14:30:00</Date>
    <URI>\MaliciousTask</URI>
</RegistrationInfo>
<Actions>
    <Exec>
        <Command>C:\temp\payload.exe</Command>
    </Exec>
</Actions>
```

The Author field keeps who registered the task, usually as `MACHINE\user` or `DOMAIN\user`. When the machine part is not this computer's own, the task may have been registered from somewhere else, and that is what masstin points out.

| Field | Value |
|-------|-------|
| `dst_computer` | Name of the machine holding the task (taken from its EVTX) |
| `src_computer` | The machine or domain part of the Author field |
| `target_user_name` | Username from Author field |
| `event_id` | `SCHTASK` |
| `event_type` | `CONNECT` |
| `detail` | `Task: <name> -> <command>` |
| `log_filename` | `image.e01:tasks:<TaskName>` |

**Filtering, and its limits:** masstin takes the machine's name from its own EVTX and compares it with the Author's. It only flags tasks where they differ. It is a **lead, not proof**: a task created locally with a domain account (the prefix is the domain, not the machine) and a machine renamed after the task was created both match too. Before stating that a task came from outside, check that the Author's name really is another machine on the network.

**Why this matters:** Scheduled Tasks are a common persistence and lateral movement mechanism. Even when attackers delete the task after execution (cleaning up Event IDs 4698/4699), the task XML file may still exist on disk — or be recoverable from VSS snapshots.

## How masstin handles these artifacts

All three artifact types are extracted automatically when `parse` reads a disk image:

```bash
masstin -a parse -d /evidence/ -o timeline.csv
```

For each forensic image:

1. **NTFS traversal** extracts EVTX files (including `WinRM/Operational` and `WMI-Activity/Operational`)
2. **Task extraction** recursively copies all files from `Windows\System32\Tasks\`
3. **EVTX parsing** applies WinRM Event 6 and WMI Event 5858 filters
4. **Task parsing** reads each XML, decodes UTF-16 if needed, and checks the Author field
5. **Hostname resolution** reads the Computer field from the image's own EVTX to correctly filter local vs remote
6. All events are merged into the unified CSV timeline

The resulting events appear alongside standard Security.evtx events and can be loaded directly into Neo4j or Memgraph for graph visualization — the `src_computer` → `dst_computer` relationship creates edges in the lateral movement graph.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Forensic image analysis and VSS recovery | [Forensic images](/en/tools/masstin-vss-recovery/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
| SMB EVTX events | [SMB events](/en/artifacts/smb-evtx-events/) |
