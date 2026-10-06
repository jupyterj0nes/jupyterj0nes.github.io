---
layout: page
title: "Artifacts"
description: "Forensic artifacts — detailed guides for Windows EVTX, Linux, Winlogbeat and Cortex XDR."
lang: en
ref: artifacts
permalink: /en/artifacts/
---

## Windows Event Logs (EVTX)

| Artifact | Description | Article |
|----------|-------------|---------|
| **Security.evtx** | 13 Event IDs: logons, Kerberos, NTLM, RDP | [Read →](/en/artifacts/security-evtx-lateral-movement/) |
| **Terminal Services** | RDP session lifecycle (LSM, RDPClient, RCM, RdpCoreTS) | [Read →](/en/artifacts/terminal-services-evtx/) |
| **SMB** | SMB server and client connections | [Read →](/en/artifacts/smb-evtx-events/) |
| **Sysmon** | Event ID 3: network connections on lateral-movement service ports | [Read →](/en/tools/masstin-csv-format/) |
| **Prefetch** | Evidence of program execution on Windows | [Read →](/en/artifacts/windows-prefetch-forensics/) |

## Linux

| Artifact | Description | Article |
|----------|-------------|---------|
| **Linux Logs** | auth.log, secure, messages, audit.log, systemd-journald, utmp, wtmp, btmp, lastlog — loose, in zip / tar.gz, or UAC triages | [Read →](/en/artifacts/linux-forensic-artifacts/) |

## Other Sources

| Artifact | Description | Article |
|----------|-------------|---------|
| **Winlogbeat** | Windows log parsing from JSON format | [Read →](/en/artifacts/winlogbeat-elastic-artifacts/) |
| **Cortex XDR** | Network data and forensic agent collections | [Read →](/en/artifacts/cortex-xdr-artifacts/) |
| **Custom parsers** | VPN, firewall, proxy and JSON logs via YAML rules | [Read →](/en/tools/masstin-custom-parsers/) |

**Total:** 33 Windows Event IDs across 12 EVTX sources + 9 Linux artifact types + Winlogbeat JSON + Cortex XDR + YAML custom parsers.
