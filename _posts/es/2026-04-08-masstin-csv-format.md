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

| # | Columna | Descripcion |
|---|---------|-------------|
| 1 | `time_created` | Marca temporal del evento |
| 2 | `dst_computer` | Maquina destino (la que recibe la conexion) |
| 3 | `event_type` | Clasificacion del evento (ver abajo) |
| 4 | `event_id` | ID original del evento (ej: `4624`, `SSH_SUCCESS`) |
| 5 | `logon_type` | Tipo de logon de Windows tal como lo reporta el evento (ej: `2`, `3`, `7`, `10`, `11`) |
| 6 | `target_user_name` | Cuenta de usuario objetivo de la accion |
| 7 | `target_domain_name` | Dominio del usuario objetivo |
| 8 | `src_computer` | Maquina origen (la que inicio la conexion) |
| 9 | `src_ip` | IP de origen |
| 10 | `subject_user_name` | Cuenta de usuario que inicio la accion |
| 11 | `subject_domain_name` | Dominio del usuario que inicio la accion |
| 12 | `logon_id` | ID de sesion para correlacion (ej: `0x1A2B3C`) |
| 13 | `detail` | Contexto adicional segun el tipo de evento |
| 14 | `log_filename` | Fichero de artefacto de origen |

---

## Clasificacion de event_type

Masstin clasifica cada evento en una de cuatro categorias:

| event_type | Significado | Cuando |
|---|---|---|
| `SUCCESSFUL_LOGON` | Autenticacion exitosa | El usuario se autentico correctamente y se establecio sesion |
| `FAILED_LOGON` | Autenticacion fallida | Credenciales incorrectas, cuenta bloqueada o fallo de pre-autenticacion |
| `LOGOFF` | Sesion finalizada | El usuario cerro sesion o la sesion fue desconectada |
| `CONNECT` | Evento de conexion | Conexion de red sin resultado de autenticacion |

---

## Mapeo de Event ID a event_type

### Security.evtx

| Event ID | event_type | Descripcion | Columna detail |
|---|---|---|---|
| 4624 | `SUCCESSFUL_LOGON` | Logon exitoso | Nombre del proceso |
| 4625 | `FAILED_LOGON` | Logon fallido | Codigo SubStatus (ej: `0xC000006A` = contrasena incorrecta) |
| 4634 | `LOGOFF` | Logoff | |
| 4647 | `LOGOFF` | Logoff iniciado por usuario | |
| 4648 | `SUCCESSFUL_LOGON` | Logon con credenciales explicitas (runas) | Nombre del proceso |
| 4768 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de TGT Kerberos | Segun campo Status |
| 4769 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Solicitud de Service Ticket Kerberos | Segun campo Status |
| 4770 | `SUCCESSFUL_LOGON` | Renovacion de TGT Kerberos | |
| 4771 | `FAILED_LOGON` | Fallo de pre-autenticacion Kerberos | |
| 4776 | `SUCCESSFUL_LOGON` / `FAILED_LOGON` | Autenticacion NTLM | Segun campo Status |
| 4778 | `SUCCESSFUL_LOGON` | Sesion reconectada | |
| 4779 | `LOGOFF` | Sesion desconectada | |
| 5140 | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 5145 | `SUCCESSFUL_LOGON` | Comprobacion de objeto en share | ShareName\NombreFichero |

### Terminal Services (RDP)

| Event ID | Origen | event_type | Descripcion |
|---|---|---|---|
| 21 | LocalSessionManager | `SUCCESSFUL_LOGON` | Sesion RDP iniciada |
| 22 | LocalSessionManager | `SUCCESSFUL_LOGON` | Shell RDP listo |
| 24 | LocalSessionManager | `LOGOFF` | Sesion RDP desconectada |
| 25 | LocalSessionManager | `SUCCESSFUL_LOGON` | Sesion RDP reconectada |
| 1024 | RDPClient | `CONNECT` | Conexion RDP saliente |
| 1102 | RDPClient | `CONNECT` | Conexion RDP saliente |
| 1149 | RemoteConnectionManager | `SUCCESSFUL_LOGON` | Autenticacion RDP exitosa |
| 131 | RdpCoreTS | `CONNECT` | Transporte RDP aceptado |

