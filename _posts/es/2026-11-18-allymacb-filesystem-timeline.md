---
layout: post
title: "allymacb: lo que el sistema de ficheros recuerda"
short: "allymacb: la timeline del sistema de ficheros"
date: 2026-11-18 23:20:00 +0100
category: tools
section: allymacb
order: 10
lang: es
ref: tool-allymacb
tags: [allymacb, mft, usn, macb, timestomping, ntfs, ext4, dfir]
description: "allymacb lee el $MFT, el diario USN y los sistemas de ficheros de Linux y escribe una timeline MACB con las fechas manipuladas señaladas. Un millón y medio de entradas en 35 segundos."
comments: true
---
Los logs se pueden borrar. El sistema de ficheros es más difícil de limpiar, porque apunta cosas en sitios que casi nadie se acuerda de tocar: cada fichero tiene varias fechas guardadas en dos lugares distintos, y además hay un diario que anota cada cambio.

De ahí salen las preguntas que un caso siempre acaba haciendo. ¿Cuándo llegó este fichero? ¿Qué más se creó en ese minuto? ¿Lo borraron? ¿Alguien le cambió la fecha para que pareciera antiguo?

**allymacb** lee esos registros y los pone en una sola timeline.

```bash
allymacb -f disco.E01 -o timeline.csv
```

## Lo que lee

- **NTFS:** el `$MFT` y el diario `$UsnJrnl:$J`.
- **Linux:** ext2/3/4 y XFS, leídos de las estructuras del disco, sueltos o dentro de LVM.
- **Contenedores:** imágenes E01, raw, VMDK y VHD/VHDX; triages de KAPE, Velociraptor y UAC; carpetas sueltas.

Sin montar nada ni extraer antes.

## Una ejecución de verdad

La imagen del servidor de nuestro laboratorio, 50 GB:

```
[i] VMDK: 50.0 GB virtual disk in 1 file(s)
[i] 1 partition(s) with a supported filesystem
[+] $UsnJrnl:$J: 313228 timeline entries
[*] Sorting and writing 1471789 timeline entries (UTC ISO 8601)...

Timeline entries written : 1471789
Elapsed time             : 35.04s
```

Un millón y medio de entradas en 35 segundos, y con cualquier número de hilos la salida es idéntica byte a byte.

## Qué es MACB

Cada fichero tiene cuatro fechas, y la timeline pone una fila por cada instante distinto, con una marca que dice cuáles coinciden en él:

| Letra | Fecha |
|---|---|
| **M** | Modificación del contenido |
| **A** | Último acceso |
| **C** | Cambio del registro (metadatos) |
| **B** | Creación (*birth*) |

Una fila `macb` es un fichero al que le pasó todo en el mismo instante: acaba de nacer. Una fila `m...` es solo una modificación. Leer la columna de letras de arriba abajo es leer lo que le fue pasando al disco.

## Lo que encontró

No le dije qué buscar. Al final de la ejecución, esto:

```
[ALERT] 2 file(s) `significant` by their rules (timestomping, name tricks):
[ALERT]   b_after_c+double_ext   C:\Users\Public\Documents\invoice.pdf.exe  (meta 532164)
```

Un fichero llamado `invoice.pdf.exe`. La doble extensión ya basta para mirarlo. Pero lo interesante son sus fechas, que en la timeline quedan así:

```
2018-09-15T07:12:55  m...  C:\Users\Public\Documents\invoice.pdf.exe   unallocated
2026-11-10T08:32:43  .a.b  C:\Users\Public\Documents\invoice.pdf.exe   unallocated
```

Según la fecha de modificación, el fichero es de **2018**. Según la de creación, llegó a este disco el **10 de noviembre de 2026**. Las dos no pueden contar la misma historia. Alguien le puso una fecha vieja para que, ordenando la carpeta por fecha, no llamara la atención.

Y `unallocated`: el fichero está borrado. Su registro sigue en el `$MFT` porque nada lo ha reutilizado todavía.

O sea, un ejecutable disfrazado de PDF, con la fecha falseada, borrado después. allymacb lo saca arriba con una puntuación de 70 y la explicación al lado:

```
rule double_ext (high): a document extension followed by an executable one;
rule b_after_c (medium): $SI creation after the record change time;
2 of the 1351 records changed in 2026-11-10T08 carry double_ext and no clean hour has that pattern
```

## Lo que se creó en ese segundo

Aquí es donde una timeline vale más que una alerta. Filtras por esa hora y miras alrededor:

```
2026-11-10T08:32:43.677  macb  C:\Users\Public\update.bat
2026-11-10T08:32:43.755  .a.b  C:\Users\Public\Documents\invoice.pdf.exe
```

