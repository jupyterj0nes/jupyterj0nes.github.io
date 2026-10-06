---
layout: page
title: "Artefactos"
description: "Artefactos forenses — guías detalladas de Windows EVTX, Linux, Winlogbeat y Cortex XDR."
lang: es
ref: artifacts
permalink: /es/artifacts/
---

## Windows Event Logs (EVTX)

| Artefacto | Descripción | Artículo |
|-----------|-------------|----------|
| **Security.evtx** | 13 Event IDs: logons, Kerberos, NTLM, RDP | [Leer →](/es/artifacts/security-evtx-lateral-movement/) |
| **Terminal Services** | Ciclo de vida de sesiones RDP (LSM, RDPClient, RCM, RdpCoreTS) | [Leer →](/es/artifacts/terminal-services-evtx/) |
| **SMB** | Conexiones SMB de servidor y cliente | [Leer →](/es/artifacts/smb-evtx-events/) |
| **Sysmon** | Event ID 3: conexiones de red a puertos de servicio de movimiento lateral | [Leer →](/es/tools/masstin-csv-format/) |
| **Prefetch** | Evidencia de ejecución de programas en Windows | [Leer →](/es/artifacts/windows-prefetch-forensics/) |

## Linux

| Artefacto | Descripción | Artículo |
|-----------|-------------|----------|
| **Logs de Linux** | auth.log, secure, messages, audit.log, systemd-journald, utmp, wtmp, btmp, lastlog — sueltos, en zip / tar.gz o en triages de UAC | [Leer →](/es/artifacts/linux-forensic-artifacts/) |

## Otras fuentes

| Artefacto | Descripción | Artículo |
|-----------|-------------|----------|
| **Winlogbeat** | Parseo de logs de Windows en formato JSON | [Leer →](/es/artifacts/winlogbeat-elastic-artifacts/) |
| **Cortex XDR** | Datos de red y colecciones forenses de agentes | [Leer →](/es/artifacts/cortex-xdr-artifacts/) |
| **Parsers custom** | Logs de VPN, firewall, proxy y JSON mediante reglas YAML | [Leer →](/es/tools/masstin-custom-parsers/) |

**Total:** 33 Event IDs de Windows en 12 fuentes EVTX + 9 tipos de artefacto Linux + Winlogbeat JSON + Cortex XDR + parsers custom YAML.
