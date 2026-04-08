---
layout: post
title: "vshadow-rs: Parser VSS en Rust puro para imagenes forenses"
date: 2026-04-08 10:00:00 +0100
category: tools
lang: es
ref: tool-vshadow
tags: [vshadow, vss, shadow-copy, forensics, dfir, rust, herramientas]
description: "Parser en Rust puro para snapshots de Volume Shadow Copy (VSS) de Windows. Inspecciona, lista y extrae ficheros de stores VSS en imagenes forenses E01 y dd, multiplataforma."
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
| Inspeccionar stores VSS | Listar todos los snapshots con GUIDs, fechas de creacion y tamanos |
| Listar ficheros | Navegar directorios NTFS dentro de cualquier store VSS o del volumen activo |
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
vshadow-info info -f evidence.E01
```

### Listar: navegar ficheros en un store VSS o volumen activo

```bash
# Volumen activo
vshadow-info list -f evidence.E01 --live -p "Windows/System32/winevt/Logs"

# Store VSS 0
vshadow-info list -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs"
```

### Extraer: recuperar ficheros de stores VSS

```bash
# Extraer del store VSS 0 (recuperar logs de eventos borrados)
vshadow-info extract -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recuperados/

# Extraer del volumen activo
vshadow-info extract -f evidence.E01 --live -p "Windows/System32/winevt/Logs" -o ./evtx_live/
```

### Flujo de trabajo forense tipico

```bash
# 1. Comprobar si hay stores VSS
vshadow-info info -f suspect.E01

# 2. Comparar tamanos entre live y snapshot (borrado = fichero mas pequeno)
vshadow-info list -f suspect.E01 --live -p "Windows/System32/winevt/Logs"
vshadow-info list -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs"

# 3. Extraer los logs previos al borrado desde VSS
vshadow-info extract -f suspect.E01 -s 0 -p "Windows/System32/winevt/Logs" -o ./recuperados/

# 4. Parsear los logs recuperados con masstin
masstin -a parse-windows -d ./recuperados/ -o timeline.csv
```

---

## Comparacion con herramientas existentes

| Funcionalidad | vshadowmount | vshadowinfo | **vshadow-info** |
|---------------|-------------|-------------|-----------------|
| Listar stores VSS | No | Si | **Si** |
| Mostrar GUIDs, fechas | No | Si | **Si** |
| Montar como filesystem FUSE | Si | No | No |
| **Listar ficheros en store VSS** | Via mount | No | **Si** |
| **Extraer ficheros de VSS** | Via mount | No | **Si** |
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
