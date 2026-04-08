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
| `process` | Proceso que inicio la accion |
| `log_filename` | Archivo de log de origen |

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
