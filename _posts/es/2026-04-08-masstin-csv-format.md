---
layout: post
title: "Formato CSV de Masstin y Clasificacion de Eventos"
date: 2026-04-08 01:00:00 +0100
category: tools
lang: es
ref: tool-masstin-csv-format
tags: [masstin, csv, event-type, lateral-movement, dfir, herramientas]
description: "Referencia completa del formato CSV de masstin: 14 columnas, clasificacion event_type, mapeo de Event IDs, logon_id para correlacion de sesiones y columna detail."
comments: true
---

## Estructura del CSV

Todas las acciones de masstin producen un CSV unificado con 14 columnas, independientemente del origen (Windows EVTX, logs Linux, Winlogbeat JSON o Cortex XDR):

| # | Columna | Descripción |
|---|---------|-------------|
| 1 | `time_created` | Marca temporal del evento |
| 2 | `dst_computer` | Máquina destino (la que recibe la conexión) |
| 3 | `event_type` | Clasificación del evento (ver abajo) |
| 4 | `event_id` | ID original del evento (ej: `4624`, `SSH_SUCCESS`) |
| 5 | `logon_type` | Tipo de logon de Windows tal como lo reporta el evento (ej: `2`, `3`, `7`, `10`, `11`) |
| 6 | `target_user_name` | Cuenta de usuario objetivo de la acción |
| 7 | `target_domain_name` | Dominio del usuario objetivo |
| 8 | `src_computer` | Máquina origen (la que inició la conexión) |
| 9 | `src_ip` | IP de origen |
| 10 | `subject_user_name` | Cuenta de usuario que inició la acción |
| 11 | `subject_domain_name` | Dominio del usuario que inició la acción |
| 12 | `logon_id` | ID de sesión para correlación (ej: `0x1A2B3C`) |
| 13 | `detail` | Contexto adicional según el tipo de evento |
| 14 | `log_filename` | Fichero de artefacto de origen |

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

`logon_type` es `SSH` en todas las filas de Linux.

### Cortex XDR

| Origen | event_type | Descripción |
|---|---|---|
| Network (puertos 22/445/3389/5985/5986 por defecto) | `CONNECT` | Datos de conexión a nivel de red |
| EVTX Forensics | Según Event ID | Mismo mapeo que Security.evtx |

---

## La columna logon_id

El campo `logon_id` contiene el identificador de sesión extraído del campo `TargetLogonId` de los eventos de Security.evtx (4624, 4634, 4647, 4648; `LogonID` en 4778/4779). Esto permite correlacionar sesiones: vincular un evento de logon con su logoff correspondiente para determinar la duración de la sesión.

Para eventos de Terminal Services se usa el `SessionId` cuando está disponible. En las filas de Linux lleva el pid del proceso sshd (`sshd[pid]`, `_PID` de journald, `pid=` de auditd, `ut_pid` de wtmp), el mismo en el login y en su `LOGOFF`. Para Cortex y SMB este campo está vacío.

---

## La columna detail

La columna `detail` proporciona contexto adicional que varía según el tipo de evento:

| Evento | Contenido en detail |
|---|---|
| 4624, 4648 | Nombre del proceso que inició el logon |
| 4625 | Código hex SubStatus indicando el motivo del fallo |
| 5140 | ShareName (ej: `\\*\IPC$`, `\\*\C$`, `\\*\SYSVOL`) |
| SMB 31001 | ShareName |
| Sysmon 3 | Protocolo, proceso que inicia la conexión y puerto de servicio |
| Eventos SSH | Método de autenticación (`password`, `publickey`) |
| Cortex Network | Línea de comandos del proceso que generó la conexión |
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
