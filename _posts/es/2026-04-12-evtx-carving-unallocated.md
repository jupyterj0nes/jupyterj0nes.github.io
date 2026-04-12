---
layout: post
title: "EVTX Carving: Recuperando logs de eventos borrados del espacio no asignado"
date: 2026-04-12 02:00:00 +0100
category: tools
lang: es
ref: tool-masstin-evtx-carving
tags: [masstin, carving, evtx, forense, dfir, unallocated, recuperación, herramientas]
description: "La acción carve-image de masstin escanea imágenes forenses buscando chunks EVTX en espacio no asignado, recuperando eventos de movimiento lateral después de que los atacantes borren los logs."
comments: true
---

## El último recurso: cuando hasta los VSS han desaparecido

El atacante fue meticuloso. Borró todos los logs de eventos. Eliminó los Volume Shadow Copies con `vssadmin delete shadows /all`. Incluso limpió las bases de datos UAL. Tu Security.evtx está vacío, tus stores VSS han desaparecido, y no queda nada que parsear.

¿O sí?

Cuando Windows borra un fichero, los datos no desaparecen del disco — el espacio simplemente se marca como "disponible" en el sistema de ficheros. Los bytes reales — incluyendo chunks EVTX completos — permanecen en disco hasta que se sobreescriben con datos nuevos. **El `carve-image` de masstin escanea el disco raw buscando estos restos y los recupera.**

## Estructura de los ficheros EVTX en disco

Un fichero EVTX consiste en:

```
[File Header - 4KB] [Chunk 0 - 64KB] [Chunk 1 - 64KB] [Chunk 2 - 64KB] ...
```

Cada chunk de 64KB comienza con la firma mágica `ElfChnk\x00` y contiene decenas a cientos de registros de eventos. Cada chunk es autónomo — tiene su propia tabla de strings, tabla de templates, y registros. Esto significa que un solo chunk encontrado en espacio no asignado puede parsearse de forma independiente, incluso sin el resto del fichero EVTX.

Cada registro individual dentro de un chunk comienza con la firma `\x2a\x2a\x00\x00` y contiene:

| Offset | Tamaño | Campo |
|--------|--------|-------|
| 0 | 4 | Magic: `0x2A2A0000` |
| 4 | 4 | Tamaño del registro (u32) |
| 8 | 8 | Record ID (u64) |
| 16 | 8 | Timestamp (FILETIME) |
| 24 | var | Datos BinXML del evento |
| size-4 | 4 | Copia del tamaño (validación) |

## Qué recupera masstin mediante carving

### Tier 1: Recuperación de chunks completos (fidelidad total)

Masstin escanea la imagen de disco completa sector a sector (alineación 512 bytes) buscando la firma de 8 bytes `ElfChnk\x00`. Cuando la encuentra, lee el chunk completo de 64KB y lo valida intentando parsearlo con el crate evtx. Los chunks válidos se agrupan por provider (ej: `Microsoft-Windows-Security-Auditing`, `Microsoft-Windows-TerminalServices-LocalSessionManager`) y se ensamblan en ficheros EVTX sintéticos.

Estos ficheros EVTX sintéticos se procesan después por el pipeline existente de masstin — los mismos 32+ Event IDs, el mismo formato CSV, la misma carga a grafo. **Los eventos carved son indistinguibles de los eventos live en la salida.**

### Tier 2: Detección de records huérfanos (metadatos)

Los records que existen fuera de chunks válidos (chunks parcialmente sobreescritos) se detectan buscando la firma `\x2a\x2a\x00\x00`. Se validan con:

- Campo de tamaño en rango (28-65024 bytes)
- Copia del tamaño al final coincide
- Byte de preámbulo BinXML (`0x0F`)
- Timestamp en rango razonable (2000-2030)

Los records huérfanos se cuentan y reportan. La recuperación completa del XML de records huérfanos requiere template matching (Tier 3, planificado para una futura versión).

## Uso

```bash
# Carving de una imagen forense
masstin -a carve-image -f servidor.e01 -o timeline-carved.csv

# Carving de múltiples imágenes
masstin -a carve-image -f DC01.e01 -f SRV-FILE.vmdk -o carved.csv

# Futuro: escanear solo espacio no asignado (más rápido)
masstin -a carve-image -f servidor.e01 -o carved.csv --carve-unalloc
```

La salida es el mismo CSV de 14 columnas que `parse-image`, con `log_filename` mostrando el origen carved:

```
HRServer_Disk0.e01_carved_Microsoft-Windows-Security-Auditing.evtx
```

## Resultados reales

Carving de la imagen HRServer del DEFCON DFIR CTF 2018 (E01 de 12.6 GB):

| Métrica | Resultado |
|---------|-----------|
| Tamaño imagen | 12.6 GB (E01 comprimido) |
| Tamaño disco | ~50 GB (expandido) |
| Chunks encontrados | 1,092 |
| Records huérfanos | 8,451 |
| Ficheros EVTX sintéticos | 94 (agrupados por provider) |
| **Eventos de movimiento lateral recuperados** | **37,772** |
| Tiempo de escaneo | ~3 minutos |

Los eventos carved incluyen Security.evtx (32,195 eventos), SMBServer (5,374), TerminalServices (90) y RdpCoreTS (136) — timeline completa de movimiento lateral recuperada del disco raw.

## Rendimiento

La velocidad del carving depende del I/O:

| Almacenamiento | Velocidad | Tiempo para 100 GB |
|----------------|-----------|---------------------|
| NVMe local | ~3 GB/s | ~35 segundos |
| SSD SATA | ~500 MB/s | ~3.5 minutos |
| E01 en SSD | ~200-400 MB/s | ~5-8 minutos |
| E01 en HDD | ~100-150 MB/s | ~12-17 minutos |
| Share de red | ~50-100 MB/s | ~17-33 minutos |

El escaneo es secuencial (una sola pasada, sin seeks) — el cuello de botella siempre es la velocidad de lectura de disco, no la CPU.

## Comparación con otras herramientas de carving

| Herramienta | Lenguaje | Tier 1 (chunks) | Tier 2 (records) | Tier 3 (template match) | Parseo de movimiento lateral |
|-------------|----------|-----------------|-----------------|------------------------|------------------------------|
| **masstin carve-image** | Rust | Sí | Solo detección | Planificado | **Sí — pipeline completo** |
| EVTXtract (Ballenthin) | Python | Sí | Sí | Sí | No — genera XML raw |
| bulk_extractor-rec | C++ | Sí | Sí | No | No — genera ficheros raw |
| EvtxCarv | Python | Sí | Sí | Reensamblaje de fragmentos | No — genera ficheros raw |

Masstin es la única herramienta que hace carving de chunks EVTX **y** los parsea inmediatamente para movimiento lateral, produciendo una timeline lista para usar y cargar en grafo.

## Cuándo usar carve-image vs parse-image

| Escenario | Usar |
|-----------|------|
| Análisis forense normal | `parse-image` — extrae de NTFS + VSS |
| Logs borrados, VSS intacto | `parse-image` — la recuperación VSS lo maneja |
| Logs borrados, VSS borrado, UAL intacto | `parse-image` — UAL proporciona 3 años de historial |
| **Todo borrado** | **`carve-image` — recupera del espacio no asignado** |
| Recuperación máxima | Ambos: `parse-image` primero, luego `carve-image` sobre la misma imagen |

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Imágenes forenses y recuperación VSS | [parse-image](/es/tools/masstin-vss-recovery/) |
| MountPoints2 del registro | [MountPoints2](/es/artifacts/mountpoints2-lateral-movement/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
