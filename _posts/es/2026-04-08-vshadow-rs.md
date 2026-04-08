---
layout: post
title: "vshadow-rs: Parser VSS en Rust puro para imagenes forenses"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: es
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, herramientas]
description: "Parser en Rust puro para snapshots de Volume Shadow Copy (VSS) de Windows. Lee stores VSS desde imagenes forenses E01 y dd multiplataforma, sin APIs de Windows."
comments: true
---

## El problema

Los atacantes borran los logs de eventos de Windows. Pero si existen Volume Shadow Copies en el disco, los logs antiguos siguen ahi — congelados en el tiempo dentro de los snapshots. El reto es acceder a ellos:

- **vshadowmount** requiere FUSE y solo funciona en Linux
- **EVTXECmd --vss** requiere la API COM de VSS de Windows y solo funciona en sistemas en vivo
- **Ninguno** puede leer directamente de imagenes forenses E01

## Que es vshadow-rs?

Una libreria y herramienta CLI en **Rust puro** que lee el formato VSS directamente desde cualquier fuente `Read + Seek` — imagenes E01, raw/dd o volcados de particion. Sin APIs de Windows, sin dependencias en C, funciona en Windows, Linux y macOS.

- **Repositorio:** [github.com/jupyterj0nes/vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
- **Crate:** [crates.io/crates/vshadow](https://crates.io/crates/vshadow)
- **Licencia:** MIT / Apache 2.0

## Uso CLI

```bash
# Instalar
cargo install vshadow

# Inspeccionar una imagen forense buscando stores VSS
vshadow-info -f evidence.E01

# Especificar offset de particion manualmente
vshadow-info -f disk.dd --offset 0x26700000
```

La herramienta auto-detecta particiones NTFS via tablas de particiones GPT y MBR, y comprueba cada una en busca de snapshots VSS.

## Uso como libreria

```rust
use vshadow::VssVolume;

let mut reader = /* cualquier Read+Seek: File, BufReader, ewf::EwfReader, etc. */;
let vss = VssVolume::new(&mut reader)?;

for i in 0..vss.store_count() {
    let info = vss.store_info(i)?;
    let mut store = vss.store_reader(&mut reader, i)?;
    // store implementa Read + Seek — pasalo a un parser NTFS
}
```

## Integracion con masstin

[Masstin](/es/tools/masstin-lateral-movement-rust/) utiliza vshadow-rs para extraer ficheros EVTX tanto del volumen activo como de todos los snapshots VSS dentro de imagenes forenses:

```bash
masstin -a parse-image-windows -f evidence.E01 -o timeline.csv
```

Este unico comando abre la imagen, encuentra particiones NTFS, extrae EVTX del volumen activo, detecta stores VSS, extrae EVTX de cada snapshot y genera una timeline unificada de movimiento lateral — incluyendo eventos que fueron borrados del volumen activo pero preservados en las shadow copies.

## Como funciona VSS

Volume Shadow Copy utiliza un mecanismo de copy-on-write:

1. Cuando se crea un snapshot, se registra el estado actual de cada bloque de 16 KiB
2. Cuando un bloque se modifica posteriormente, los datos **antiguos** se copian a un area de almacenamiento antes de la escritura
3. Para reconstruir el snapshot: leer del area de almacenamiento para bloques cambiados, del volumen actual para bloques sin cambios

vshadow-rs parsea las estructuras en disco: cabecera del volumen en offset `0x1E00`, catalogo (lista enlazada de bloques de 16 KiB con metadatos de stores) y descriptores de bloques (entradas de 32 bytes mapeando offsets originales a ubicaciones de datos almacenados).
