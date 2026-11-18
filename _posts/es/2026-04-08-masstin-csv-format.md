---
layout: post
title: "Formato CSV de Masstin y Clasificacion de Eventos"
date: 2026-04-08 01:00:00 +0100
category: tools
section: masstin-ref
order: 10
lang: es
ref: tool-masstin-csv-format
tags: [masstin, csv, event-type, lateral-movement, dfir, herramientas]
description: "Referencia completa del formato CSV de masstin: 14 columnas, clasificacion event_type, mapeo de Event IDs, logon_id para correlacion de sesiones y columna detail."
comments: true
---

## Estructura del CSV

Todas las acciones de masstin que parsean evidencia (y `merge`) producen un CSV unificado con 19 columnas, independientemente del origen (Windows EVTX, logs Linux, Winlogbeat JSON o Cortex XDR). Las acciones que cargan en una base de datos de grafos y la ventana (`view`) no escriben otro formato: leen este mismo CSV.

Las 14 primeras columnas describen el evento y las escriben los parsers:

| # | Columna | Descripción |
|---|---------|-------------|
| 1 | `time_created` | Marca temporal del evento |
| 2 | `dst_computer` | Máquina destino (la que recibe la conexión) |
| 3 | `event_type` | Clasificación del evento (ver abajo) |
| 4 | `event_id` | ID original del evento (ej: `4624`, `SSH_SUCCESS`, `SMB`, `RDP`) |
| 5 | `logon_type` | Tipo de logon de Windows tal como lo reporta el evento (ej: `2`, `3`, `7`, `10`, `11`). En las filas de Linux vale `SSH` |
| 6 | `target_user_name` | Cuenta de usuario objetivo de la acción |
| 7 | `target_domain_name` | Dominio del usuario objetivo |
| 8 | `src_computer` | Máquina origen (la que inició la conexión) |
| 9 | `src_ip` | IP de origen |
| 10 | `subject_user_name` | Cuenta de usuario que inició la acción |
| 11 | `subject_domain_name` | Dominio del usuario que inició la acción |
| 12 | `logon_id` | ID de sesión para correlación (ej: `0x1A2B3C`) |
| 13 | `detail` | Contexto adicional según el tipo de evento |
| 14 | `log_filename` | Fichero de artefacto de origen |

Las 5 últimas son la cola de análisis. Salen vacías del parser y se rellenan después:

| # | Columna | Quién la escribe | Contenido |
|---|---------|------------------|-----------|
| 15 | `hunt` | `graph-hunt-csv` | Qué concluyó la caza sobre la conexión de la fila: `significant`, `candidate`, `habitual`, `not_evaluated`, `baseline` o vacío |
| 16 | `hunt_score` | `graph-hunt-csv` | Cómo de rara es la conexión, un entero de 0 a 100. `0` para una conexión habitual |
| 17 | `hunt_why` | `graph-hunt-csv` | Por qué la conexión es inusual, en palabras |
| 18 | `verdict` | El analista (en la ventana, en una herramienta de casos o a mano) | `suspicious`, `confirmed`, `benign` o vacío |
| 19 | `notes` | El analista | Texto libre |

Las timelines escritas antes de la v1.4.0 solo tienen las 14 columnas del evento. masstin las sigue leyendo.

**`target_user_name` y `subject_user_name` no son lo mismo.** La cuenta *target* es la que inicia sesión: la que entra en la máquina destino. La cuenta *subject* es la que pidió ese logon, y en muchos eventos viene vacía. El caso más claro es el 4648 (`runas`): *subject* es la cuenta que ya tenía la sesión abierta y *target* es la cuenta cuyas credenciales se usaron para conectar.

---

## Clasificación de event_type

Masstin clasifica cada evento en una de cuatro categorías:

| event_type | Significado | Cuando |
|---|---|---|
| `SUCCESSFUL_LOGON` | Autenticación exitosa | El usuario se autenticó correctamente y se estableció sesión |
| `FAILED_LOGON` | Autenticación fallida | Credenciales incorrectas, cuenta bloqueada o fallo de pre-autenticación |
| `LOGOFF` | Sesión finalizada | El usuario cerró sesión o la sesión fue desconectada |
| `CONNECT` | Evento de conexión | Conexión de red sin resultado de autenticación |

---

## Mapeo de Event ID a event_type

Cada tabla resume un artefacto. Si un log no te suena, su artículo explica qué es, en qué fichero está y cómo leer cada evento:

- Security.evtx: [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/)
- Terminal Services (RDP): [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/)
- SMB: [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/)
- WinRM, WMI y Scheduled Tasks: [WinRM, WMI y Tasks](/es/artifacts/winrm-wmi-schtasks-lateral-movement/)
- Linux: [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/)
- Cortex XDR: [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/)
- UAL: [User Access Logging](/es/tools/masstin-ual/)
- MountPoints2: [MountPoints2](/es/artifacts/mountpoints2-lateral-movement/)

