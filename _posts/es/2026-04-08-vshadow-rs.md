---
layout: post
title: "vshadow-rs: Parser VSS en Rust puro para imagenes forenses"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: es
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, herramientas]
description: "Parser en Rust puro para snapshots de Volume Shadow Copy (VSS) de Windows. Identifica, genera timelines y recupera ficheros de stores VSS en imagenes forenses E01 y dd, multiplataforma."
comments: true
---

## El problema

Los atacantes borran los logs de eventos de Windows. Pero si existen Volume Shadow Copies en el disco, los logs antiguos siguen ahi — congelados en el tiempo. El reto: las herramientas existentes no permiten acceder facilmente.

| Herramienta | Limitacion |
|-------------|-----------|
| **vshadowmount** | Requiere FUSE, solo Linux |
| **EVTXECmd --vss** | Requiere API COM de VSS de Windows, solo sistemas en vivo |
| **Ambas** | No pueden leer de imagenes forenses E01 directamente |

## Que es vshadow-rs?

Una libreria y herramienta CLI en **Rust puro** que lee el formato VSS directamente desde imagenes E01, raw/dd o de particion. Sin APIs de Windows, sin dependencias en C, funciona en Windows, Linux y macOS.

- **Repositorio:** [github.com/jupyterj0nes/vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
- **Crate:** [crates.io/crates/vshadow](https://crates.io/crates/vshadow)
- **Licencia:** AGPL-3.0

---

## Caracteristicas principales

| Caracteristica | Descripcion |
|----------------|-------------|
| Inspeccionar stores VSS | Listar todos los snapshots con GUIDs, fechas de creacion y tamano del delta |
| Listar ficheros | Navegar directorios NTFS dentro de cualquier store VSS o del volumen activo |
| **Deteccion de delta** | Comparar snapshots VSS contra el volumen activo — encontrar ficheros borrados y modificados |
| **Timelines MACB** | Generar timelines forenses del delta con precision completa de timestamps NTFS |
| Extraer ficheros | Extraer ficheros de stores VSS a disco — recuperar logs de eventos borrados |
| Soporte E01 | Lee directamente de imagenes Expert Witness Format, sin ewfmount |
| Deteccion automatica de particiones | Encuentra particiones NTFS automaticamente via GPT y MBR |
| Multiplataforma | Windows, Linux y macOS — binario unico, cero dependencias |
| Libreria + CLI | Usable como crate Rust o como herramienta de linea de comandos |

---

## Instalar

```bash
cargo install vshadow
```

---

## Uso CLI

### Inspeccionar: encontrar stores VSS

```bash
vshadow-rs info -f evidence.E01
```

### Listar: navegar ficheros en un store VSS o volumen activo

```bash
# Volumen activo
vshadow-rs list -f evidence.E01 --live -p "Windows/System32/winevt/Logs"

# Store VSS 0
vshadow-rs list -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs"
```

### List-delta: encontrar que cambio entre VSS y el volumen activo

Esto es lo que hace unico a vshadow-rs. Compara el filesystem del snapshot contra el volumen activo y muestra solo los ficheros que fueron **borrados** o **modificados**.

```bash
# Mostrar delta de todos los stores VSS
vshadow-rs list-delta -f evidence.E01

# Enfocarse solo en los logs de eventos
vshadow-rs list-delta -f evidence.E01 -p "Windows/System32/winevt/Logs"

# Exportar delta a CSV
vshadow-rs list-delta -f evidence.E01 -o delta.csv
```

<img src="/assets/images/vshadow-rs-list-delta.png" alt="vshadow-rs list-delta output" width="700">

La salida muestra cada fichero modificado con su tamano en el volumen activo vs. el store VSS, haciendo inmediatamente obvio cuando los logs han sido borrados.

### Extraer: recuperar ficheros de stores VSS

```bash
vshadow-rs extract -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recuperados/
```

### Timeline: generar timeline MACB del delta VSS

Genera un CSV con timeline MACB (Modified, Accessed, Changed, Born) completa del delta — solo ficheros que existen en VSS pero no en el volumen activo, o que cambiaron.

```bash
# Formato expandido: 8 filas por fichero (timestamps SI + FN)
vshadow-rs timeline -f evidence.E01 -o timeline.csv

# Formato MACB: 1 fila por fichero con flags MACB
vshadow-rs timeline -f evidence.E01 --format macb -o timeline.csv

# Incluir volumen activo en la timeline
vshadow-rs timeline -f evidence.E01 --include-live -o timeline.csv
```

### Flujo de trabajo forense tipico

```bash
# 1. Comprobar si hay stores VSS
vshadow-rs info -f suspect.E01

# 2. Encontrar que cambio entre VSS y el volumen activo
vshadow-rs list-delta -f suspect.E01 -p "Windows/System32/winevt/Logs"

# 3. Extraer los logs previos al borrado desde VSS
vshadow-rs extract -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recuperados/

# 4. Generar timeline de ficheros borrados/modificados
vshadow-rs timeline -f suspect.E01 -o timeline.csv

# 5. Parsear los logs recuperados con masstin
masstin -a parse-windows -d ./recuperados/ -o lateral.csv
```

---

## Que hace unico a vshadow-rs

1. **Deteccion de delta** (`list-delta`): ninguna otra herramienta compara snapshots VSS contra el volumen activo para mostrar exactamente que cambio. Es la forma mas rapida de encontrar logs borrados, ficheros eliminados y evidencia manipulada.

2. **Timelines MACB desde las sombras** (`timeline`): genera timelines forenses del delta — solo los cambios relevantes, no el filesystem completo.

3. **Soporte E01 directo**: lee imagenes forenses sin montar, convertir ni extraer.

4. **Rust puro, multiplataforma**: sin FUSE, sin APIs de Windows, sin librerias C. Funciona en cualquier SO.

5. **Libreria + CLI**: usa el crate `vshadow` en tus propias herramientas Rust, o usa el binario `vshadow-rs` desde la linea de comandos.

---

## Comparacion con herramientas existentes

| Funcionalidad | vshadowmount | vshadowinfo | **vshadow-rs** |
|---------------|-------------|-------------|-----------------|
| Listar stores VSS | No | Si | **Si** |
| Mostrar GUIDs, fechas | No | Si | **Si** |
| Mostrar tamano del delta | No | No | **Si** |
| Montar como filesystem FUSE | Si | No | No |
| **Listar ficheros en store VSS** | Via mount | No | **Si** |
| **Extraer ficheros de VSS** | Via mount | No | **Si** |
| **Comparar VSS vs live (delta)** | No | No | **Si** |
| **Timeline MACB del delta** | No | No | **Si** |
| **Listar ficheros en volumen activo** | No | No | **Si** |
| **Leer E01 directamente** | No | No | **Si** |
| **Detectar particiones GPT/MBR** | No | No | **Si** |
| Multiplataforma | Solo Linux | Linux/Mac/Win | **Win/Linux/Mac** |

---

## Como funciona VSS

Volume Shadow Copy utiliza un mecanismo de copy-on-write a nivel de bloques (16 KiB):

1. **Creacion de snapshot**: el catalogo registra los metadatos (GUID, timestamp)
2. **Modificacion de bloque**: cuando un bloque va a ser sobreescrito, los datos **antiguos** se copian a un area de almacenamiento primero
3. **Reconstruccion**: leer del store para bloques cambiados, del volumen activo para bloques sin cambios

vshadow-rs parsea las estructuras en disco: cabecera a `0x1E00`, catalogo (lista enlazada de bloques de 16 KiB) y descriptores de bloques (entradas de 32 bytes mapeando offsets originales a datos almacenados).

---

## Uso como libreria

```rust
use vshadow::VssVolume;

let mut reader = /* cualquier fuente Read+Seek */;
let vss = VssVolume::new(&mut reader)?;

for i in 0..vss.store_count() {
    let mut store = vss.store_reader(&mut reader, i)?;
    // store implementa Read + Seek — pasar al crate ntfs
}
```

---

## Integracion con masstin

[Masstin](/es/tools/masstin-lateral-movement-rust/) utiliza vshadow-rs para procesar imagenes forenses con un solo comando:

```bash
masstin -a parse-image-windows -f evidence.E01 -o timeline.csv
```

Esto extrae EVTX tanto del volumen activo como de todos los snapshots VSS, generando una timeline unificada de movimiento lateral que incluye eventos que el atacante borro.
