---
layout: post
title: "Empezando con KAPE: Triage como un profesional"
date: 2026-04-06 09:00:00 +0100
category: tools
lang: es
tags: [kape, triage, recoleccion, herramientas]
description: "Guía práctica de KAPE (Kroll Artifact Parser and Extractor) — cómo recolectar y procesar artefactos forenses de forma eficiente."
comments: true
---

KAPE (Kroll Artifact Parser and Extractor) es una herramienta de triage diseñada para recolectar y procesar artefactos forenses rápidamente. Se ha convertido en una herramienta esencial en el toolkit de DFIR.

## ¿Por qué KAPE?

- **Velocidad:** Recolecta artefactos en minutos, no en horas
- **Targets:** Perfiles de recolección predefinidos para artefactos comunes
- **Módulos:** Procesamiento automatizado con herramientas como la suite de Eric Zimmerman
- **Portable:** Se ejecuta desde un USB — no necesita instalación

## Uso básico

### Recolectar artefactos (Targets)

```bash
kape.exe --tsource C: --tdest D:\Evidence\Collection --target KapeTriage
```

### Procesar datos recolectados (Modules)

```bash
kape.exe --msource D:\Evidence\Collection --mdest D:\Evidence\Processed --module !EZParser
```

### Recolectar y procesar en un solo paso

```bash
kape.exe --tsource C: --tdest D:\Evidence\Collection --target KapeTriage --mdest D:\Evidence\Processed --module !EZParser
```

## Targets esenciales

| Target | Qué recolecta |
|--------|--------------|
| `KapeTriage` | Recolección de triage completa |
| `!SANS_Triage` | Artefactos recomendados por SANS |
| `RegistryHives` | SAM, SYSTEM, SOFTWARE, NTUSER.DAT |
| `EventLogs` | Logs de eventos de Windows (.evtx) |
| `Prefetch` | Archivos Prefetch |
| `$MFT` | Master File Table |

## Consejos profesionales

1. **Valida siempre tus targets** antes de desplegar en campo
2. **Actualiza regularmente** — se añaden nuevos targets y módulos frecuentemente
3. **Usa targets compuestos** (prefijo `!`) para recolecciones completas
4. **Documenta tu comando de recolección** — forma parte de tu cadena de custodia

> KAPE no sustituye una imagen forense completa, pero para triage y respuesta rápida, no tiene rival.
