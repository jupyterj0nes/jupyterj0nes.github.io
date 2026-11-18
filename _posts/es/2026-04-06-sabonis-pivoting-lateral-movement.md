---
layout: post
title: "Sabonis: El pívot que conecta los puntos del movimiento lateral"
date: 2026-04-06 08:00:00 +0100
category: tools
section: legacy
order: 10
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

> **Nota:** Sabonis ha sido sucedido por [masstin](/es/tools/masstin-lateral-movement-rust/), su reescritura en Rust, más rápida y con muchos más artefactos soportados. Si empiezas un proyecto nuevo, recomendamos masstin. Sabonis sigue siendo relevante para entender la lógica subyacente y para entornos donde Python es más conveniente.

## Fuentes de datos soportadas

Sabonis combinaba tres fuentes que entonces no leía ninguna otra herramienta nuestra (masstin las cubre hoy todas):

### Windows Event Logs (.evtx)

Extrae y fusiona movimiento lateral de **varios tipos de archivos EVTX**:

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

Sabonis no tiene instalador: se clona el repositorio y se ejecuta con Python. Necesita las librerías que importa, entre ellas `pandas`, `py2neo` y `scapy`.

### 1. Pre-procesamiento

Sabonis no lee los EVTX directamente. Primero hay que convertirlos a XML con `pivotfoot.sh`. Es un script de bash, así que en Windows necesitas WSL o Git Bash. Usa `evtx_dump`, que viene en la carpeta `bin/` del repositorio.

```bash
./pivotfoot.sh /evidence/evtx/ /evidence/xml/
```

La ayuda del propio script pide dos carpetas: la de los EVTX y la de destino, donde deja un fichero `.xml` por cada log que reconoce.

### 2. Parseo y generación de CSV

```bash
# Parsear una carpeta entera de EVTX ya convertidos (la salida de pivotfoot.sh)
python sabonis.py parse evtx --directory --source_artifact /evidence/xml/ --csv_output lateral_movement.csv

# Parsear un PCAP
python sabonis.py parse pcap --source_artifact capture.pcap --csv_output network_lateral.csv

# Parsear un log de proxy
python sabonis.py parse proxy --source_artifact access.log --csv_output proxy_lateral.csv

# Opciones útiles
python sabonis.py parse evtx --directory --source_artifact /evidence/xml/ --csv_output output.csv \
  --ignore_local \
  --exclusionlist exclusions.txt \
  --timezone "Europe/Madrid"
```

**Probado en noviembre de 2026** sobre los logs de un servidor de nuestro laboratorio, en Linux. `pivotfoot.sh` convirtió siete logs a XML y `parse evtx --directory` escribió 2 323 filas (1 268 inicios de sesión 4624, 758 cierres 4634, 262 eventos 4648 y el resto de RDP). Con `--ignore_local` quedaron 469. Dos cosas a tener en cuenta:

- Sabonis usa una función de pandas que desapareció en la versión 2. Instálalo con `pandas` 1.5 (`pip install "pandas<2" "numpy<2"`), o falla al procesar el primer log.
- Con `--timezone` la ejecución terminó con un error al interpretar las fechas. Sin esa opción, las horas salen en UTC.

La carga en Neo4j (`load2neo`) no la hemos vuelto a probar.

### 3. Carga en Neo4j

```bash
python sabonis.py load2neo evtx --csv_input lateral_movement.csv --ne04j_url bolt://localhost:7687 --ne04j_user neo4j
```

Antes necesitas un Neo4j arrancado y accesible en esa dirección. La contraseña del usuario no va en el comando: sabonis la pide por consola.

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
