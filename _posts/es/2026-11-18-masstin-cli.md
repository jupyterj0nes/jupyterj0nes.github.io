---
layout: post
title: "masstin en la línea de comandos: todas las acciones y opciones"
short: "Línea de comandos: acciones y opciones"
date: 2026-11-18 23:00:00 +0100
category: tools
section: masstin-ref
order: 20
lang: es
ref: tool-masstin-cli
tags: [masstin, cli, referencia, dfir]
description: "Referencia de la línea de comandos de masstin: las acciones agrupadas por lo que hacen y las opciones agrupadas por la acción que las usa."
comments: true
---
Esta página es para consultar, no para leer de corrido. Las acciones y las opciones de masstin están agrupadas por lo que quieres hacer. La explicación de cada cosa está en su artículo, enlazado al lado.

La forma general es siempre la misma:

```bash
masstin -a ACCIÓN [-d CARPETA]... [-f FICHERO]... [-o SALIDA] [opciones]
```

`masstin --help` da esta misma lista desde la terminal, y es la referencia que vale si esta página se queda atrás.

## Lo que comparten casi todas

| Opción | Qué hace |
|---|---|
| `-a, --action` | La acción. Las tienes más abajo |
| `-d, --directory` | Una carpeta, que se recorre entera. También una letra de unidad (`D:`). Se puede repetir |
| `-f, --file` | Un fichero. Se puede repetir |
| `-o, --output` | Dónde se escribe. Sin ella, la timeline va a la salida estándar |
| `--overwrite` | Sobrescribir la salida si existe. Sin ella, un fichero que ya existe es un error, y lo dice antes de leer nada |
| `--threads N` | Fijar el número de hilos. Sin ella, masstin [mide lo que está libre](/es/tools/masstin-performance/) |
| `--silent` | Sin salida por consola, para automatizar |
| `--debug` | Información de depuración |

## Leer evidencia

| Acción | Para qué |
|---|---|
| **`parse`** | **La que hay que usar.** [Cualquier evidencia, de una pasada](/es/tools/masstin-parse/) |
| `parse-windows` | Solo EVTX y bases de datos UAL, sueltos o en ZIP |
| `parse-image` | Solo imágenes de disco y [volúmenes montados](/es/tools/masstin-live-volumes/) |
| `parse-linux` | Solo logs y triages de Linux |
| `parse-mac` | Solo `.logarchive` o exportaciones de `log show` |
| `parse-massive` | La pasada masiva por su cuenta: imágenes, triages y ficheros sueltos |
| `parser-elastic` | Eventos de Windows exportados como JSON (Winlogbeat y similares) |
| `parse-custom` | Logs de texto con [reglas YAML](/es/tools/masstin-custom-parsers/) |
| `carve-image` | [Carving de EVTX](/es/tools/evtx-carving-unallocated/) sobre imágenes de disco |
| `merge` | [Unir timelines](/es/tools/masstin-merge/), o refiltrar una |

| Opción | Acción | Qué hace |
|---|---|---|
| `--rules RUTA` | `parse`, `parse-custom` | Reglas YAML para los logs que masstin no conoce |
| `--carve` | `parse` | Además, tallar los EVTX de las imágenes. Lento |
| `--all-volumes` | `parse-image` | Todos los volúmenes NTFS del sistema. Requiere administrador |
| `--parallel-images N` | `parse-image`, `parse-massive` | Imágenes a la vez. Sin ella, se mide |
| `--skip-offsets LISTA` | `carve-image` | Zonas dañadas de un E01 que saltarse (32 MB cada una) |
| `--dry-run` | analizadores, `merge` | Enseñar el resultado sin escribir el CSV |

### Filtrar el ruido

En todos los analizadores y en `merge`. Explicado en [filtrar el ruido](/es/tools/masstin-noise-filtering/).

| Opción | Quita |
|---|---|
| `--ignore-local` | Las filas sin un origen útil |
| `--exclude-users LISTA` | Cuentas, con comodines o `@fichero` |
| `--exclude-hosts LISTA` | Máquinas |
| `--exclude-ips LISTA` | Direcciones o rangos CIDR |

### Acotar en el tiempo

| Opción | Qué hace |
|---|---|
| `--start-time` | Inicio, en UTC: `"AAAA-MM-DD HH:MM:SS"`. Una fecha sola vale por su primer segundo |
| `--end-time` | Fin. Una fecha sola vale por su último segundo, así que el día entra entero |

Valen para `merge`, las acciones de Cortex, los cargadores de grafos y el visor.

## Cortex XDR

Explicado en [el artículo de Cortex](/es/tools/cortex-xdr-artifacts/).

| Acción | Para qué |
|---|---|
| `parse-cortex` | Leer el movimiento lateral de un tenant por su API |
| `parse-cortex-evtx-forensics` | Solo los logs recogidos por el módulo forense |