Setenta y ocho milésimas antes nace `update.bat` en `C:\Users\Public`. Ese `.bat` es el mismo que [faramir](/es/tools/faramir-persistence/) encuentra, en esa misma imagen, lanzado por una clave Run y por una tarea programada.

Dos herramientas, dos fuentes de evidencia que no tienen nada que ver entre sí, y el mismo fichero. El registro dice que se va a ejecutar en cada arranque; el sistema de ficheros, cuándo llegó y con qué venía.

## Cómo detecta las fechas falsas

NTFS guarda las fechas de cada fichero dos veces: en `$STANDARD_INFORMATION`, que es lo que enseña el Explorador y lo que cualquier herramienta puede cambiar, y en `$FILE_NAME`, que solo toca el sistema. Las herramientas de *timestomping* cambian la primera y dejan la segunda. Comparándolas se ve la costura.

allymacb tiene doce reglas de ese estilo:

- `$SI` anterior a `$FILE_NAME`.
- Fechas con los segundos exactos, sin fracción. Las herramientas suelen escribir segundos redondos; el sistema, casi nunca.
- Cambios que el diario USN vio y que las fechas niegan.
- Trucos de nombre: doble extensión, caracteres de escritura de derecha a izquierda.

Lo que las hace útiles es que **el peso de cada regla está medido**, en máquinas Windows y Linux limpias. Porque `$SI` anterior a `$FILE_NAME` también le pasa a miles de ficheros legítimos: cualquier instalador que conserva la fecha original del fabricante lo produce.

## El hunt, y por qué necesita pasado

Además de las reglas hay un hunt estadístico, con el mismo método que [el de masstin](/es/tools/masstin-graph-hunt/): le das la fecha en la que empezó el incidente y compara lo tocado desde entonces con todo lo que el volumen hizo antes.

```bash
allymacb -f disco.E01 --investigation-from 2026-11-03 --hunt-out hunt.csv -o timeline.csv
```

Aquí toca ser honrado con el resultado:

```
records: 3606 significant, 13474 candidate, 7962 habitual, 494260 baseline
```

3 606 registros significativos son demasiados para leerlos. Y al clasificarlos por carpeta, casi todos son lo mismo: 1 268 están en `WinSxS`, 346 en `servicing` y 1 157 en `Program Files`. Son actualizaciones de Windows y software instalado esa semana, con las fechas de fábrica de cada fichero.

El motivo está escrito en la propia explicación: *«on 0 of 1 days»*. El laboratorio solo tiene **un día** de actividad normal antes de la fecha que le di. Con un día de referencia, cualquier instalación de software es algo que «no había pasado nunca».

No es un fallo de la herramienta. Es lo que pasa cuando se le pide estadística sin pasado, y por eso las dos cosas van separadas: las **reglas** funcionan sin referencia y dieron dos ficheros, los dos correctos. El **hunt** necesita semanas, igual que en masstin.

Lo que sí hace bien incluso aquí es apartar la instalación del sistema:

```
p1 $MFT: installed from 2026-10-26T03:37:07Z to 2026-10-26T05:59:59Z, 493053 of 519302 records
87332 file(s) installed with their volume: the rules that fired on them add nothing
```

De 519 302 registros, 493 053 son de las dos horas y media en que se instaló Windows. allymacb lo deduce del propio volumen y los marca como referencia. Si no, cada fichero del sistema operativo sería una alerta.

## Recuperar lo borrado

Con `--carve` lee cada sector buscando registros antiguos del `$MFT` y entradas de índice `$I30`. En ext4 reproduce el diario para poner nombre a los ficheros borrados, y recupera líneas de log y registros de `utmp` del espacio libre.

```bash
allymacb -f disco.E01 --carve -o timeline.csv
```

Es lento, porque lee el disco entero, y es para cuando sospechas que se borró algo o que el volumen se formateó.

## La salida

Las 19 columnas de masstin, cada una en la posición de la que más se le parece, y las mismas cinco del final: `hunt`, `hunt_score`, `hunt_why`, `verdict` y `notes`. Movimiento lateral, persistencia y sistema de ficheros de un mismo caso se leen uno al lado del otro.

Por la salida estándar no sale nada más que el CSV, así que se puede encadenar:

```bash
allymacb -f '$MFT' | grep ',unallocated,' > borrados.csv
```

El minuto completo, visto por las cuatro herramientas a la vez, está en [Cómo se lee un caso](/es/tools/case-four-timelines/).

El código y la documentación completa están en [GitHub](https://github.com/jupyterj0nes/allymacb).
