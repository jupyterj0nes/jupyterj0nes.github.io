---
layout: post
title: "Masstin: Movimiento lateral a la velocidad de Rust"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, herramientas]
description: "Masstin es la evolución de Sabonis, reescrita en Rust. Parsea 10+ tipos de artefactos forenses y genera timelines unificadas de movimiento lateral."
comments: true
---

## ¿Qué es Masstin?

**Masstin** es la evolución de [Sabonis](/es/tools/sabonis-pivoting-lateral-movement/), reescrita desde cero en Rust para conseguir un rendimiento ~90% superior. Es una herramienta DFIR que parsea más de 10 tipos de artefactos forenses y los unifica en una timeline cronológica en CSV, centrada en el movimiento lateral.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** GPLv3
- **Lenguaje:** Rust
- **Plataformas:** Windows y Linux (sin dependencias)

## ¿Por qué Rust?

Masstin nació de la necesidad real de investigaciones con:

- **Múltiples máquinas** con logs rotados
- **Reenvío SIEM incompleto** — necesitas parsear los originales
- **Volúmenes masivos de datos** donde Python se quedaba corto

Rust proporcionó la velocidad necesaria sin sacrificar funcionalidad.

## Características principales

- Parseo de **10+ tipos de artefactos forenses**
- Timeline unificada en **CSV** cronológico
- **Subida directa a Neo4j** para visualización en grafos
- **Consultas Cypher pre-construidas** listas para usar
- **Resolución automática IP → hostname**
- **Agrupación de conexiones** para reducir ruido
- Multiplataforma, sin dependencias

## Sabonis vs Masstin

| | Sabonis | Masstin |
|--|---------|---------|
| Lenguaje | Python | Rust |
| Rendimiento | Base | ~90% más rápido |
| Artefactos | 7+ tipos | 10+ tipos |
| Neo4j | Exporta CSV | Subida directa |
| Consultas Cypher | Manual | Pre-construidas |
| Resolución IP | No | Automática |
| Dependencias | Python + libs | Ninguna |

## Próximos posts

Esta es la página principal de Masstin. En futuros posts detallaremos:

- Compilación e instalación
- Tipos de artefactos soportados
- Configuración de Neo4j
- Consultas Cypher avanzadas
- Comparativa de rendimiento con Sabonis
- Casos reales de investigación
