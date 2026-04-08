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

Un atacante ha comprometido tu red. Se ha movido lateralmente entre servidores Windows, maquinas Linux e infraestructura cloud. La evidencia esta dispersa: EVTX de 50 maquinas, logs de auth de una docena de servidores Linux, datos de red de tu EDR. Cada fuente tiene un formato diferente, timestamps diferentes, nombres de campos diferentes. Necesitas reconstruir el camino del atacante — cada salto, cada credencial utilizada, cada intento fallido — y lo necesitas **ya**.

Masstin resuelve esto parseando **todas** estas fuentes y fusionandolas en una **unica timeline cronologica** donde un logon RDP de Windows, un brute-force SSH de Linux y una conexion de red del EDR aparecen lado a lado, en el mismo formato, listos para analisis o visualizacion en grafos.

---

## Que es Masstin?

Una herramienta DFIR escrita en **Rust** que parsea artefactos forenses de Windows, Linux y plataformas EDR, y unifica los datos de movimiento lateral en una unica timeline. Un comando, multiples fuentes de evidencia, una vision coherente del ataque.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** AGPL-3.0
- **Plataformas:** Windows, Linux y macOS — sin dependencias, binario unico

---

## Caracteristicas clave

| Caracteristica | Descripcion | Detalles |
|----------------|-------------|----------|
| **Analisis multi-directorio** | Analiza docenas de maquinas a la vez con multiples flags `-d` — critico para investigaciones de ransomware donde necesitas la cadena completa de movimiento lateral | |
| **Timeline multiplataforma** | Windows EVTX + Linux SSH + datos EDR fusionados en un CSV con `merge` — un logon RDP, un brute-force SSH y una conexion de Cortex aparecen lado a lado | |
| **30+ Event IDs, 9 fuentes Windows** | Security.evtx, Terminal Services (4 logs), SMBServer, SMBClient (2 logs), RdpCoreTS — cubriendo RDP, SMB, Kerberos, NTLM y acceso a shares | [Artefactos →](/es/artifacts/security-evtx-lateral-movement/) |
| **Clasificacion de eventos** | Cada evento clasificado como `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` o `CONNECT` — filtra por tipo en vez de memorizar Event IDs | [Formato CSV →](/es/tools/masstin-csv-format/) |
| **Descompresion recursiva** | Extrae automaticamente paquetes ZIP/triage de forma recursiva, gestiona logs archivados con nombres duplicados, auto-detecta contrasenas forenses comunes | |
| **Linux: inferencia inteligente** | Auto-detecta hostname (`/etc/hostname`, cabecera syslog), infiere ano (`dpkg.log`, `wtmp`), soporta Debian (`auth.log`) y RHEL (`secure`), formatos RFC3164 y RFC5424 | [Artefactos Linux →](/es/artifacts/linux-forensic-artifacts/) |
| **Visualizacion en grafos** | Carga directa a [Neo4j](/es/tools/neo4j-cypher-visualization/) o [Memgraph](/es/tools/memgraph-visualization/) con agrupacion de conexiones (fecha mas temprana + recuento) y resolucion automatica IP-a-hostname | |
| **Reconstruccion de camino temporal** | Query Cypher para encontrar el camino cronologicamente coherente entre dos nodos — reconstruye la ruta exacta del atacante asegurando que cada salto ocurrio despues del anterior | [Neo4j →](/es/tools/neo4j-cypher-visualization/) |
| **Correlacion de sesiones** | Campo `logon_id` permite vincular eventos de logon/logoff para determinar la duracion de sesion | [Formato CSV →](/es/tools/masstin-csv-format/) |
| **Modo silencioso** | Flag `--silent` suprime toda la salida para integracion con Velociraptor, plataformas SOAR y pipelines de automatizacion | |
| **Reporte transparente** | La CLI muestra descubrimiento de artefactos, progreso de procesamiento, inferencias de hostname/ano y recuento de eventos por artefacto | |

```bash
# Analizar un incidente completo: multiples maquinas, una timeline
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -d /evidence/WS-ADMIN -o timeline.csv

# Multiplataforma: fusionar Windows + Linux en una sola vista
masstin -a merge -f windows.csv -f linux.csv -o full-timeline.csv
```

![Salida CLI de Masstin](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

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

## Inicio rapido

Descarga el ultimo binario desde la [pagina de Releases](https://github.com/jupyterj0nes/masstin/releases) — no necesita instalacion. O compila desde el codigo fuente:

```bash
git clone https://github.com/jupyterj0nes/masstin.git
cd masstin && cargo build --release
```

---

## Indice de documentacion

### Artefactos

| Artefacto | Articulo |
|-----------|----------|
| Security.evtx (30+ Event IDs) | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| Logs de Linux (auth.log, secure, utmp/wtmp) | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |
| Windows Prefetch | [Windows Prefetch](/es/artifacts/windows-prefetch-forensics/) |

### Formato de salida

| Tema | Articulo |
|------|----------|
| 14 columnas CSV, event_type, mapeo Event ID, logon_id, detail | [Formato CSV y Clasificacion de Eventos](/es/tools/masstin-csv-format/) |

### Bases de datos graficas

| Base de datos | Articulo |
|---------------|----------|
| Neo4j | [Neo4j y Cypher: visualizacion y queries](/es/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: visualizacion en memoria](/es/tools/memgraph-visualization/) |
