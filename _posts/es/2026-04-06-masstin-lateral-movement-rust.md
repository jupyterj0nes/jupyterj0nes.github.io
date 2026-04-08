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

Un atacante ha comprometido tu red. Se ha movido lateralmente entre servidores Windows, maquinas Linux e infraestructura cloud. La evidencia esta dispersa: EVTX de 50 maquinas, logs de auth de una docena de servidores Linux, datos de red de tu EDR. Necesitas reconstruir el camino del atacante — cada salto, cada credencial, cada intento fallido — y lo necesitas **ya**.

Masstin parsea **todas** estas fuentes y las fusiona en una **unica timeline cronologica** donde un logon RDP de Windows, un brute-force SSH de Linux y una conexion de red del EDR aparecen lado a lado, en el mismo formato, listos para analisis o visualizacion en grafos.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** AGPL-3.0
- **Plataformas:** Windows, Linux y macOS — sin dependencias, binario unico

---

## Caracteristicas clave

| Caracteristica | Descripcion | Articulo |
|----------------|-------------|----------|
| Analisis multi-directorio | Analiza docenas de maquinas a la vez con multiples flags `-d`, critico para investigaciones de ransomware | [Parsear evidencia](#parsear-evidencia) |
| Timeline multiplataforma | Windows EVTX + Linux SSH + datos EDR fusionados en un CSV con `merge` | [Windows](/es/artifacts/security-evtx-lateral-movement/) / [Linux](/es/artifacts/linux-forensic-artifacts/) / [Cortex](/es/artifacts/cortex-xdr-artifacts/) |
| 30+ Event IDs de 9 fuentes Windows | Security.evtx, Terminal Services, SMBServer, SMBClient, RdpCoreTS — cubriendo RDP, SMB, Kerberos, NTLM y acceso a shares | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) / [RDP](/es/artifacts/terminal-services-evtx/) / [SMB](/es/artifacts/smb-evtx-events/) |
| Clasificacion de eventos | Cada evento clasificado como `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` o `CONNECT` | [Formato CSV — event_type](/es/tools/masstin-csv-format/) |
| Descompresion recursiva | Extrae automaticamente paquetes ZIP/triage de forma recursiva, gestiona logs archivados con nombres duplicados, detecta contrasenas forenses comunes | [Artefactos Linux — soporte triage](/es/artifacts/linux-forensic-artifacts/) |
| Linux: inferencia inteligente | Auto-detecta hostname, infiere ano desde `dpkg.log`, soporta Debian (`auth.log`) y RHEL (`secure`), formatos RFC3164 y RFC5424 | [Artefactos Linux — inferencia](/es/artifacts/linux-forensic-artifacts/) |
| Visualizacion en grafos con reduccion de ruido | Carga directa a Neo4j o Memgraph con agrupacion de conexiones (fecha mas temprana + recuento) y resolucion automatica IP-a-hostname | [Neo4j](/es/tools/neo4j-cypher-visualization/) / [Memgraph](/es/tools/memgraph-visualization/) |
| Reconstruccion de camino temporal | Query Cypher para encontrar la ruta cronologicamente coherente del atacante entre dos nodos | [Neo4j — camino temporal](/es/tools/neo4j-cypher-visualization/) / [Memgraph — camino temporal](/es/tools/memgraph-visualization/) |
| Correlacion de sesiones | Campo `logon_id` permite vincular eventos de logon/logoff para determinar duracion de sesion | [Formato CSV — logon_id](/es/tools/masstin-csv-format/) |
| Modo silencioso | Flag `--silent` suprime toda la salida para integracion con Velociraptor, plataformas SOAR y pipelines de automatizacion | [Tabla de acciones](#acciones-disponibles) |
| Analisis de imagenes forenses | Abre imagenes E01/dd directamente, encuentra particiones NTFS (GPT/MBR), extrae EVTX — sin necesidad de montar | [Recuperacion VSS](/es/tools/masstin-vss-recovery/) |
| Recuperacion de snapshots VSS | Detecta y extrae EVTX de Volume Shadow Copies — recupera logs borrados por atacantes | [Recuperacion VSS](/es/tools/masstin-vss-recovery/) |
| Reporte transparente | La CLI muestra descubrimiento de artefactos, progreso de procesamiento, inferencias de hostname/ano y recuento de eventos por artefacto | [Parsear evidencia](#parsear-evidencia) |

---

## Inicio rapido

Descarga el ultimo binario desde la [pagina de Releases](https://github.com/jupyterj0nes/masstin/releases) — no necesita instalacion. O compila desde el codigo fuente:

```bash
git clone https://github.com/jupyterj0nes/masstin.git
cd masstin && cargo build --release
```

### Parsear evidencia

```bash
# Analizar un incidente completo: multiples maquinas, una timeline
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -d /evidence/WS-ADMIN -o timeline.csv

# Parsear logs de Linux (extrae ZIPs automaticamente, detecta contrasenas)
masstin -a parse-linux -d /evidence/linux-triage/ -o linux.csv

# Fusionar Windows + Linux en una unica vista multiplataforma
masstin -a merge -f timeline.csv -f linux.csv -o full-timeline.csv
```

![Salida CLI de Masstin](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

### Visualizar en base de datos de grafos

```bash
# Cargar en Memgraph (sin autenticacion)
masstin -a load-memgraph -f full-timeline.csv --database localhost:7687

# Cargar en Neo4j
masstin -a load-neo4j -f full-timeline.csv --database localhost:7687 --user neo4j
```

![Grafo de movimiento lateral en Memgraph Lab](/assets/images/memgraph_output1.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

### Reconstruir el camino del atacante

La query de camino temporal encuentra la ruta cronologicamente coherente entre dos nodos:

```cypher
MATCH path = (start:host {name:'10.10.1.50'})-[*]->(end:host {name:'SRV-BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path ORDER BY length(path) LIMIT 5
```

![Camino temporal en Memgraph](/assets/images/memgraph_temporal_path.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

---

## Acciones disponibles

| Accion | Descripcion |
|--------|-------------|
| `parse-windows` | Parsea EVTX de Windows desde directorios o ficheros (soporta triage comprimido) |
| `parse-linux` | Parsea logs de Linux: auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog |
| `parser-elastic` | Parsea logs de Winlogbeat en JSON exportados desde Elasticsearch |
| `parse-cortex` | Consulta la API de Cortex XDR para conexiones de red (RDP/SMB/SSH) |
| `parse-cortex-evtx-forensics` | Consulta la API de Cortex XDR para colecciones EVTX forenses de multiples maquinas |
| `merge` | Combina multiples CSVs en una unica timeline cronologica |
| `load-neo4j` | Sube la timeline a Neo4j para visualizacion en grafos |
| `load-memgraph` | Sube la timeline a Memgraph para visualizacion en grafos en memoria |

---

## Documentacion

### Artefactos

| Artefacto | Articulo |
|-----------|----------|
| Security.evtx (30+ Event IDs) | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| Logs de Linux | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |

### Formato de salida y funcionalidades avanzadas

| Tema | Articulo |
|------|----------|
| Columnas CSV, event_type, mapeo Event ID, logon_id, detail | [Formato CSV y Clasificacion de Eventos](/es/tools/masstin-csv-format/) |
| Analisis de imagenes forenses y recuperacion VSS | [Recuperando logs borrados desde VSS](/es/tools/masstin-vss-recovery/) |
| vshadow-rs — parser VSS en Rust puro | [vshadow-rs](/es/tools/vshadow-rs/) |

### Bases de datos graficas

| Base de datos | Articulo |
|---------------|----------|
| Neo4j | [Neo4j y Cypher: visualizacion y queries](/es/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: visualizacion en memoria](/es/tools/memgraph-visualization/) |