### Security.evtx

| Event ID | event_type | Descripción | Columna detail |
|---|---|---|---|
| 4624 | `SUCCESSFUL_LOGON` | Logon exitoso | Nombre del proceso |
| 4625 | `FAILED_LOGON` | Logon fallido | Código SubStatus (ej: `0xC000006A` = contraseña incorrecta) |
| 4634 | `LOGOFF` | Logoff | |
| 4647 | `LOGOFF` | Logoff iniciado por usuario | |
| 4648 | `SUCCESSFUL_LOGON` | Logon con credenciales explícitas (runas) — se registra en el host origen, así que `dst_computer` es el `TargetServerName` | Nombre del proceso |
| 4768 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de TGT Kerberos | Según campo Status |
| 4769 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de Service Ticket Kerberos | Según campo Status |
| 4770 | `SUCCESSFUL_LOGON` | Renovación de TGT Kerberos | |
| 4771 | `FAILED_LOGON` | Fallo de pre-autenticación Kerberos | |
| 4776 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Autenticación NTLM | Según campo Status |
| 4778 | `SUCCESSFUL_LOGON` | Sesión reconectada (logon_type 10) | |
| 4779 | `LOGOFF` | Sesión desconectada (logon_type 10) | |
| 5140 | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |

### Terminal Services (RDP)

| Event ID | Origen | event_type | Descripción |
|---|---|---|---|
| 21 | LocalSessionManager | `SUCCESSFUL_LOGON` | Sesión RDP iniciada |
| 22 | LocalSessionManager | `SUCCESSFUL_LOGON` | Shell RDP listo |
| 24 | LocalSessionManager | `LOGOFF` | Sesión RDP desconectada |
| 25 | LocalSessionManager | `SUCCESSFUL_LOGON` | Sesión RDP reconectada |
| 1024 | RDPClient | `CONNECT` | Conexión RDP saliente |
| 1102 | RDPClient | `CONNECT` | Conexión RDP saliente |
| 1149 | RemoteConnectionManager | `SUCCESSFUL_LOGON` | Autenticación RDP exitosa |
| 131 | RdpCoreTS | `CONNECT` | Transporte RDP aceptado |

### SMB

| Event ID | Origen | event_type | Descripción | Columna detail |
|---|---|---|---|---|
| 1009 | SMBServer/Security | `FAILED_LOGON` | El servidor denegó el acceso anónimo al cliente | |
| 551 | SMBServer/Security | `FAILED_LOGON` | Autenticación SMB fallida | |
| 31001 | SMBClient/Security | `FAILED_LOGON` | El cliente no consiguió autenticarse en el servidor | ShareName |
| 5140 | Security.evtx | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 30803-30808 | SMBClient/Connectivity | `CONNECT` | Eventos de conectividad SMB | |

### WinRM y WMI

| Event ID | Origen | event_type | Descripción | columna detail |
|---|---|---|---|---|
| 6 | WinRM/Operational | `CONNECT` | Sesión PowerShell Remoting iniciada (sistema origen) | `WinRM: <conexión>` |
| 5858 | WMI-Activity/Operational | `CONNECT` | Ejecución WMI remota (sistema destino, solo cuando ClientMachine difiere de Computer) | `WMI: <operación>` |

### Sysmon

| Event ID | Origen | event_type | Descripción | Columna detail |
|---|---|---|---|---|
| 3 | Sysmon/Operational | `CONNECT` | Conexión de red a un puerto de servicio de movimiento lateral (22, 135, 139, 445, 1433, 3306, 3389, 5900, 5985, 5986); el host con Sysmon es el extremo local e `Initiated` marca la dirección | `Sysmon3 <protocolo> <proceso> :<puerto>` |

### Scheduled Tasks

| Event ID | Origen | event_type | Descripción | columna detail |
|---|---|---|---|---|
| `SCHTASK` | XML de tarea (Windows\System32\Tasks) | `CONNECT` | Tarea programada remotamente (máquina del Author diferente del hostname local) | `Task: <nombre> -> <comando>` |

### Linux

| Event ID | event_type | Descripción | Columna detail |
|---|---|---|---|
| `SSH_SUCCESS` | `SUCCESSFUL_LOGON` | Autenticación SSH exitosa (log de sshd, journald, auditd `USER_LOGIN`) | Método de auth (password/publickey) |
| `SSH_FAILED` | `FAILED_LOGON` | Autenticación SSH fallida | Método de auth |
| `SSH_PREAUTH` | `CONNECT` | Conexión cerrada antes de autenticarse (cierre `[preauth]`, sin identification string) | |
| `SSH_CONNECT` | `CONNECT` | Conexión SSH (xinetd) | |
| `LOGIN` | `SUCCESSFUL_LOGON` | Registro de login en wtmp / utmp | |
| `FAILED_LOGIN` | `FAILED_LOGON` | Registro de btmp | |
| `LASTLOG` | `SUCCESSFUL_LOGON` | Último login por cuenta (lastlog) | |
| `LOGOUT` | `LOGOFF` | Fin de sesión emparejado con su login por el pid de sshd (wtmp, pam `session closed`, journald, auditd `USER_END`) | |
| `AUDIT_CONNECT` | `CONNECT` | Conexión saliente de una sesión de login a un puerto de acceso remoto, registrada por auditd. Escrita desde el origen (masstin 1.5.0) | Programa, dirección, puerto y sesión |