### SMB

| Event ID | Origen | event_type | Descripcion | Columna detail |
|---|---|---|---|---|
| 1009 | SMBServer/Security | `SUCCESSFUL_LOGON` | Conexion SMB aceptada | |
| 551 | SMBServer/Security | `FAILED_LOGON` | Autenticacion SMB fallida | |
| 31001 | SMBClient/Security | `SUCCESSFUL_LOGON` | Acceso a share SMB | ShareName |
| 5140 | Security.evtx | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 5145 | Security.evtx | `SUCCESSFUL_LOGON` | Comprobacion de objeto en share | ShareName\NombreFichero |
| 30803-30808 | SMBClient/Connectivity | `CONNECT` | Eventos de conectividad SMB | |

### Linux

| Event ID | event_type | Descripcion | Columna detail |
|---|---|---|---|
| `SSH_SUCCESS` | `SUCCESSFUL_LOGON` | Autenticacion SSH exitosa | Metodo de auth (password/publickey) |
| `SSH_FAILED` | `FAILED_LOGON` | Autenticacion SSH fallida | Metodo de auth |
| `SSH_CONNECT` | `CONNECT` | Conexion SSH (xinetd) | |

### Cortex XDR

| Origen | event_type | Descripcion |
|---|---|---|
| Network (puertos 3389/445/22) | `CONNECT` | Datos de conexion a nivel de red |
| EVTX Forensics | Segun Event ID | Mismo mapeo que Security.evtx |

---

## La columna logon_id

El campo `logon_id` contiene el identificador de sesion extraido del campo `TargetLogonId` de los eventos de Security.evtx (4624, 4634, 4647, 4648). Esto permite correlacionar sesiones: vincular un evento de logon con su logoff correspondiente para determinar la duracion de la sesion.

Para eventos de Terminal Services se usa el `SessionId` cuando esta disponible. Para Linux, Cortex y SMB este campo esta vacio.

---

## La columna detail

La columna `detail` proporciona contexto adicional que varia segun el tipo de evento:

| Evento | Contenido en detail |
|---|---|
| 4624, 4648 | Nombre del proceso que inicio el logon |
| 4625 | Codigo hex SubStatus indicando el motivo del fallo |
| 5140 | ShareName (ej: `\\*\IPC$`, `\\*\C$`, `\\*\SYSVOL`) |
| 5145 | ShareName\NombreDelFichero |
| SMB 31001 | ShareName |
| Eventos SSH | Metodo de autenticacion (`password`, `publickey`) |
| Cortex Network | Linea de comandos del proceso que genero la conexion |
| Otros eventos | Vacio |

### Codigos SubStatus comunes del 4625

| SubStatus | Significado |
|---|---|
| `0xC000006A` | Contrasena incorrecta |
| `0xC0000064` | El usuario no existe |
| `0xC0000072` | Cuenta deshabilitada |
| `0xC0000234` | Cuenta bloqueada |
| `0xC0000070` | Logon fuera del horario permitido |
| `0xC000006D` | Nombre de usuario o informacion de autenticacion incorrectos |
| `0xC0000071` | Contrasena expirada |
| `0xC0000224` | La contrasena debe cambiarse en el proximo logon |

---

## Preservacion de datos

Masstin preserva los valores originales de la evidencia. Los nombres de nodos (hostnames, IPs) y propiedades se almacenan sin transformacion. Solo los tipos de relacion en bases de datos de grafos se normalizan (mayusculas, guiones bajos) por restricciones del lenguaje Cypher. Consulta los articulos de [Neo4j](/es/tools/neo4j-cypher-visualization/) y [Memgraph](/es/tools/memgraph-visualization/) para mas detalles.
