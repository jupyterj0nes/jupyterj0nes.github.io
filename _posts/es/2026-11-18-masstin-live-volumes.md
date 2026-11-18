---
layout: post
title: "Leer un disco montado, sin hacer la imagen"
short: "Volúmenes montados y sistemas en vivo"
date: 2026-11-18 20:30:00 +0100
category: tools
section: masstin-read
order: 30
lang: es
ref: tool-masstin-live-volumes
tags: [masstin, triage, vss, bloqueador-escritura, respuesta-incidentes, dfir]
description: "masstin lee el volumen en bruto de una unidad montada o de un sistema en vivo, con sus copias de sombra, sin crear antes una imagen forense."
comments: true
---
Hacer la imagen de un disco de un terabyte lleva horas. Hay casos en los que esas horas no las tienes: el cliente quiere saber *ahora* si el atacante pasó de ese servidor a los demás, y la respuesta está en unos logs que ocupan unos cientos de megas.

masstin puede leerlos directamente del volumen:

```bash
masstin -a parse-image -d D: -o timeline.csv
```

Le das la letra de la unidad y lee el volumen en bruto. No pasa por el sistema de ficheros de Windows, y por eso da igual que los logs estén abiertos y bloqueados por el servicio de eventos.

## Dos situaciones

**El disco está en un bloqueador de escritura.** Lo has sacado de la máquina, lo conectas a tu equipo de análisis por un bloqueador y aparece como `E:`. En lugar de esperar a la imagen, o mientras la haces en otra ventana, lees los logs.

**El sistema está encendido.** Estás en el servidor, o conectado a él, y lees su propio disco `C:`. Es triage en vivo: en un par de minutos tienes la timeline de esa máquina.

## Con las copias de sombra

Esto es lo que lo distingue de copiar la carpeta `winevt\Logs` a mano. masstin lee también **todas las copias de sombra (VSS)** que haya en el volumen.

Los logs de una copia de sombra de hace dos semanas pueden contener lo que el atacante borró ayer. Es una de las formas más baratas de recuperar eventos, y sale sola, sin pedirla. Lo explico en [el artículo de VSS](/es/tools/masstin-vss-recovery/).

## Varios volúmenes

```bash
# dos unidades
masstin -a parse-image -d D: -d E: -o timeline.csv

# todos los volúmenes NTFS del sistema
masstin -a parse-image --all-volumes -o timeline.csv
```

`--all-volumes` es para cuando no sabes en cuál está Windows, o cuando llegas a un servidor con seis discos y no quieres ir preguntando.

## Lo que hay que saber

**Hacen falta privilegios.** Leer un volumen en bruto requiere ejecutar como Administrador en Windows, o con `sudo` en Linux. Sin eso, el sistema no te deja abrir el dispositivo.

**En vivo, modificas la máquina.** Poco, pero algo: ejecutar cualquier programa en un sistema encendido deja rastro (el propio prefetch de masstin, por ejemplo). Si el caso puede acabar en un juzgado, apúntalo en tus notas y, cuando puedas, haz también la imagen. masstin lee, no escribe en el volumen; el CSV de salida ponlo en otra unidad.

**Una trampa de PowerShell.** No termines una ruta con `\` dentro de comillas simples: PowerShell lo interpreta como un escape de la comilla y estropea los argumentos. masstin lo detecta y avisa, pero lo más seguro es no poner la barra final, o usar comillas dobles.

## Cuándo hacer la imagen de todas formas

Esto no sustituye a la imagen. La timeline de masstin contesta a «quién entró dónde», y un caso tiene muchas más preguntas. Lo que te da es una respuesta en minutos a la pregunta que suele decidir qué haces a continuación: qué otras máquinas hay que mirar.