`logon_type` es `SSH` en todas las filas de Linux.

### Cortex XDR

| Origen | event_type | Descripción |
|---|---|---|
| Network (puertos 22/445/3389/5985/5986 por defecto) | `CONNECT` | Datos de conexión a nivel de red |
| Event logs de los agentes (`eventlog`) | Según Event ID | Mismo mapeo que un EVTX |
| EVTX Forensics | Según Event ID | Mismo mapeo que Security.evtx |

### UAL y MountPoints2

Estas dos fuentes no son logs de eventos, así que su `event_id` no es un número:

| event_id | Origen | Descripción | Columna detail |
|---|---|---|---|
| `SMB`, `RDP`, `HTTP`, `LDAP`, `CERT`, `DHCP`, `DNS`, `PRINT`, `UAL` | Bases de datos UAL (`.mdb`) | Acceso de un cliente a un rol del servidor. El `event_id` es el protocolo del rol | Rol y número de accesos |
| `MountPoints2` | NTUSER.DAT | `CONNECT`: el usuario conectó con un recurso compartido remoto | Ruta UNC del recurso |

---

## La columna logon_id

El campo `logon_id` identifica una sesión. En las filas escritas desde el destino (4624, 4634, 4647, y 4778/4779 con su `LogonID`) es la sesión que el evento abrió o cerró en esa máquina, y sirve para emparejar un logon con su logoff y saber cuánto duró.

En las filas escritas desde el **origen** de una conexión es otra cosa: la sesión, en el origen, que la hizo. Es el `SubjectLogonId` de un 4648 y el login de la sesión de auditd en un `AUDIT_CONNECT`. Con eso se puede decir qué sesión dio el siguiente salto (desde masstin 1.5.0).

Un ejemplo. Una cuenta entra en el servidor A: A escribe un 4624 y su `logon_id` es la sesión recién abierta. Desde esa sesión, la cuenta conecta con el servidor B usando otras credenciales: A escribe un 4648, y el `logon_id` de esa fila es el mismo. Las dos filas comparten `logon_id` en la misma máquina, así que sabes que el salto a B lo dio la sesión que había entrado en A.

Para eventos de Terminal Services se usa el `SessionId` cuando está disponible. En las filas de Linux lleva el pid del proceso sshd (`sshd[pid]`, `_PID` de journald, `pid=` de auditd, `ut_pid` de wtmp), el mismo en el login y en su `LOGOFF`. Para Cortex y SMB este campo está vacío.

---

## La columna detail

La columna `detail` proporciona contexto adicional que varía según el tipo de evento:

| Evento | Contenido en detail |
|---|---|
| 4624, 4648 | Nombre del proceso que inició el logon |
| 4625 | Motivo del fallo en texto, con el código hex SubStatus entre paréntesis (ej: `Wrong password (0xc000006a)`) |
| 5140 | ShareName (ej: `\\*\IPC$`, `\\*\C$`, `\\*\SYSVOL`) |
| SMB 31001 | ShareName |
| Sysmon 3 | Protocolo, proceso que inicia la conexión y puerto de servicio |
| Eventos SSH | Método de autenticación (`password`, `publickey`) |
| Cortex Network | Línea de comandos del proceso que generó la conexión |
| UAL | Rol del servidor y número de accesos |
| MountPoints2 | Ruta UNC del recurso compartido |
| Otros eventos | Vacío |

### Códigos SubStatus comunes del 4625

| SubStatus | Significado |
|---|---|
| `0xC000006A` | Contraseña incorrecta |
| `0xC0000064` | El usuario no existe |
| `0xC0000072` | Cuenta deshabilitada |
| `0xC0000234` | Cuenta bloqueada |
| `0xC0000070` | Restricción de estación de trabajo |
| `0xC000006D` | Nombre de usuario o información de autenticación incorrectos |
| `0xC0000071` | Contraseña expirada |
| `0xC0000224` | La contraseña debe cambiarse en el próximo logon |

---

## Preservación de datos

Masstin preserva los valores originales de la evidencia. Los nombres de nodos (hostnames, IPs) y propiedades se almacenan sin transformación. Solo los tipos de relación en bases de datos de grafos se normalizan (mayúsculas, guiones bajos) por restricciones del lenguaje Cypher. Consulta los artículos de [Neo4j](/es/tools/neo4j-cypher-visualization/) y [Memgraph](/es/tools/memgraph-visualization/) para más detalles.
