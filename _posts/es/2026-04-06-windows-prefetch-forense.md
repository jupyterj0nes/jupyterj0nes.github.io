---
layout: post
title: "Windows Prefetch: Qué revela y cómo analizarlo"
date: 2026-04-06 10:00:00 +0100
category: artifacts
lang: es
ref: windows-prefetch
tags: [windows, prefetch, ejecucion, artefactos]
description: "Análisis en profundidad de los archivos Prefetch de Windows — qué almacenan, dónde encontrarlos y qué nos dicen durante una investigación."
comments: true
---

Los archivos Prefetch son uno de los artefactos más valiosos en forense de Windows. Proporcionan evidencia de **ejecución de programas**, incluyendo marcas de tiempo, conteos de ejecución y archivos referenciados.

## ¿Qué es Prefetch?

Windows Superfetch/Prefetch es una característica de optimización del rendimiento que monitoriza los patrones de carga de las aplicaciones. Cada vez que se ejecuta un programa, Windows crea (o actualiza) un archivo `.pf` en `C:\Windows\Prefetch\`.

## Formato del archivo

```
<NOMBRE_EJECUTABLE>-<HASH>.pf
```

Por ejemplo:
```
CMD.EXE-4A81B364.pf
POWERSHELL.EXE-022A1004.pf
```

El hash se calcula basándose en la ruta del archivo y, en algunos casos, los argumentos de línea de comandos.

## ¿Qué podemos extraer?

| Campo | Valor forense |
|-------|--------------|
| Nombre del ejecutable | Qué se ejecutó |
| Contador de ejecuciones | Cuántas veces |
| Última ejecución | Cuándo (hasta 8 timestamps en Win10+) |
| Archivos/dirs referenciados | Qué tocó |
| Información del volumen | Desde dónde se ejecutó |

## Análisis con PECmd

**PECmd** de Eric Zimmerman es la herramienta de referencia para parsear archivos Prefetch:

```bash
PECmd.exe -f "C:\Windows\Prefetch\CMD.EXE-4A81B364.pf"
```

O procesar todo el directorio Prefetch:

```bash
PECmd.exe -d "C:\Windows\Prefetch" --csv "C:\output" --csvf prefetch_results.csv
```

## Preguntas clave de investigación

- **¿Se ejecutó una herramienta específica?** Busca su archivo `.pf`.
- **¿Cuándo se ejecutó por última vez?** Revisa los últimos 8 timestamps de ejecución.
- **¿Qué archivos accedió?** La lista de archivos referenciados puede revelar movimiento lateral, staging de datos o rutas de exfiltración.
- **¿Se ejecutó desde un USB?** Los números de serie del volumen en los datos Prefetch pueden indicar medios extraíbles.

## Limitaciones

- Prefetch está **deshabilitado por defecto en SSDs** en algunas versiones de Windows (aunque Windows 10/11 lo mantiene habilitado).
- Máximo de **1024 archivos Prefetch** (los más antiguos se eliminan).
- Solo disponible en ediciones **Windows cliente** (no en Server por defecto).
- Los timestamps pueden manipularse via timestomping, pero los metadatos de Prefetch son más difíciles de falsificar.

## Referencia rápida

- **Ubicación:** `C:\Windows\Prefetch\`
- **Herramientas:** PECmd, WinPrefetchView, Autopsy
- **Clave de registro para verificar estado:** `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters`
  - `EnablePrefetcher = 3` → Habilitado para aplicaciones y arranque

> Los archivos Prefetch son tu primera parada para responder la pregunta forense fundamental: *"¿Se ejecutó este programa en este sistema?"*
