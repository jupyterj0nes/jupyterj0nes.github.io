---
layout: post
title: "Persistence Boromir: Detectando los 24 mecanismos de persistencia de Windows"
date: 2026-04-06 06:00:00 +0100
category: tools
lang: es
ref: tool-boromir
tags: [boromir, persistencia, windows, forensics, herramientas]
description: "Persistence Boromir detecta y cataloga 24 mecanismos de persistencia en Windows, generando una timeline de todos los artefactos de persistencia encontrados."
comments: true
---

## ¿Qué es Persistence Boromir?

**Persistence Boromir** es una herramienta forense en Python que detecta y cataloga **24 mecanismos diferentes de persistencia** en sistemas Windows comprometidos. Su nombre viene de Boromir de El Señor de los Anillos — porque igual que Boromir intentó resistir la tentación del anillo y no pudo, el malware no puede resistir la tentación de establecer persistencia.

- **Repositorio:** [github.com/jupyterj0nes/Persistence_Boromir](https://github.com/jupyterj0nes/Persistence_Boromir)
- **Lenguaje:** Python

## ¿Qué mecanismos detecta?

Boromir cubre un amplio espectro de técnicas de persistencia en Windows:

### Registro
- Run / RunOnce
- Image File Execution Options (IFEO)
- AppPaths
- Shell extensions

### Ejecución
- Servicios de Windows
- Tareas programadas
- Startup folders

### Hijacking
- DLL injection vectors
- COM Object hijacking
- WerFaultHangs

### Y más...
Hasta **24 técnicas diferentes** catalogadas y analizadas.

## ¿Cómo funciona?

1. **Escanea** el sistema en busca de los 24 mecanismos de persistencia
2. **Cataloga** cada artefacto encontrado con sus detalles
3. **Genera una timeline** cronológica para que el analista pueda centrarse en la "zona roja" del incidente
4. **Exporta a CSV** con soporte de timezone

## ¿Por qué es importante?

En una respuesta ante incidentes, una de las primeras preguntas es: *"¿Cómo persiste el atacante?"*. Boromir automatiza la búsqueda de los mecanismos más comunes (y algunos no tan comunes), ahorrando horas de análisis manual.

## Próximos posts

Esta es la página principal de Persistence Boromir. En futuros posts detallaremos:

- Los 24 mecanismos de persistencia explicados uno a uno
- Cómo ejecutar Boromir en un sistema comprometido
- Interpretación de resultados
- Integración con otras herramientas de triage
- Casos prácticos de detección de persistencia
