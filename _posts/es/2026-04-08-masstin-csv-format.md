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
| 4648 | `SUCCESSFUL_LOGON` | Logon con credenciales explícitas (runas) | Nombre del proceso |
| 4768 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de TGT Kerberos | Según campo Status |
| 4769 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de Service Ticket Kerberos | Según campo Status |
| 4770 | `SUCCESSFUL_LOGON` | Renovación de TGT Kerberos | |
| 4771 | `FAILED_LOGON` | Fallo de pre-autenticación Kerberos | |
| 4776 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Autenticación NTLM | Según campo Status |
| 4778 | `SUCCESSFUL_LOGON` | Sesión reconectada | |
| 4779 | `LOGOFF` | Sesión desconectada | |
| 5140 | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 5145 | `SUCCESSFUL_LOGON` | Comprobación de objeto en share | ShareName\NombreFichero |

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
| 1009 | SMBServer/Security | `SUCCESSFUL_LOGON` | Conexión SMB aceptada | |
| 551 | SMBServer/Security | `FAILED_LOGON` | Autenticación SMB fallida | |
| 31001 | SMBClient/Security | `SUCCESSFUL_LOGON` | Acceso a share SMB | ShareName |
| 5140 | Security.evtx | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 5145 | Security.evtx | `SUCCESSFUL_LOGON` | Comprobación de objeto en share | ShareName\NombreFichero |
| 30803-30808 | SMBClient/Connectivity | `CONNECT` | Eventos de conectividad SMB | |

### Linux

| Event ID | event_type | Descripción | Columna detail |
|---|---|---|---|
| `SSH_SUCCESS` | `SUCCESSFUL_LOGON` | Autenticación SSH exitosa | Método de auth (password/publickey) |
| `SSH_FAILED` | `FAILED_LOGON` | Autenticación SSH fallida | Método de auth |
| `SSH_CONNECT` | `CONNECT` | Conexión SSH (xinetd) | |

### Cortex XDR

| Origen | event_type | Descripción |
|---|---|---|
| Network (puertos 3389/445/22) | `CONNECT` | Datos de conexión a nivel de red |
| EVTX Forensics | Según Event ID | Mismo mapeo que Security.evtx |

---

## La columna logon_id

El campo `logon_id` contiene el identificador de sesión extraído del campo `TargetLogonId` de los eventos de Security.evtx (4624, 4634, 4647, 4648). Esto permite correlacionar sesiones: vincular un evento de logon con su logoff correspondiente para determinar la duración de la sesión.

Para eventos de Terminal Services se usa el `SessionId` cuando está disponible. Para Linux, Cortex y SMB este campo está vacío.

---

## La columna detail

La columna `detail` proporciona contexto adicional que varía según el tipo de evento:

| Evento | Contenido en detail |
|---|---|
| 4624, 4648 | Nombre del proceso que inició el logon |
| 4625 | Código hex SubStatus indicando el motivo del fallo |
| 5140 | ShareName (ej: `\\*\IPC$`, `\\*\C$`, `\\*\SYSVOL`) |
| 5145 | ShareName\NombreDelFichero |
| SMB 31001 | ShareName |
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
| `0xC0000070` | Logon fuera del horario permitido |
| `0xC000006D` | Nombre de usuario o información de autenticación incorrectos |
| `0xC0000071` | Contraseña expirada |
| `0xC0000224` | La contraseña debe cambiarse en el próximo logon |

---

## Preservación de datos

Masstin preserva los valores originales de la evidencia. Los nombres de nodos (hostnames, IPs) y propiedades se almacenan sin transformación. Solo los tipos de relación en bases de datos de grafos se normalizan (mayúsculas, guiones bajos) por restricciones del lenguaje Cypher. Consulta los artículos de [Neo4j](/es/tools/neo4j-cypher-visualization/) y [Memgraph](/es/tools/memgraph-visualization/) para más detalles.
