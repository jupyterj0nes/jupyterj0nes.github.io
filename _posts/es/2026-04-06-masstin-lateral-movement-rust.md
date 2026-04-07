---
layout: post
title: "Masstin: Analisis de movimiento lateral a la velocidad de Rust"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, evtx, herramientas]
description: "Masstin es una herramienta DFIR escrita en Rust que parsea mas de 10 tipos de artefactos forenses y genera timelines unificadas de movimiento lateral, con integracion directa en Neo4j."
comments: true
---

![Masstin Logo](/assets/images/masstin-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 600px;" }

## El problema

Estas en medio de una respuesta ante incidentes. Tienes 50 maquinas comprometidas, cada una con sus logs de eventos rotados, el SIEM solo reenvio una fraccion de los eventos, y necesitas reconstruir como se movio el atacante por la red. **Ahora.**

Las herramientas genericas te dan demasiado ruido. Revisar EVTX a mano es inviable. Necesitas algo que extraiga *solo* el movimiento lateral de todos esos artefactos, los unifique en una timeline y te permita visualizar las relaciones entre maquinas.

Para eso existe **masstin**.

## Que es Masstin?

Masstin es una herramienta DFIR escrita en **Rust** que parsea mas de 10 tipos de artefactos forenses y los fusiona en una **timeline cronologica unificada en CSV**, centrada exclusivamente en el movimiento lateral. Es la evolucion de [sabonis](/es/tools/sabonis-pivoting-lateral-movement/), reescrita desde cero para conseguir un rendimiento ~90% superior.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** GPLv3
- **Plataformas:** Windows y Linux (binarios precompilados, sin dependencias)

## Acciones disponibles

Masstin incluye 7 acciones para cubrir todo el flujo de trabajo forense:

| Accion | Descripcion |
|--------|-------------|
| `parse` | Parsea archivos EVTX de Windows y genera la timeline CSV de movimiento lateral |
| `load` | Sube un CSV previamente generado a una base de datos Neo4j para visualizacion en grafos |
| `merge` | Combina multiples CSVs en una sola timeline ordenada cronologicamente |
| `parser-elastic` | Parsea logs de Winlogbeat en formato JSON exportados desde Elasticsearch |
| `parse-cortex` | Consulta la API de Cortex XDR para obtener datos de conexiones de red |
| `parse-cortex-evtx-forensics` | Consulta los EVTX recopilados por agentes de recoleccion forense de Cortex XDR |
| `parse-linux` | Parsea logs de Linux (secure, messages, audit.log, utmp, wtmp, btmp, lastlog) |

## Artefactos soportados

### Windows Event Logs (EVTX)

| Event Log | Event IDs relevantes | Que detecta |
|-----------|---------------------|-------------|
| Security.evtx | 4624, 4625, 4634, 4647, 4648, 4768, 4769, 4770, 4771, 4776, 4778, 4779 | Logons, logoffs, Kerberos, NTLM, RDP reconnect |
| TerminalServices-LocalSessionManager | 21, 22, 24, 25 | Sesiones RDP entrantes/salientes |
| TerminalServices-RDPClient | 1024, 1102 | Conexiones RDP salientes |
| TerminalServices-RemoteConnectionManager | 1149 | Conexiones RDP entrantes aceptadas |
| RdpCoreTS | 131 | Negociacion de transporte RDP |
| SMBServer/Security | 1009, 551 | Conexiones y autenticacion SMB del servidor |
| SMBClient/Security | 31001 | Acceso a shares SMB del cliente |
| SMBClient/Connectivity | 30803-30808 | Eventos de conectividad SMB |
| System.evtx | 7045 | Instalacion de servicios remotos |
| WinRM | Conexiones WinRM | Ejecucion remota via PowerShell |
| PowerShell | Script blocks, modulos | Ejecucion remota de scripts |

### Linux

| Fuente | Que captura |
|--------|------------|
| `/var/log/secure`, `/var/log/messages` | SSH exito, fallo, intentos de conexion |
| `/var/log/audit/audit.log` | Eventos de autenticacion via subsistema de auditoria |
| `utmp` / `wtmp` | Sesiones de login activas e historicas |
| `btmp` | Intentos de login fallidos |
| `lastlog` | Ultimo login por usuario |

### Otras fuentes

| Fuente | Que captura |
|--------|------------|
| Winlogbeat JSON | Los 28 Event IDs de Windows en formato JSON |
| Cortex XDR (red) | Conexiones de red a puertos RDP (3389), SMB (445), SSH (22) |
| Cortex XDR (EVTX Forensics) | Logs EVTX recopilados por agentes forenses de Cortex |

### Tabla de artefactos soportados

| Artefacto | Accion masstin | Articulo |
|-----------|----------------|----------|
| Security.evtx | `parse` | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | `parse` | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | `parse` | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| Logs de Linux | `parse-linux` | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | `parser-elastic` | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | `parse-cortex` / `parse-cortex-evtx-forensics` | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |

## Soporte de triage comprimido

Masstin puede procesar directamente paquetes de triage comprimidos generados por herramientas como **Velociraptor** o **Cortex XDR Offline Collector**. Descomprime recursivamente los paquetes e identifica todos los archivos EVTX en su interior, incluso cuando hay logs archivados con nombres de archivo duplicados.

Esto significa que no necesitas descomprimir manualmente los paquetes de triage antes de analizarlos -- simplemente apunta masstin al archivo comprimido y el se encarga del resto.

```bash
masstin -a parse-windows -d /evidence/triage_packages/ -o timeline.csv
```

## Uso

### Parseo de EVTX: generar la timeline CSV

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

### Parseo de Winlogbeat JSON

```bash
masstin -a parser-elastic -d /evidence/winlogbeat/ -o elastic-timeline.csv
```

### Parseo de Cortex XDR

```bash
# Conexiones de red
masstin -a parse-cortex --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-network.csv

# EVTX recopilados por agentes forenses
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-evtx.csv
```

### Parseo de logs de Linux

```bash
masstin -a parse-linux -d /evidence/var/log/ -o linux-timeline.csv
```

### Merge: combinar multiples timelines

```bash
masstin -a merge -f timeline1.csv -f timeline2.csv -o merged.csv
```

### Carga en Neo4j: visualizacion en grafos

```bash
masstin -a load -f timeline.csv --database localhost:7687 --user neo4j
```

### Formato del CSV de salida

Cada fila del CSV contiene:

| Campo | Descripcion |
|-------|-------------|
| `time_created` | Marca temporal del evento (UTC) |
| `dst_computer` | Maquina de destino |
| `event_id` | ID del evento de Windows o equivalente |
| `subject_user_name` | Cuenta de usuario origen |
| `subject_domain_name` | Dominio origen |
| `target_user_name` | Cuenta de usuario destino |
| `target_domain_name` | Dominio destino |
| `logon_type` | Tipo de logon (3=red/SMB, 10=RDP, SSH) |
| `src_computer` | Maquina de origen |
| `src_ip` | IP de origen |
| `log_filename` | Archivo de log de origen |

## Caracteristicas clave

### Resolucion automatica IP -> Hostname

Masstin analiza la frecuencia de asociaciones IP-hostname en los propios logs para resolver automaticamente las IPs a nombres de maquina, sin necesidad de un DNS externo.

### Agrupacion de conexiones

Para reducir el ruido en investigaciones con miles de eventos, masstin agrupa conexiones repetitivas entre las mismas maquinas, permitiendote ver los patrones sin ahogarte en datos.

### Consultas Cypher pre-construidas

El repositorio incluye consultas Cypher listas para usar en Neo4j que permiten:

- Visualizar el grafo completo de movimiento lateral
- Identificar maquinas con mas conexiones entrantes (posibles objetivos)
- Detectar patrones de movimiento anomalos
- Rastrear la progresion de un usuario/atacante concreto

## Por que Rust?

| Aspecto | Python (sabonis) | Rust (masstin) |
|---------|------------------|----------------|
| Rendimiento | Base | ~90% mas rapido |
| Dependencias | Python + libs | Ninguna (binario estatico) |
| Despliegue | Instalar Python + pip | Copiar binario |
| Artefactos | 7+ tipos | 10+ tipos |
| Neo4j | Exporta CSV manual | Subida directa |
| Resolucion IP | Manual | Automatica |

En investigaciones con decenas de maquinas y GBs de logs, la diferencia de rendimiento no es un lujo -- es una necesidad.

## Roadmap

- **Reconstruccion de eventos** -- Reconstruir eventos de movimiento lateral incluso cuando los logs EVTX han sido borrados o manipulados en el sistema.

## Articulos relacionados

- [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/)
- [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/)
- [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/)
- [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/)
- [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/)
- [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/)
- [Neo4j y Cypher: visualización de movimiento lateral](/es/tools/neo4j-cypher-visualization/)
- [Memgraph: visualización en memoria](/es/tools/memgraph-visualization/)
