---
layout: post
title: "Sabonis: El pívot que conecta los puntos del movimiento lateral"
date: 2026-04-06 08:00:00 +0100
category: tools
lang: es
ref: tool-sabonis
tags: [sabonis, lateral-movement, evtx, pcap, squid, neo4j, herramientas]
description: "Sabonis es una herramienta DFIR en Python que parsea EVTX, PCAP y logs de proxy Squid para extraer, fusionar y visualizar movimiento lateral en Neo4j."
comments: true
---

## ¿Por qué "Sabonis"?

Arvydas Sabonis fue uno de los mejores pívots de la historia del baloncesto. Su capacidad para leer el juego, conectar a sus compañeros y encontrar el pase imposible lo hacía único. Esta herramienta hace exactamente eso: **pivota sobre los datos forenses** para encontrar las conexiones de movimiento lateral que otros análisis no ven.

## ¿Qué es Sabonis?

Sabonis es una herramienta DFIR escrita en **Python** que proporciona una forma rápida de parsear archivos EVTX, PCAP y logs de proxy Squid, extrayendo exclusivamente la información relacionada con **movimiento lateral**.

- **Repositorio:** [github.com/jupyterj0nes/sabonis](https://github.com/jupyterj0nes/sabonis)
- **Licencia:** GPLv3
- **Lenguaje:** Python

> **Nota:** Sabonis ha sido sucedido por [masstin](/es/tools/masstin-lateral-movement-rust/), su reescritura en Rust con ~90% más de rendimiento y más artefactos soportados. Si empiezas un proyecto nuevo, recomendamos masstin. Sabonis sigue siendo relevante para entender la lógica subyacente y para entornos donde Python es más conveniente.

## Fuentes de datos soportadas

A diferencia de masstin que se centra en EVTX, sabonis tiene un enfoque más amplio:

### Windows Event Logs (.evtx)

Extrae y fusiona movimiento lateral de **más de 7 tipos de archivos EVTX**:

- **Security.evtx** — Logons (4624), logons fallidos (4625), logons explícitos (4648)
- **TerminalServices** — Sesiones RDP
- **SMBServer/SMBClient** — Acceso a recursos compartidos
- **System.evtx** — Servicios instalados remotamente
- **WinRM** — Ejecución remota
- **PowerShell** — Script blocks remotos

### Capturas de red (PCAP)

Extrae todos los movimientos laterales de archivos PCAP, identificando conexiones entre máquinas por protocolo.

### Logs de proxy Squid

Parsea eventos de proxy Squid para correlacionar la actividad de red con los artefactos de host.

## Flujo de trabajo

### 1. Pre-procesamiento

Los archivos EVTX deben convertirse primero usando `pivotfoot.sh`:

```bash
./pivotfoot.sh /evidence/evtx/
```

### 2. Parseo y generación de CSV

```bash
# Parsear EVTX
python sabonis.py parse evtx --directory /evidence/evtx/ -o lateral_movement.csv

# Parsear PCAP
python sabonis.py parse pcap -f capture.pcap -o network_lateral.csv

# Parsear Squid
python sabonis.py parse squid -f access.log -o proxy_lateral.csv

# Opciones útiles
python sabonis.py parse evtx --directory /evidence/ -o output.csv \
  --ignore_local \
  --exclusionlist exclusions.txt \
  --timezone "Europe/Madrid"
```

### 3. Carga en Neo4j

```bash
python sabonis.py load2neo -f lateral_movement.csv --database localhost:7687 --user neo4j
```

## Opciones destacadas

| Opción | Descripción |
|--------|-------------|
| `--ignore_local` | Filtra conexiones locales, mostrando solo conexiones remotas |
| `--exclusionlist` | Lista de IPs/hosts a excluir del análisis |
| `--focuslist` | Lista de IPs/hosts en los que centrarse exclusivamente |
| `--timezone` | Estandariza timestamps entre diferentes zonas horarias |

## La ventaja de Neo4j

Cuando tienes 20 máquinas, cada una con miles de eventos de logon, las tablas CSV se vuelven inmanejables. En Neo4j:

- Cada **máquina** es un nodo
- Cada **conexión lateral** es una relación
- Puedes hacer consultas como: *"¿Qué máquinas tocó el usuario ADMIN en las últimas 24 horas?"*

El repositorio incluye un **Cypher Playbook** con consultas pre-construidas para los escenarios de investigación más comunes.

## Próximos posts

- Instalación y configuración del entorno
- Análisis práctico de EVTX con sabonis
- Parseo de PCAPs para movimiento lateral
- Configuración de Neo4j + Cypher Playbook
- Comparativa detallada sabonis vs masstin
