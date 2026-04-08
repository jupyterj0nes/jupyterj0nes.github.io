---
layout: post
title: "Masstin: Analisis de movimiento lateral a la velocidad de Rust"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, memgraph, evtx, herramientas]
description: "Masstin es una herramienta DFIR escrita en Rust que parsea artefactos forenses y genera timelines unificadas de movimiento lateral, con visualizacion en bases de datos graficas."
comments: true
---

![Masstin Logo](/assets/images/masstin-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 600px;" }

## El problema

Estas en medio de una respuesta ante incidentes. Tienes 50 maquinas comprometidas, cada una con sus logs de eventos rotados, el SIEM solo reenvio una fraccion de los eventos, y necesitas reconstruir como se movio el atacante por la red. **Ahora.**

Las herramientas genericas te dan demasiado ruido. Revisar EVTX a mano es inviable. Necesitas algo que extraiga *solo* el movimiento lateral de todos esos artefactos, los unifique en una timeline y te permita visualizar las relaciones entre maquinas.

Para eso existe **masstin**.

## Que es Masstin?

Masstin es una herramienta DFIR escrita en **Rust** que parsea artefactos forenses y los fusiona en una **timeline cronologica unificada en CSV**, centrada exclusivamente en el movimiento lateral. Es la evolucion de [sabonis](/es/tools/sabonis-pivoting-lateral-movement/), reescrita desde cero para conseguir un rendimiento ~90% superior.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** AGPL-3.0
- **Plataformas:** Windows, Linux y macOS (binarios precompilados, sin dependencias)

## Acciones disponibles

| Accion | Descripcion |
|--------|-------------|
| `parse-windows` | Parsea archivos EVTX de Windows y genera la timeline CSV de movimiento lateral |
| `parse-linux` | Parsea logs de Linux (secure, messages, audit.log, utmp, wtmp, btmp, lastlog) |
| `parser-elastic` | Parsea logs de Winlogbeat en formato JSON exportados desde Elasticsearch |
| `parse-cortex` | Consulta APIs de EDR para obtener datos de conexiones de red |
| `parse-cortex-evtx-forensics` | Consulta los EVTX recopilados por agentes de recoleccion forense de EDR |
| `merge` | Combina multiples CSVs en una sola timeline ordenada cronologicamente |
| `load-neo4j` | Sube un CSV a una base de datos Neo4j para visualizacion en grafos |
| `load-memgraph` | Sube un CSV a una base de datos Memgraph para visualizacion en grafos |

## Indice de documentacion

### Artefactos

| Artefacto | Accion masstin | Articulo |
|-----------|----------------|----------|
| Security.evtx | `parse-windows` | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | `parse-windows` | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | `parse-windows` | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| Windows Prefetch | — | [Windows Prefetch](/es/artifacts/windows-prefetch-forensics/) |
| Logs de Linux | `parse-linux` | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | `parser-elastic` | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | `parse-cortex` / `parse-cortex-evtx-forensics` | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |

### Bases de datos graficas

| Base de datos | Accion masstin | Articulo |
|---------------|----------------|----------|
| Neo4j | `load-neo4j` | [Neo4j y Cypher: visualizacion de movimiento lateral](/es/tools/neo4j-cypher-visualization/) |
| Memgraph | `load-memgraph` | [Memgraph: visualizacion en memoria](/es/tools/memgraph-visualization/) |

## Artefactos soportados

### Windows Event Logs (EVTX)

| Event Log | Event IDs | Que detecta |
|-----------|-----------|-------------|
| Security.evtx | 4624, 4625, 4634, 4647, 4648, 4768, 4769, 4770, 4771, 4776, 4778, 4779 | Logons, logoffs, Kerberos, NTLM, RDP reconnect |
| TerminalServices-LocalSessionManager | 21, 22, 24, 25 | Sesiones RDP entrantes/salientes |
| TerminalServices-RDPClient | 1024, 1102 | Conexiones RDP salientes |
| TerminalServices-RemoteConnectionManager | 1149 | Conexiones RDP entrantes aceptadas |
| RdpCoreTS | 131 | Negociacion de transporte RDP |
| SMBServer/Security | 1009, 551 | Conexiones y autenticacion SMB del servidor |
| SMBClient/Security | 31001 | Acceso a shares SMB del cliente |
| SMBClient/Connectivity | 30803-30808 | Eventos de conectividad SMB |

### Linux

| Fuente | Que captura |
|--------|------------|
| `/var/log/auth.log` (Debian/Ubuntu), `/var/log/secure` (RHEL/CentOS) | SSH exito, fallo, autenticacion PAM |
| `/var/log/messages` | Eventos SSH via syslog |
| `/var/log/audit/audit.log` | Eventos de autenticacion via subsistema de auditoria |
| `utmp` / `wtmp` | Sesiones de login activas e historicas |
| `btmp` | Intentos de login fallidos |
| `lastlog` | Ultimo login por usuario |

### Otras fuentes

| Fuente | Que captura |
|--------|------------|
| Winlogbeat JSON | Los 28 Event IDs de Windows en formato JSON |
| EDR (red) | Conexiones de red a puertos RDP (3389), SMB (445), SSH (22) |
| EDR (EVTX Forensics) | Logs EVTX recopilados por agentes forenses |

## Soporte de triage comprimido

Masstin puede procesar directamente paquetes de triage comprimidos generados por herramientas como **Velociraptor** o colectores offline de EDR. Descomprime recursivamente los paquetes e identifica todos los archivos EVTX en su interior, incluso cuando hay logs archivados con nombres de archivo duplicados.

```bash
masstin -a parse-windows -d /evidence/triage_packages/ -o timeline.csv
```

## Uso

### Parseo de Windows EVTX

```bash
# Parsear un directorio con artefactos de multiples maquinas
masstin -a parse-windows -d /evidence/machine1/logs -d /evidence/machine2/logs -o timeline.csv

# Parsear archivos EVTX individuales
masstin -a parse-windows -f Security.evtx -f System.evtx -o timeline.csv

# Filtrar por rango temporal
masstin -a parse-windows -d /evidence/ -o timeline.csv \
  --start-time "2024-08-12 00:00:00" \
  --end-time "2024-08-14 00:00:00"

# Sobrescribir output existente
masstin -a parse-windows -d /evidence/ -o timeline.csv --overwrite
```

![Salida CLI de Masstin](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

La salida muestra tres fases: **[1/3]** escanea directorios y paquetes comprimidos para descubrir artefactos EVTX, **[2/3]** procesa cada artefacto mostrando el progreso y lista cada fuente que produjo eventos con su recuento, y **[3/3]** genera la timeline CSV ordenada. El resumen final muestra cuantos artefactos se parsearon, cuantos se omitieron (sin eventos relevantes o acceso denegado), total de eventos recopilados y tiempo de ejecucion. Usa `--silent` para suprimir toda la salida en automatizaciones.

### Parseo de logs de Linux

```bash
masstin -a parse-linux -d /evidence/var/log/ -o linux-timeline.csv
```

### Parseo de Winlogbeat JSON

```bash
masstin -a parser-elastic -d /evidence/winlogbeat/ -o elastic-timeline.csv
```

### Parseo de EDR

```bash
# Conexiones de red
masstin -a parse-cortex --cortex-url api-xxxx.xdr.example.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o edr-network.csv

# EVTX recopilados por agentes forenses
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.example.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o edr-evtx.csv
```

### Merge: combinar multiples timelines

```bash
masstin -a merge -f timeline1.csv -f timeline2.csv -o merged.csv
```

### Carga en base de datos grafica

```bash
# Neo4j
masstin -a load-neo4j -f timeline.csv --database localhost:7687 --user neo4j

# Memgraph
masstin -a load-memgraph -f timeline.csv --database localhost:7687
```

### Formato del CSV de salida

Todas las acciones producen un CSV unificado con 14 columnas:

| Columna | Descripcion |
|---------|-------------|
| `time_created` | Marca temporal del evento |
| `dst_computer` | Maquina destino (la que recibe la conexion) |
| `event_type` | Clasificacion del evento (ver tabla abajo) |
| `event_id` | ID original del evento (ej: `4624`, `SSH_SUCCESS`) |
| `logon_type` | Tipo de logon de Windows tal como lo reporta el evento (ej: `2`, `3`, `7`, `10`, `11`) |
| `target_user_name` | Cuenta de usuario objetivo de la accion |
| `target_domain_name` | Dominio del usuario objetivo |
| `src_computer` | Maquina origen (la que inicio la conexion) |
| `src_ip` | IP de origen |
| `subject_user_name` | Cuenta de usuario que inicio la accion |
| `subject_domain_name` | Dominio del usuario que inicio la accion |
| `logon_id` | ID de sesion para correlacion (ej: `0x1A2B3C`) |
| `detail` | Contexto adicional segun el tipo de evento |
| `log_filename` | Fichero de artefacto de origen |

### Clasificacion de event_type

Masstin clasifica cada evento en una de cuatro categorias:

| event_type | Significado | Cuando |
|---|---|---|
| `SUCCESSFUL_LOGON` | Autenticacion exitosa | El usuario se autentico correctamente y se establecio sesion |
| `FAILED_LOGON` | Autenticacion fallida | Credenciales incorrectas, cuenta bloqueada o fallo de pre-autenticacion |
| `LOGOFF` | Sesion finalizada | El usuario cerro sesion o la sesion fue desconectada |
| `CONNECT` | Evento de conexion | Conexion de red sin resultado de autenticacion |

### Mapeo de Event ID a event_type

#### Security.evtx

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

#### Terminal Services (RDP)

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

#### SMB

| Event ID | Origen | event_type | Descripcion | Columna detail |
|---|---|---|---|---|
| 1009 | SMBServer/Security | `SUCCESSFUL_LOGON` | Conexion SMB aceptada | |
| 551 | SMBServer/Security | `FAILED_LOGON` | Autenticacion SMB fallida | |
| 31001 | SMBClient/Security | `SUCCESSFUL_LOGON` | Acceso a share SMB | ShareName |
| 5140 | Security.evtx | `SUCCESSFUL_LOGON` | Acceso a recurso compartido | ShareName (ej: `\\*\IPC$`) |
| 5145 | Security.evtx | `SUCCESSFUL_LOGON` | Comprobacion de objeto en share | ShareName\NombreFichero |
| 30803-30808 | SMBClient/Connectivity | `CONNECT` | Eventos de conectividad SMB | |

#### Linux

| Event ID | event_type | Descripcion | Columna detail |
|---|---|---|---|
| `SSH_SUCCESS` | `SUCCESSFUL_LOGON` | Autenticacion SSH exitosa | Metodo de auth (password/publickey) |
| `SSH_FAILED` | `FAILED_LOGON` | Autenticacion SSH fallida | Metodo de auth |
| `SSH_CONNECT` | `CONNECT` | Conexion SSH (xinetd) | |

#### Cortex XDR

| Origen | event_type | Descripcion |
|---|---|---|
| Network (puertos 3389/445/22) | `CONNECT` | Datos de conexion a nivel de red |
| EVTX Forensics | Segun Event ID | Mismo mapeo que Security.evtx |

### La columna logon_id

El campo `logon_id` contiene el identificador de sesion extraido del campo `TargetLogonId` de los eventos de Security.evtx. Esto permite correlacionar sesiones: vincular un 4624 (logon) con su 4634 (logoff) correspondiente para determinar la duracion de la sesion.

### La columna detail

La columna `detail` proporciona contexto adicional que varia segun el tipo de evento:

| Evento | Contenido en detail |
|---|---|
| 4624, 4648 | Nombre del proceso que inicio el logon |
| 4625 | Codigo hex SubStatus indicando el motivo del fallo |
| Eventos SSH | Metodo de autenticacion (`password`, `publickey`) |
| Cortex Network | Linea de comandos del proceso que genero la conexion |
| Otros eventos | Vacio |

## Caracteristicas clave

### Resolucion automatica IP -> Hostname

Masstin analiza la frecuencia de asociaciones IP-hostname en los propios logs para resolver automaticamente las IPs a nombres de maquina, sin necesidad de un DNS externo.

### Agrupacion de conexiones

Para reducir el ruido en investigaciones con miles de eventos, masstin agrupa conexiones repetitivas entre las mismas maquinas, permitiendote ver los patrones sin ahogarte en datos.

### Consultas Cypher pre-construidas

El repositorio incluye consultas Cypher listas para usar en bases de datos graficas que permiten:

- Visualizar el grafo completo de movimiento lateral
- Identificar maquinas con mas conexiones entrantes (posibles objetivos)
- Detectar patrones de movimiento anomalos
- Rastrear la progresion de un usuario/atacante concreto
- Reconstruir el camino temporal del ataque entre dos hosts

## Por que Rust?

| Aspecto | Python (sabonis) | Rust (masstin) |
|---------|------------------|----------------|
| Rendimiento | Base | ~90% mas rapido |
| Dependencias | Python + libs | Ninguna (binario estatico) |
| Despliegue | Instalar Python + pip | Copiar binario |
| Artefactos | 7+ tipos | 10+ tipos |
| Bases de datos graficas | Exporta CSV manual | Subida directa a Neo4j y Memgraph |
| Resolucion IP | Manual | Automatica |

## Roadmap

- Reconstruccion de eventos incluso cuando los logs EVTX han sido borrados o manipulados
- Parseo de logs de VPN
- Parser generico para formatos de log personalizados
