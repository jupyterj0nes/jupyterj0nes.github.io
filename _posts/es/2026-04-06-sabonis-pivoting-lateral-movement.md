---
layout: post
title: "Sabonis: Pivotando sobre movimiento lateral con artefactos forenses"
date: 2026-04-06 08:00:00 +0100
category: tools
lang: es
ref: tool-sabonis
tags: [sabonis, lateral-movement, evtx, neo4j, herramientas]
description: "Sabonis es una herramienta DFIR en Python que parsea artefactos forenses (EVTX, Squid, PCAP) para extraer evidencias de movimiento lateral y visualizarlas en Neo4j."
comments: true
---

## ¿Qué es Sabonis?

**Sabonis** es una herramienta de pivoting DFIR desarrollada en Python que parsea artefactos forenses para extraer evidencias de movimiento lateral. Su nombre hace referencia a Arvydas Sabonis — porque al igual que el legendario pívot lituano, esta herramienta pivota sobre los datos para encontrar las conexiones que importan.

- **Repositorio:** [github.com/jupyterj0nes/sabonis](https://github.com/jupyterj0nes/sabonis)
- **Licencia:** GPLv3
- **Lenguaje:** Python

## ¿Qué artefactos procesa?

Sabonis es capaz de parsear y correlacionar datos de más de 7 tipos de fuentes:

| Fuente | Tipo |
|--------|------|
| Windows Event Logs (.evtx) | Security, System, RDP, WinRM, PowerShell, SMB... |
| Squid Proxy Logs | Logs de proxy |
| PCAP | Capturas de red |

## ¿Cómo funciona?

1. **Parsea** los artefactos forenses proporcionados
2. **Extrae** las evidencias de movimiento lateral (conexiones RDP, sesiones WinRM, autenticaciones, etc.)
3. **Fusiona** todos los datos en ficheros CSV unificados
4. **Exporta** a Neo4j para visualización en grafos mediante consultas Cypher

## ¿Por qué Neo4j?

Cuando investigas movimiento lateral en una red comprometida, las tablas y CSVs se quedan cortos. Necesitas ver las **relaciones** entre máquinas, usuarios y conexiones. Neo4j convierte esos datos en un grafo interactivo donde puedes:

- Ver de un vistazo qué máquinas se comunican entre sí
- Identificar patrones de movimiento lateral
- Rastrear la progresión del atacante a través de la red
- Detectar conexiones anómalas

## Próximos posts

Esta es la página principal de Sabonis. En futuros posts detallaremos:

- Instalación y configuración
- Parseo de cada tipo de artefacto
- Carga de datos en Neo4j
- Consultas Cypher útiles para investigaciones
- Casos prácticos de uso

> **Nota:** Sabonis ha evolucionado a [masstin](/es/tools/masstin-lateral-movement-rust/), su versión reescrita en Rust con un rendimiento ~90% superior. Si estás empezando un proyecto nuevo, considera usar masstin directamente.
