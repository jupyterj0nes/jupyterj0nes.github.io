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

![vshadow-rs logo](/assets/images/vshadow-rs-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 400px;" }

## El problema

Los atacantes borran los logs de eventos de Windows. Pero si existen Volume Shadow Copies en el disco, los logs antiguos siguen ahí — congelados en el tiempo. El reto: las herramientas existentes no permiten acceder fácilmente.

| Herramienta | Limitación |
|-------------|-----------|
| **vshadowmount** | Requiere FUSE, solo Linux |
| **EVTXECmd --vss** | Requiere API COM de VSS de Windows, solo sistemas en vivo |
| **Ambas** | No pueden leer de imagenes forenses E01 directamente |

## ¿Qué es vshadow-rs?

Una librería y herramienta CLI en **Rust puro** que lee el formato VSS directamente desde imágenes E01, raw/dd, de partición o volúmenes montados. Sin APIs de Windows, sin dependencias en C, funciona en Windows, Linux y macOS.

Su logo es [Ferris](https://rustacean.net/) (el cangrejo de Rust) con casco de minero — un guiño a los mineros del carbón de [León](https://es.wikipedia.org/wiki/Provincia_de_Le%C3%B3n), que excavaban capas de oscuridad para sacar a la superficie lo que estaba oculto.

- **Repositorio:** [github.com/jupyterj0nes/vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
- **Crate:** [crates.io/crates/vshadow](https://crates.io/crates/vshadow)
- **Licencia:** AGPL-3.0

---

## Características principales

| Característica | Descripción |
|----------------|-------------|
| Inspeccionar stores VSS | Listar todos los snapshots con GUIDs, fechas de creación y tamaño del delta |
| Listar ficheros | Navegar directorios NTFS dentro de cualquier store VSS o del volumen activo |
| **Detección de delta** | Comparar snapshots VSS contra el volumen activo — encontrar ficheros borrados y modificados |
| **Timelines MACB** | Generar timelines forenses del delta con precisión completa de timestamps NTFS |
| Extraer ficheros | Extraer ficheros de stores VSS a disco — recuperar logs de eventos borrados |
| Soporte E01 | Lee directamente de imagenes Expert Witness Format, sin ewfmount |
| **Volúmenes montados** | Lee directamente desde letras de unidad (`C:`), dispositivos de bloque (`/dev/sda2`) o puntos de montaje (`/mnt/evidence`) — sin necesidad de crear una imagen primero |
| Detección automática de particiones | Encuentra particiones NTFS automáticamente vía GPT y MBR |
| Multiplataforma | Windows, Linux y macOS — binario único, cero dependencias |
| Librería + CLI | Usable como crate Rust o como herramienta de línea de comandos |

---

## Instalar

### Descargar binario pre-compilado (recomendado)

> **No necesitas Rust.** Solo descarga y ejecuta.

| Plataforma | Descarga |
|------------|----------|
| Windows | [`vshadow-rs-windows.exe`](https://github.com/jupyterj0nes/vshadow-rs/releases/latest) |
| Linux | [`vshadow-rs-linux`](https://github.com/jupyterj0nes/vshadow-rs/releases/latest) |
| macOS | [`vshadow-rs-macos`](https://github.com/jupyterj0nes/vshadow-rs/releases/latest) |

Ve a [**Releases**](https://github.com/jupyterj0nes/vshadow-rs/releases) y descarga el binario para tu plataforma. Nada más.

### Compilar desde el código fuente (alternativa)

```bash
cargo install vshadow
```

---

## Uso CLI

Todos los comandos aceptan imágenes forenses (E01, dd/raw) **y volúmenes montados/discos** (letras de unidad en Windows, dispositivos `/dev/` o puntos de montaje en Linux/macOS).

### Inspeccionar: encontrar stores VSS

```bash
# Desde imagen forense
vshadow-rs info -f evidence.E01

# Desde volumen montado (Windows — requiere Administrador)
vshadow-rs info -f C:

# Desde dispositivo de bloque (Linux — requiere root)
sudo vshadow-rs info -f /dev/sda2
sudo vshadow-rs info -f /mnt/evidence
```

<img src="/assets/images/vshadow-rs-volume.png" alt="vshadow-rs leyendo desde volumen montado C:" width="700">

### Listar: navegar ficheros en un store VSS o volumen activo

```bash
# Volumen activo
vshadow-rs list -f evidence.E01 --live -p "Windows/System32/winevt/Logs"

# Store VSS 0
vshadow-rs list -f evidence.E01 -s 0 -p "Windows/System32/winevt/Logs"
```

### List-delta: encontrar qué cambió entre VSS y el volumen activo

Esto es lo que hace único a vshadow-rs. Compara el filesystem del snapshot contra el volumen activo y muestra solo los ficheros que fueron **borrados** o **modificados**.

```bash
# Mostrar delta de todos los stores VSS
vshadow-rs list-delta -f evidence.E01

# Enfocarse solo en los logs de eventos
vshadow-rs list-delta -f evidence.E01 -p "Windows/System32/winevt/Logs"

# Exportar delta a CSV
vshadow-rs list-delta -f evidence.E01 -o delta.csv
```

<img src="/assets/images/vshadow-rs-list-delta.png" alt="vshadow-rs list-delta output" width="700">

La salida muestra cada fichero modificado con su tamaño en el volumen activo vs. el store VSS, haciendo inmediatamente obvio cuándo los logs han sido borrados.

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

### Flujo de trabajo forense típico

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

## Qué hace único a vshadow-rs

1. **Detección de delta** (`list-delta`): ninguna otra herramienta compara snapshots VSS contra el volumen activo para mostrar exactamente qué cambió. Es la forma más rápida de encontrar logs borrados, ficheros eliminados y evidencia manipulada.

2. **Timelines MACB desde las sombras** (`timeline`): genera timelines forenses del delta — solo los cambios relevantes, no el filesystem completo.

3. **Soporte E01 directo**: lee imágenes forenses sin montar, convertir ni extraer.

4. **Soporte de volúmenes montados / discos en vivo**: apunta vshadow-rs a una letra de unidad (`C:`, `D:`), un dispositivo de bloque (`/dev/sda2`) o un punto de montaje (`/mnt/evidence`) y lee el volumen raw directamente. Sin necesidad de crear una imagen primero — ideal para triage o cuando se trabaja con un bloqueador de escritura.

5. **Rust puro, multiplataforma**: sin FUSE, sin APIs de Windows, sin bibliotecas C. Funciona en cualquier SO.

6. **Librería + CLI**: usa el crate `vshadow` en tus propias herramientas Rust, o usa el binario `vshadow-rs` desde la línea de comandos.

---

## Comparación con herramientas existentes

| Funcionalidad | libvshadow (C) | vshadowmount | vshadowinfo | **vshadow-rs** |
|---------------|:---:|:---:|:---:|:---:|
| Lenguaje | C | C (libvshadow) | C (libvshadow) | **Rust** |
| Listar stores VSS | Sí | No | Sí | **Sí** |
| Mostrar GUIDs, fechas | Sí | No | Sí | **Sí** |
| Mostrar tamaño del delta | No | No | No | **Sí** |
| Montar como filesystem FUSE | No | Sí | No | No |
| **Listar ficheros en store VSS** | No | Vía mount | No | **Sí** |
| **Extraer ficheros de VSS** | No | Vía mount | No | **Sí** |
| **Comparar VSS vs live (delta)** | No | No | No | **Sí** |
| **Timeline MACB del delta** | No | No | No | **Sí** |
| **Listar ficheros en volumen activo** | No | No | No | **Sí** |
| **Leer E01 directamente** | No | No | No | **Sí** |
| **Leer volúmenes montados / discos en vivo** | No | No | No | **Sí** |
| **Detectar particiones GPT/MBR** | No | No | No | **Sí** |
| Sin dependencias en C | No | No | No | **Sí** |
| Sin FUSE | Sí | No | Sí | **Sí** |
| Multiplataforma | Linux/Mac | Solo Linux | Linux/Mac/Win | **Win/Linux/Mac** |

> **libvshadow** es la biblioteca de referencia en C de Joachim Metz. vshadowmount y vshadowinfo son sus herramientas CLI. vshadow-rs es una implementación completamente independiente en Rust — no utiliza libvshadow.

---

## Cómo funciona VSS

Volume Shadow Copy utiliza un mecanismo de copy-on-write a nivel de bloques (16 KiB):

1. **Creación de snapshot**: el catálogo registra los metadatos (GUID, timestamp)
2. **Modificación de bloque**: cuando un bloque va a ser sobreescrito, los datos **antiguos** se copian a un área de almacenamiento primero
3. **Reconstrucción**: leer del store para bloques cambiados, del volumen activo para bloques sin cambios

vshadow-rs parsea las estructuras en disco: cabecera a `0x1E00`, catálogo (lista enlazada de bloques de 16 KiB) y descriptores de bloques (entradas de 32 bytes mapeando offsets originales a datos almacenados).

---

## Uso como biblioteca

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

## Integración con masstin

[Masstin](/es/tools/masstin-lateral-movement-rust/) utiliza vshadow-rs para procesar imagenes forenses con un solo comando:

```bash
masstin -a parse-image-windows -f evidence.E01 -o timeline.csv
```

Esto extrae EVTX tanto del volumen activo como de todos los snapshots VSS, generando una timeline unificada de movimiento lateral que incluye eventos que el atacante borró.

---

## Trabajo futuro

- **Soporte VMDK / VHD / VHDX**: leer VSS desde imágenes de disco de máquinas virtuales directamente
- **Delta multi-store**: comparar entre múltiples snapshots VSS para construir un historial completo de cambios
- **Recuperación de ficheros borrados**: detectar y recuperar ficheros eliminados entre snapshots usando análisis de MFT
- **Integración con Plaso/log2timeline**: exportar timelines en formatos compatibles con toolchains DFIR existentes
- **Soporte AFF4**: leer desde imágenes forenses AFF4
