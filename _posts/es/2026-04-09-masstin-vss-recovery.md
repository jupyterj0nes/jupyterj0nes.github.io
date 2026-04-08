---
layout: post
title: "Recuperando logs de eventos borrados desde Volume Shadow Copies con Masstin"
date: 2026-04-09 01:00:00 +0100
category: tools
lang: es
ref: tool-masstin-vss-recovery
tags: [masstin, vss, shadow-copy, forensics, dfir, evtx, herramientas]
description: "Como masstin extrae ficheros EVTX tanto del volumen activo como de snapshots de Volume Shadow Copy dentro de imagenes forenses, recuperando logs borrados por atacantes."
comments: true
---

## El escenario

Un atacante compromete un servidor Windows, se mueve lateralmente por la red, y antes de irse — borra el log de eventos de Security. Cuando el analista forense recibe la imagen de disco, el Security.evtx del volumen activo esta casi vacio.

Pero las Volume Shadow Copies preservan los datos antiguos. Si System Protection estaba habilitado, los logs de eventos previos al borrado siguen en disco, congelados dentro de un snapshot VSS.

El reto siempre ha sido acceder a ellos: montar imagenes, ejecutar vshadowmount en Linux, extraer ficheros manualmente, luego parsearlos. Multiples herramientas, multiples pasos, facil de pasar por alto.

**Masstin lo hace todo en un solo comando.**

## Un comando, recuperacion completa

```bash
masstin -a parse-image-windows -f HRServer_Disk0.e01 -o timeline.csv
```

Este unico comando:

1. **Abre la imagen forense** (E01 o dd/raw)
2. **Encuentra particiones NTFS** automaticamente (GPT y MBR)
3. **Extrae EVTX** del volumen activo
4. **Detecta snapshots VSS** usando el crate [vshadow-rs](/es/tools/vshadow-rs/)
5. **Extrae EVTX de cada store VSS** — recuperando logs borrados
6. **Deduplica** eventos que existen en ambos (live y VSS)
7. **Genera una timeline unificada** con todos los eventos clasificados

![Salida de masstin parse-image-windows](/assets/images/masstin_cli_parse_image.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

## Ejemplo

Procesando una imagen E01 de 50 GB de un Windows Server donde el atacante habia borrado los logs de eventos:

| Metrica | Resultado |
|---------|-----------|
| Tamano de imagen | 50.00 GB |
| Particion NTFS | 1 (offset 0x1F500000) |
| Snapshots VSS | 1 (creado 2018-08-07, 149.9 MB delta) |
| EVTX del volumen activo | 296 ficheros |
| EVTX del store VSS | 128 ficheros |
| Total tras dedup | 424 EVTX unicos |
| Eventos del live | 6,947 |
| Eventos recuperados del VSS | 34,586 |
| **Total eventos unicos** | **41,533** |
| Duplicados eliminados | 1,406 |
| **Tiempo de procesamiento** | **~5 segundos** |

El snapshot VSS contenia **34,586 eventos que ya no estaban en el volumen activo** — incluyendo el Security.evtx con el historial completo de autenticacion que el atacante habia borrado.

## Trazabilidad del origen

Cada evento en el CSV de salida incluye un `log_filename` descriptivo que indica exactamente de donde viene:

```
HRServer_Disk0.e01:live:Security.evtx          <- del volumen activo actual
HRServer_Disk0.e01:vss_0:Security.evtx         <- recuperado del snapshot VSS 0
```

Esto permite al analista distinguir inmediatamente entre evidencia actual y evidencia recuperada, y saber exactamente que store VSS proporciono cada evento.

## Multiples imagenes a la vez

Para incidentes a gran escala o investigaciones de ransomware, apunta masstin a multiples imagenes forenses:

```bash
masstin -a parse-image-windows \
  -f DC01.e01 \
  -f SRV-FILE.e01 \
  -f WS-ADMIN.e01 \
  -o full-incident-timeline.csv
```

Cada imagen se procesa independientemente: particiones detectadas, snapshots VSS enumerados, EVTX extraidos y deduplicados. El resultado es una unica timeline que abarca todas las maquinas — incluyendo eventos recuperados de shadow copies de cada servidor.

## Detalle de logons fallidos

Cuando masstin encuentra un logon fallido (Event 4625), la columna `detail` muestra una descripcion legible:

| detail | Significado |
|--------|-------------|
| `Wrong password (0xC000006A)` | Contrasena incorrecta |
| `User does not exist (0xC0000064)` | Cuenta no encontrada |
| `Account locked out (0xC0000234)` | Demasiados intentos fallidos |
| `Account disabled (0xC0000072)` | Cuenta deshabilitada |
| `Expired password (0xC0000071)` | Contrasena expirada |

## Como funciona

Masstin utiliza el crate [vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs) (Rust puro, multiplataforma) para acceder a snapshots VSS directamente desde imagenes forenses:

1. **E01/dd -> Read+Seek**: el crate `ewf` proporciona acceso transparente a imagenes E01
2. **Deteccion de particiones**: tablas GPT y MBR parseadas para encontrar volumenes NTFS
3. **Deteccion VSS**: lee la cabecera VSS en offset `0x1E00` de la particion
4. **Mapeo de block descriptors**: identifica que bloques de 16 KiB cambiaron desde el snapshot
5. **Reconstruccion del snapshot**: superpone bloques almacenados sobre el volumen activo
6. **Recorrido NTFS**: navega `Windows\System32\winevt\Logs\` tanto en live como en snapshot
7. **Deduplicacion**: elimina eventos duplicados, prefiriendo el volumen activo

Sin montar. Sin FUSE. Sin APIs de Windows. Funciona en Windows, Linux y macOS.

---

## Documentacion relacionada

| Tema | Enlace |
|------|--------|
| Masstin — pagina principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| vshadow-rs — parser VSS | [vshadow-rs](/es/tools/vshadow-rs/) |
| Formato CSV y clasificacion de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
