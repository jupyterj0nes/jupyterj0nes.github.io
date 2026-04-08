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

---

## Caracteristicas clave

| Caracteristica | Descripcion |
|----------------|-------------|
| **Parseo multi-artefacto** | 30+ Event IDs de Windows + logs Linux + Winlogbeat JSON + Cortex XDR |
| **Timeline unificada** | Todas las fuentes fusionadas en un CSV cronologico con [14 columnas estandarizadas](/es/tools/masstin-csv-format/) |
| **Clasificacion de eventos** | Cada evento clasificado como `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` o `CONNECT` — [mapeo completo](/es/tools/masstin-csv-format/) |
| **Soporte de triage comprimido** | Procesa paquetes ZIP de Velociraptor o Cortex XDR, incluyendo archivos protegidos con contrasena |
| **Bases de datos de grafos** | Carga directa a [Neo4j](/es/tools/neo4j-cypher-visualization/) o [Memgraph](/es/tools/memgraph-visualization/) con queries Cypher |
| **Resolucion IP-hostname** | Resolucion automatica basada en frecuencia a partir de los propios logs |
| **Agrupacion de conexiones** | Reduce ruido agrupando conexiones repetitivas |
| **Correlacion de sesiones** | Campo `logon_id` para vincular logon/logoff — [detalles](/es/tools/masstin-csv-format/) |
| **Modo silencioso** | Flag `--silent` para integracion con Velociraptor y automatizacion |
| **Multiplataforma** | Windows, Linux y macOS — sin dependencias |

---

## Acciones disponibles

| Accion | Descripcion |
|--------|-------------|
| `parse-windows` | Parsea archivos EVTX de Windows y genera la timeline de movimiento lateral |
| `parse-linux` | Parsea logs de Linux (auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog) |
| `parser-elastic` | Parsea logs de Winlogbeat en formato JSON exportados desde Elasticsearch |
| `parse-cortex` | Consulta APIs de EDR para obtener datos de conexiones de red |
| `parse-cortex-evtx-forensics` | Consulta los EVTX recopilados por agentes de recoleccion forense de EDR |
| `merge` | Combina multiples CSVs en una sola timeline ordenada cronologicamente |
| `load-neo4j` | Sube un CSV a una base de datos Neo4j para visualizacion en grafos |
| `load-memgraph` | Sube un CSV a una base de datos Memgraph para visualizacion en grafos |

---

## Inicio rapido

Descarga el ultimo binario desde la [pagina de Releases](https://github.com/jupyterj0nes/masstin/releases) — no necesita instalacion.

```bash
# Parsear EVTX de Windows desde un directorio
masstin -a parse-windows -d /evidence/logs/ -o timeline.csv

# Parsear logs de Linux (soporta ZIP con deteccion automatica de contrasena)
masstin -a parse-linux -d /evidence/triage/ -o linux-timeline.csv

# Cargar en Memgraph para visualizacion
masstin -a load-memgraph -f timeline.csv --database localhost:7687
```

![Salida CLI de Masstin](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

---

## Documentacion

### Artefactos

Documentacion detallada de cada artefacto que masstin parsea:

| Artefacto | Accion masstin | Articulo |
|-----------|----------------|----------|
| Security.evtx (30+ Event IDs) | `parse-windows` | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | `parse-windows` | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | `parse-windows` | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| Windows Prefetch | -- | [Windows Prefetch](/es/artifacts/windows-prefetch-forensics/) |
| Logs de Linux (auth.log, secure, utmp/wtmp) | `parse-linux` | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | `parser-elastic` | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | `parse-cortex` / `parse-cortex-evtx-forensics` | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |

### Formato de salida

| Tema | Articulo |
|------|----------|
| Columnas CSV, clasificacion event_type, mapeo de Event IDs | [Formato CSV y Clasificacion de Eventos](/es/tools/masstin-csv-format/) |

### Bases de datos graficas

| Base de datos | Accion masstin | Articulo |
|---------------|----------------|----------|
| Neo4j | `load-neo4j` | [Neo4j y Cypher: visualizacion de movimiento lateral](/es/tools/neo4j-cypher-visualization/) |
| Memgraph | `load-memgraph` | [Memgraph: visualizacion en memoria](/es/tools/memgraph-visualization/) |

---

## Por que Rust?

| Aspecto | Python (sabonis) | Rust (masstin) |
|---------|------------------|----------------|
| Rendimiento | Referencia | ~90% mas rapido |
| Dependencias | Python + librerias | Ninguna (binario estatico) |
| Despliegue | Instalar Python + pip | Copiar binario |
| Artefactos | 7+ tipos | 10+ tipos |
| Bases de datos graficas | Exporta CSV manual | Subida directa a Neo4j y Memgraph |
| Resolucion IP | Manual | Automatica |

---

## Roadmap

- Reconstruccion de eventos incluso cuando los EVTX han sido eliminados o manipulados
- Parseo de logs de VPN
- Parser generico para formatos de log personalizados
