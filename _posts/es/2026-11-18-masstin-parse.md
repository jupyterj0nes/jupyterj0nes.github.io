---
layout: post
title: "masstin parse: una sola orden para cualquier evidencia"
short: "parse: una sola orden para cualquier evidencia"
date: 2026-11-18 20:00:00 +0100
category: tools
section: masstin-read
order: 10
lang: es
ref: tool-masstin-parse
tags: [masstin, parse, evtx, triage, imagen-forense, dfir]
description: "La acción parse de masstin mira lo que le das (carpetas, imágenes de disco, triages, logs de Linux y macOS), dice qué ha encontrado y lo lee todo de una pasada."
comments: true
---
masstin tuvo durante mucho tiempo un analizador por tipo de evidencia: uno para carpetas de EVTX, otro para imágenes de disco, otro para Linux, otro para «todo mezclado». Funcionaba, pero obligaba a saber de antemano qué tenías entre manos, y en un caso de verdad eso casi nunca está claro. Te llega un disco USB con una carpeta que se llama `evidencias_final_v2` y dentro hay de todo.

Ahora hay una sola orden:

```bash
masstin -a parse -d /evidencia/caso -o timeline.csv
```

`-d` es una carpeta, que se recorre entera. `-f` es un fichero, y solo se lee ese. Se pueden repetir y mezclar.

## Primero mira

Lo primero que hace `parse` es contar lo que le has dado. Esto es el caso de nuestro laboratorio, tal cual lo recogimos:

```
Found: 1 disk image, 4 triage packages (KAPE), 19 EVTX files, 2 Linux triages
       (26 files in 6 folders, 1.4 s)
=> Windows and Linux evidence, disk images and archives -> read in one pass
Disk images: --carve also carves the EVTX records of deleted or overwritten logs out of them
```

Una imagen de disco, cuatro triages de KAPE comprimidos, una carpeta con EVTX sueltos y dos triages de Linux. Cuatro formatos distintos, y la orden es la misma que si fuera una carpeta con un solo `Security.evtx`.

Reconoce: ficheros EVTX y ZIP de EVTX, bases de datos UAL, triages de KAPE, Velociraptor, Cortex XDR y UAC, imágenes de disco (E01, VMDK, VHD/VHDX, dd), logs y triages de Linux, `.logarchive` de macOS, JSON de Winlogbeat y timelines de masstin ya hechas.

## Después lo lee todo

```
=> Image 1/1: dev-srv01.vmdk (VMDK, 50.0 GB)
   Partitions: 1 NTFS, 1 VSS
   Extracted: 664 EVTX + 2 UAL + 3 Tasks + 7 NTUSER.DAT
=> Linux evidence found: 2 archive(s), 0 log file(s)
=> Triage found: KAPE
   source: triage-windows/dev-dc01-triage.zip
   entries inside: 338
...
=> 2002 EVTX artifacts found total
=> 2 UAL databases found
```

De la imagen de 50 GB saca los logs del sistema de ficheros, y también los de la copia de sombra que encuentra. Abre los ZIP, estén anidados o no. Y junta Windows y Linux en la misma timeline.

Al terminar, el desglose por origen:

```
=> [IMAGE]  dev-srv01.vmdk  (28911 events total)
   - Security.evtx (13614)
   - Microsoft-Windows-SmbClient%4Connectivity.evtx (713)
   - OpenSSH%4Operational.evtx (111)
   - Security.evtx (13586)  [VSS]
   ...
=> [FOLDER]  evtx/ptr-srv01  (1325 events total)
=> [TRIAGE: KAPE]  triage-windows/dev-dc01-triage.zip  (6060 events total)
=> [TRIAGE: KAPE]  triage-windows/dev-srv01-triage.zip  (2756 events total)
```

Este desglose es más útil de lo que parece. Te dice de qué máquina no has sacado nada (y entonces te falta evidencia o el log estaba vacío), y qué logs aportan: aquí se ve que el `Security.evtx` de la copia de sombra trae casi los mismos eventos que el actual. Los duplicados se quitan solos al final.

El resultado de este caso: 30 731 filas en una timeline.

## Lo que no adivina

Hay dos cosas que `parse` no puede saber por sí mismo, y son opciones:

**`--rules`**, para los logs que masstin no conoce. Una VPN, un cortafuegos, un proxy:

```bash
masstin -a parse -d /evidencia/caso -f fortigate-vpn.log --rules rules/vpn -o timeline.csv
```

Los ficheros dados con `-f` que no reconoce se leen con esas [reglas YAML](/es/tools/masstin-custom-parsers/), y sus filas entran en la misma timeline.

**`--carve`**, para recuperar eventos de logs borrados o sobrescritos:

```bash
masstin -a parse -d /evidencia/caso --carve -o timeline.csv
```

Además de leer los logs, recorre cada byte de las imágenes buscando registros EVTX sueltos. Es lento (una VMDK de 25 GB, unos ocho minutos) y por eso no va por defecto, pero la consola te recuerda que existe cuando hay imágenes. Solo añade lo que no estaba ya en los logs vivos, y dice cuánto:

```
Carving: 13755 event(s), 13753 already in the live logs, 2 recovered
```

Dos eventos recuperados de trece mil. En un caso donde alguien limpió el log, esos dos pueden ser el caso entero. El detalle está en [el artículo de carving](/es/tools/evtx-carving-unallocated/).

## Timelines dentro de la carpeta

Un detalle para no llevarse sorpresas. Si en la carpeta de evidencia hay timelines de masstin de una ejecución anterior, `parse` **no las mezcla**: las nombra en la consola y las deja fuera. Si quieres incluir una, se la das con `-f`.

Tiene sentido. Lo contrario sería que cada ejecución arrastrara la salida de la anterior.

## Cuando no hay nada

Si no encuentra nada que conozca, se para y lo dice. Si lo que encuentra no da ningún evento, no escribe un CSV vacío: lo dice también.

## ¿Y los analizadores de antes?

Siguen ahí: `parse-windows`, `parse-image`, `parse-linux`, `parse-mac`, `parse-massive`. `parse` está hecho de ellos. Sirven para quien ya sabe qué es la evidencia y no quiere la mirada previa, como un script que siempre recibe lo mismo.

Una diferencia a tener en cuenta: `carve-image` por su cuenta da todos los eventos tallados, también los que ya están en los logs vivos. `parse --carve` se queda solo con lo recuperado.

## Desde la ventana

Lo mismo, sin terminal, en el [asistente de ingesta](/es/tools/masstin-viewer-ingest/). La «mirada» del primer paso del asistente es esta misma.