| Opción | Qué hace |
|---|---|
| `--cortex-url` | La URL de la API, que empieza por `https://api-` |
| `--cortex-check` | Solo comprobar que la URL y la clave funcionan. No gasta unidades de cómputo |
| `--cortex-sources` | Qué leer: `network`, `eventlog`, `forensics`, o `all` |
| `--admin-ports` | Ampliar los puertos de red a todo el conjunto de administración |
| `--filter-cortex-ip` | Quedarse con una dirección |
| `--cortex-event-ids` | Cambiar los Event ID que se piden a los logs forenses |
| `--cortex-min-window-secs`, `--cortex-max-passes` | Ajustes de la paginación en periodos enormes |

La clave no va nunca en la línea de comandos. masstin la pide por consola, o la lee de `CORTEX_API_KEY` y `CORTEX_API_KEY_ID`.

## Cazar

Explicado en [graph-hunt](/es/tools/masstin-graph-hunt/) y en [leer el resultado](/es/tools/masstin-hunt-report/).

| Acción | Lee de |
|---|---|
| **`graph-hunt-csv`** | **La timeline, sin base de datos** |
| `graph-hunt` | Un grafo en Memgraph |
| `graph-hunt-neo4j` | Un grafo en Neo4j |
| `host-map` | No caza: enseña de quién es cada dirección, con la evidencia |

| Opción | Qué hace |
|---|---|
| `--investigation-from` | **Obligatoria.** Dónde empieza lo que investigas. Lo anterior es la referencia |
| `--end-time` | Dónde acaba, si no es al final |
| `--alpha` | La proporción de falsos hallazgos que toleras. Por defecto 0,05 |
| `--report FICHERO.md` | Escribir también el informe por origen |
| `--seed LISTA` | [Reconstruir la cadena](/es/tools/masstin-hunt-seeds/) desde máquinas, direcciones o cuentas conocidas |
| `--seed-from`, `--seed-to` | Qué logins pueden iniciar la cadena |
| `--only-detectors`, `--skip-detectors` | Usar solo algunas señales, o quitar algunas |
| `--no-annotate` | No tocar la timeline |
| `--if-hunted` | Qué hacer si la timeline ya tenía un hunt: `overwrite`, `keep` o `new` |
| `--merge-hosts` | Leer cada dirección como la máquina que es: `strict`, `standard` o `broad` |
| `--merge-hosts-skip` | Direcciones que dejar como están |
| `--carry-marks FICHERO.csv` | Traer veredictos y notas de una timeline anterior |

## Ver

Explicado en [el visor](/es/tools/masstin-viewer/).

| Acción | Para qué |
|---|---|
| `view` | Abrir la ventana sobre una o varias timelines |

| Opción | Qué hace |
|---|---|
| `--focus MÁQUINA` | Abrir en el vecindario de una máquina |
| `--case FICHERO.masstin` | Abrir un [fichero de caso](/es/tools/masstin-viewer-marks-case/) |
| `--rows LÍNEA,LÍNEA` | Abrir solo esas filas, por su número de línea |
| `--event "HORA,CUENTA,ORIGEN,DESTINO"` | Abrir solo los eventos que encajen. Se puede repetir |
| `--events-file FICHERO` | Un `--event` por línea |
| `--renderer` | Elegir [quién dibuja](/es/tools/masstin-viewer-remote-desktop/): `glow` o `software` |

`masstin` sin argumentos abre la pantalla de bienvenida.

## Bases de datos de grafos

Explicado en [Neo4j](/es/tools/neo4j-cypher-visualization/) y [Memgraph](/es/tools/memgraph-visualization/).

| Acción | Para qué |
|---|---|
| `load-neo4j`, `load-memgraph` | Cargar una timeline en la base de datos |
| `merge-neo4j-nodes`, `merge-memgraph-nodes` | Unir dos nodos que son la misma máquina |

| Opción | Qué hace |
|---|---|
| `--database` | La URL de la base de datos (`localhost:7687`) |
| `-u, --user` | El usuario |
| `--db` | El nombre de la base de datos en el servidor |
| `--ungrouped` | Una relación por fila, en lugar de agrupar. El hunt sobre base de datos la necesita |
| `--old-node`, `--new-node` | El nodo que desaparece y el que queda |

## Variables de entorno

| Variable | Qué hace |
|---|---|
| `MASSTIN_THREADS` | Lo mismo que `--threads` |
| `MASSTIN_PRIORITY=normal` | No bajar la prioridad del proceso |
| `CORTEX_API_KEY`, `CORTEX_API_KEY_ID` | La clave de Cortex y su ID |
| `NEO4J_PASSWORD` | La contraseña de Neo4j, para no escribirla |
| `MASSTIN_VIEW_RENDERER`, `MASSTIN_VIEW_LIGHT` | Renderizador y modo ligero del visor |
