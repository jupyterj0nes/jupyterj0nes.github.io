---
layout: post
title: "Persistence Boromir: Nadie persiste sin ser detectado"
date: 2026-04-06 06:00:00 +0100
category: tools
lang: es
ref: tool-boromir
tags: [boromir, persistencia, windows, registry, forensics, herramientas]
description: "Persistence Boromir detecta y cataloga 24 mecanismos de persistencia en Windows comprometidos, generando una timeline cronológica de todos los artefactos encontrados."
comments: true
---

## "One does not simply persist without being detected"

El nombre no es casualidad. Igual que Boromir no pudo resistir la tentación del Anillo Único, el malware no puede resistir la tentación de establecer **persistencia**. Y igual que Boromir al final reveló sus intenciones, esta herramienta revela *todas* las formas en las que algo persiste en un sistema Windows.

## ¿Qué es Persistence Boromir?

Persistence Boromir es una herramienta forense en Python creada por **Alejandro Gamboa** ([AI3xGP](https://github.com/AI3xGP/Persistence_Boromir)), con contribuciones de [@skyg4mb](https://github.com/skyg4mb) y [@jupyterj0nes](https://github.com/jupyterj0nes). Su objetivo es detectar y catalogar **24 mecanismos diferentes de persistencia** en sistemas Windows comprometidos, generando una timeline que permite al analista centrarse en la "zona roja" del incidente.

- **Repositorio original:** [github.com/AI3xGP/Persistence_Boromir](https://github.com/AI3xGP/Persistence_Boromir)
- **Mi fork:** [github.com/jupyterj0nes/Persistence_Boromir](https://github.com/jupyterj0nes/Persistence_Boromir)
- **Lenguaje:** Python
- **Autor:** Alejandro Gamboa (AI3xGP)
- **Rol:** Contribuidor

## ¿Por qué importa la persistencia?

En una respuesta ante incidentes, hay una pregunta que siempre aparece en las primeras fases:

> *"¿Cómo se mantiene el atacante en el sistema?"*

Si no identificas todos los mecanismos de persistencia, el atacante volverá después de que "limpies" el sistema. Y no hablamos solo de las claves Run del registro — hay **24 técnicas** documentadas, muchas de ellas poco conocidas incluso por analistas experimentados.

## Los 24 mecanismos de persistencia

### Registro de Windows

| Mecanismo | Técnica MITRE | Descripción |
|-----------|--------------|-------------|
| Run / RunOnce | T1547.001 | Ejecución al inicio de sesión |
| Image File Execution Options | T1546.012 | Hijacking de ejecución de procesos |
| AppPaths | T1546 | Redirección de rutas de aplicación |
| Shell Extensions | T1546.015 | Extensiones de shell COM |
| Winlogon | T1547.004 | Hooks en el proceso de logon |
| AppInit_DLLs | T1546.010 | DLLs cargadas en cada proceso |

### Ejecución y servicios

| Mecanismo | Técnica MITRE | Descripción |
|-----------|--------------|-------------|
| Servicios de Windows | T1543.003 | Servicios maliciosos |
| Tareas programadas | T1053.005 | Scheduled tasks |
| Startup Folders | T1547.001 | Carpetas de inicio |

### Hijacking y técnicas avanzadas

| Mecanismo | Técnica MITRE | Descripción |
|-----------|--------------|-------------|
| DLL Search Order Hijacking | T1574.001 | Explotación del orden de búsqueda de DLLs |
| COM Object Hijacking | T1546.015 | Secuestro de objetos COM |
| WerFaultHangs | — | Abuso del manejador de errores de Windows |
| Logon Scripts | T1037.001 | Scripts ejecutados al iniciar sesión |

Y muchos más hasta completar las **24 técnicas**.

## Cómo funciona

Boromir escanea el sistema (o una imagen forense) buscando todos los mecanismos de persistencia conocidos:

```bash
python boromir.py --target /evidence/mounted_image/ --output results.csv --timezone "Europe/Madrid"
```

### Output

El CSV de salida incluye:

| Campo | Descripción |
|-------|-------------|
| Timestamp | Cuándo se creó/modificó la persistencia |
| Mechanism | Qué tipo de persistencia es |
| Path | Dónde se encuentra (clave de registro, ruta de archivo, etc.) |
| Value | Qué ejecuta |
| Details | Información adicional |

### La "zona roja"

Al ordenar los resultados cronológicamente, puedes identificar la **zona roja** — el periodo de tiempo en el que el atacante estableció sus mecanismos de persistencia. Esto te da:

- **Cuándo** ocurrió la infección
- **Qué** se instaló como persistencia
- **Correlación** con otros artefactos (logs, prefetch, etc.)

## ¿Cuándo usar Boromir?

- **Triage inicial** — ¿Hay persistencia maliciosa en esta máquina?
- **Post-limpieza** — ¿Hemos eliminado *todos* los mecanismos de persistencia?
- **Hunting** — Búsqueda proactiva de persistencia en la infraestructura
- **Formación** — Entender los 24 mecanismos de persistencia de Windows

## Próximos posts

- Análisis detallado de cada mecanismo de persistencia
- Guía de ejecución paso a paso
- Interpretación de resultados y detección de falsos positivos
- Integración con KAPE y otras herramientas de triage
- Caso práctico: detectando persistencia en un incidente real
