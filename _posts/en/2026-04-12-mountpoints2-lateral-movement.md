---
layout: post
title: "MountPoints2: Lateral Movement Evidence Hidden in the Windows Registry"
date: 2026-04-12 01:00:00 +0100
category: artifacts
lang: en
ref: artifact-mountpoints2
tags: [masstin, registry, ntuser, mountpoints2, lateral-movement, dfir, forensics]
description: "The MountPoints2 registry key in NTUSER.DAT reveals which users connected to which remote shares — even after event logs are cleared. Masstin extracts and parses these keys automatically from forensic images."
comments: true
---

## When the logs are gone, the registry remembers

An attacker compromises a server, moves laterally via SMB shares, and clears the event logs before exfiltrating data. The Security.evtx is empty. The SMBClient logs are gone. But deep inside each user's registry hive, the **MountPoints2** key quietly records every remote share that was ever mounted — and it survives log clearing, because it's not a log.

## What is MountPoints2?

Every time a Windows user connects to a remote share (`\\SERVER\SHARE`), Windows Explorer records the connection in the user's registry:

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2
```

Each subkey represents a mounted volume or network share. Network shares use `#` instead of `\` in the key name:

| Subkey | Means |
|--------|-------|
| `##DC01#ADMIN$` | `\\DC01\ADMIN$` — admin share on domain controller |
| `##192.168.1.22#c$` | `\\192.168.1.22\C$` — C: drive share via IP |
| `##FILESERVER#Projects` | `\\FILESERVER\Projects` — file share |
| `##10.0.0.5#IPC$` | `\\10.0.0.5\IPC$` — IPC connection (often PsExec) |

## Forensic value

Each subkey has a **LastWriteTime** timestamp — the last time this share was accessed. Combined with the NTUSER.DAT location (`Users\<username>\NTUSER.DAT`), you get three critical pieces of information:

1. **Who** — the username (from the NTUSER.DAT file path)
2. **Where to** — the remote server and share name (from the subkey)
3. **When** — the timestamp (from the LastWriteTime)

This creates a direct **edge in the lateral movement graph**: `user@source_machine → remote_server`.

### Admin shares are red flags

The presence of admin shares (`C$`, `ADMIN$`, `IPC$`) in MountPoints2 is a strong indicator of lateral movement. Legitimate users rarely access admin shares — but PsExec, CrackMapExec, and manual attacker movement use them constantly.

## How masstin extracts MountPoints2

During `parse-image`, masstin automatically:

1. **Finds all user profiles** in `Users\*\` on each NTFS partition
2. **Extracts NTUSER.DAT** from each profile (skips Default, Public, system profiles)
3. **Parses the registry hive** using the `notatin` crate with:
   - Transaction log support (`.LOG1`, `.LOG2`) for dirty/unclean hives
   - Deleted key recovery for hives where the attacker tried to clean up
4. **Navigates to MountPoints2** and extracts all `##*` subkeys (network shares)
5. **Generates CONNECT events** with source machine, destination server, username, and timestamp

```bash
# Automatic — MountPoints2 is extracted alongside EVTX, UAL, VSS, and Tasks
masstin -a parse-image -f server.e01 -o timeline.csv
```

Output in the summary:
```
  Extracted: 424 EVTX + 5 UAL + 10 Tasks + 3 NTUSER.DAT
  => 2 MountPoints2 remote share events found
```

## CSV output

MountPoints2 events appear in the timeline as `CONNECT` events with `event_id = MountPoints2`:

| Column | Value |
|--------|-------|
| `time_created` | LastWriteTime of the registry subkey |
| `dst_computer` | Remote server (e.g., `74.118.139.11`, `DC01`) |
| `event_type` | `CONNECT` |
| `event_id` | `MountPoints2` |
| `target_user_name` | Username who connected (from NTUSER.DAT path) |
| `src_computer` | Machine where the registry was found |
| `src_ip` | IP address if the server was accessed by IP |
| `detail` | Full UNC path (e.g., `MountPoints2: \\74.118.139.11\M4Projects`) |
| `log_filename` | Source file (e.g., `HRServer.e01:live:mpowers_NTUSER.DAT`) |

## Real-world example

Processing the DEFCON DFIR CTF 2018 images with masstin:

```csv
2018-07-12T21:24:27+00:00,74.118.139.11,CONNECT,MountPoints2,"",mpowers,"",DESKTOP-1N4R894,74.118.139.11,...,MountPoints2: \\74.118.139.11\M4Projects
2018-07-23T16:00:53+00:00,74.118.139.11,CONNECT,MountPoints2,"",mpowers,"",WIN-29U41M70JCO,74.118.139.11,...,MountPoints2: \\74.118.139.11\M4Projects
```

User `mpowers` connected to `\\74.118.139.11\M4Projects` from two different machines — evidence of lateral movement that **does not appear in any EVTX file**. This was found exclusively in the registry.

## Dirty hives and transaction logs

Forensic images often contain dirty registry hives — the system was not shut down cleanly (common in incident response: pulled the plug, forensic acquisition while running, etc.). Dirty hives have uncommitted changes in transaction logs (`.LOG1`, `.LOG2`).

Masstin uses the `notatin` library (by Stroz Friedberg) which:

- Detects dirty hives and applies transaction logs automatically
- Recovers deleted registry cells (keys the attacker tried to remove)
- Handles both clean and dirty hives transparently

If transaction logs are found alongside the NTUSER.DAT in the forensic image, they are extracted and applied automatically.

## Comparison with other lateral movement artifacts

| Artifact | Survives log clearing? | Shows user? | Shows destination? | Shows timestamp? |
|----------|----------------------|-------------|-------------------|-----------------|
| Security.evtx (4624) | No | Yes | Yes | Yes |
| UAL (.mdb) | Yes | Yes | IP only | Yes |
| MountPoints2 | **Yes** | **Yes** | **Server + Share** | **Yes** |
| Scheduled Tasks XML | Yes | Partial | Author machine | Yes |
| VSS (recovered EVTX) | Depends | Yes | Yes | Yes |

MountPoints2 is unique because it provides the **share name** (e.g., `C$`, `ADMIN$`, `Projects`) — no other artifact gives you this level of detail about what the attacker accessed.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Forensic images and VSS recovery | [parse-image](/en/tools/masstin-vss-recovery/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| WinRM, WMI and Scheduled Tasks | [WinRM/WMI/Tasks](/en/artifacts/winrm-wmi-schtasks-lateral-movement/) |
| SMB EVTX events | [SMB Events](/en/artifacts/smb-evtx-events/) |
