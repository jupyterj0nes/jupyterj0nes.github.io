---
layout: post
title: "merge: juntar timelines sin perder tus notas"
short: "merge y carry-marks"
date: 2026-11-18 22:00:00 +0100
category: tools
section: masstin-read
order: 90
lang: es
ref: tool-masstin-merge
tags: [masstin, merge, timeline, notas, dfir]
description: "La acción merge de masstin une varias timelines en una, ordenada y sin duplicados, y con --carry-marks conserva los veredictos y las notas cuando vuelves a analizar la evidencia."
comments: true
---
Un caso rara vez llega entero. El lunes tienes los logs de dos servidores. El miércoles llegan tres imágenes de disco. El viernes alguien encuentra los logs de la VPN. Cada entrega es una timeline, y lo que quieres es una sola.

```bash
masstin -a merge -f lunes.csv -f miercoles.csv -f vpn.csv -o caso.csv
```

El resultado está ordenado por instante y sin duplicados. Si el mismo evento está en dos timelines, porque el miércoles volvieron a recoger un servidor del lunes, sale una vez.

## Formatos de cualquier época

masstin ha ido añadiendo columnas con los años: empezó con 12, pasó a 14 y hoy escribe 19. `merge` lee las tres disposiciones y escribe siempre las 19. Una timeline de hace dos años se mezcla con una de hoy sin convertir nada.

De las 19, las 14 primeras describen el evento (cuándo, desde dónde, a dónde, con qué cuenta) y las cinco últimas son para el análisis. Están todas, una por una, en [el formato CSV](/es/tools/masstin-csv-format/).

Las columnas del final (`hunt`, `hunt_score`, `hunt_why`, `verdict`, `notes`) viajan con su fila. Y si el mismo evento viene una vez con ellas y otra sin ellas, se conservan.

## El problema que resuelve --carry-marks

Este es el motivo por el que existe el artículo.

Llevas tres días con un caso. Has marcado conexiones como sospechosas, has escrito notas, has descartado otras como benignas. Todo eso está en las columnas `verdict` y `notes` de tu timeline.

Entonces llega más evidencia, o sale una versión de masstin que lee un evento nuevo, y hay que volver a analizar. La timeline nueva sale limpia, sin una sola marca. Tres días de trabajo, en el fichero viejo.

```bash
masstin -a merge -f nueva1.csv -f nueva2.csv -o caso-v2.csv --carry-marks caso-v1.csv
```

`--carry-marks` copia los veredictos y las notas de la timeline anterior a las filas que corresponden en la nueva. Una fila corresponde cuando sus 14 columnas de evento son iguales, es decir, cuando es el mismo evento. La consola dice cuántas:

```
Merge: 23 row(s) took their verdict / notes from the earlier timeline (23 marked rows there)
```

Hay que comparar dos números de esa línea. El primero (`23 row(s) took...`) son las filas de la nueva que han recibido su marca. El del paréntesis (`23 marked rows there`) son las filas marcadas que había en la vieja. Aquí son iguales: veintitrés marcadas y veintitrés recuperadas. Si el primero fuera 19 y el segundo 23, cuatro marcas no han encontrado su fila, casi siempre porque esa evidencia no está en el análisis nuevo.

En el ejemplo, la timeline anterior es la del laboratorio con una conexión marcada como sospechosa desde el [visor](/es/tools/masstin-viewer-marks-case/). La nueva es la misma evidencia más las filas de otra tarde. Las marcas pasan, y las filas nuevas llegan sin marca, como debe ser.

La misma opción existe en el hunt (`graph-hunt-csv --carry-marks`), para lo mismo.

## Con una sola timeline

`merge` pide dos ficheros, salvo cuando le pides que cambie algo. Con un filtro o con `--carry-marks`, una basta:

```bash
# refiltrar una timeline ya hecha
masstin -a merge -f caso.csv --ignore-local -o caso-filtrado.csv

# pasar las marcas de la versión anterior
masstin -a merge -f caso-nuevo.csv --carry-marks caso-viejo.csv -o caso-nuevo-marcado.csv
```

Lo primero está explicado en [filtrar el ruido](/es/tools/masstin-noise-filtering/).

## Lo que te cuenta al terminar

```
Merge: 11065 rows written; skipped 0 malformed (wrong column count),
       0 unparseable time, 0 outside window, 19666 filtered, 0 duplicate
```

Cada fila que no llega al resultado tiene un motivo y un contador. *Malformed* es una fila con un número de columnas que no cuadra, casi siempre un CSV que alguien abrió y guardó con una hoja de cálculo. Si ese número no es cero, hay que mirar por qué antes de seguir.

## Acotar en el tiempo

`merge` acepta `--start-time` y `--end-time`. Sirve para sacar de una timeline de seis meses solo las dos semanas del incidente, para compartirla o para trabajar con algo más ligero.

Las dos se escriben como `"AAAA-MM-DD HH:MM:SS"`, entre comillas y en UTC. También vale una fecha sola: en `--start-time` cuenta desde su primer segundo y en `--end-time` hasta el último, así que el día entra entero.

## El fichero que acompaña

Al escribir la timeline, masstin deja a su lado un `<nombre>.masstin` con lo que sabe de ella: de qué evidencia salió y de quién es cada dirección. Al mezclar, esa información se conserva.

No hay que pasárselo a ninguna orden: masstin lo busca al lado de la timeline, con su mismo nombre. Lo único que tienes que hacer es no separarlos. Si copias o mueves el CSV, llévate también su `.masstin`.

Es el mismo fichero que el visor usa [como fichero de caso](/es/tools/masstin-viewer-marks-case/).
