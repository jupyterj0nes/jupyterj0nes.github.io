---
layout: post
title: "Rendimiento y evidencia dañada: lo que masstin hace sin que se lo pidas"
short: "Rendimiento y evidencia dañada"
date: 2026-11-18 22:30:00 +0100
category: tools
section: masstin-read
order: 100
lang: es
ref: tool-masstin-performance
tags: [masstin, rendimiento, evtx, hilos, dfir]
description: "Cómo reparte masstin el trabajo entre los núcleos que están libres, por qué no lee tres cuartas partes de un triage, cómo aguanta un log de cuatro gigas y por qué el resultado es idéntico con uno o con treinta y dos hilos."
comments: true
---
Hay una parte de masstin que no se ve y que tiene más trabajo detrás del que parece: que vaya rápido sin dejar el equipo inservible, y que no se caiga cuando la evidencia viene rota. Ninguna de las dos cosas tiene opción que activar. Este artículo cuenta qué pasa por debajo, por si un día el comportamiento te sorprende.

No hay una orden propia que probar. Todo lo que sigue ocurre en cualquier análisis, como el `masstin -a parse` de [el artículo de parse](/es/tools/masstin-parse/).

## Usa lo que está libre, no lo que hay

Al arrancar, masstin dice con qué va a trabajar:

```
Threads: up to 11, what is idle at each moment (12 cores, 11.4 idle now, 6.1 GB free;
         --threads fixes it, 1 runs serial); priority below normal
```

Un hilo es cada una de las tareas que un programa ejecuta a la vez, repartidas entre los núcleos del procesador. La línea dice varias cosas seguidas:

- **`up to 11`**: usará como máximo once hilos.
- **`12 cores`**: la máquina tiene doce núcleos. Siempre deja uno para el sistema.
- **`11.4 idle now`**: cuántos núcleos están libres ahora mismo.
- **`6.1 GB free`**: la memoria libre. Cuenta en el apartado siguiente.
- **`--threads fixes it, 1 runs serial`**: cómo fijar tú el número.
- **`priority below normal`**: corre con prioridad por debajo de lo normal.

La frase que importa es *what is idle at each moment*: no reserva once hilos, **usa los que estén libres en cada momento**, y lo vuelve a medir como mucho una vez por segundo.

En un servidor de análisis sin nada más que hacer, lo usa entero. En un portátil con otra herramienta trabajando al lado, se aparta. Y como corre con prioridad por debajo de lo normal, tu escritorio y lo que tengas abierto van primero.

Si prefieres fijarlo, `--threads N`. Con `--threads 1` corre en serie.

## La memoria también se mide

Los EVTX se leen varios a la vez, en tandas que caben en un presupuesto: una cuarta parte de la memoria libre, con un mínimo de medio giga. Un fichero más grande que el presupuesto se lee solo.

Y un EVTX en disco **nunca se carga entero**: se lee trozo a trozo, de 64 KiB en 64 KiB. Un `Security.evtx` de cuatro gigas, que los hay en controladores de dominio con la retención mal configurada, no gasta más memoria que los trozos que están en vuelo.

La excepción son los EVTX dentro de un ZIP, que hay que descomprimir en memoria.

## Las imágenes: cuántas a la vez

Con varias imágenes de disco, ¿cuántas se leen en paralelo? Depende del almacenamiento, y masstin no lo supone: lo mide.

Empieza con un lector si el disco es mecánico (dos solo conseguirían hacer bailar el cabezal) y con dos en cualquier otro caso. Cuenta los bytes por segundo que salen, en ventanas de tres segundos. Mientras la velocidad crezca, dobla los lectores. Cuando doblar no aporta, vuelve al tamaño anterior. Y si la velocidad cae, porque el almacenamiento o la red se han quedado atrás, los reduce a la mitad.

Las imágenes en un NAS por una red lenta y las imágenes en un NVMe local acaban con configuraciones distintas sin que tú toques nada.

## Tres cuartas partes del triage no se leen

Una carpeta de logs de Windows tiene cientos de canales, y masstin solo sabe leer los que hablan de movimiento lateral. PowerShell, TaskScheduler, Application, System: no tiene analizador para ellos, y son la mayor parte de los bytes. En un triage típico, tres cuartas partes.

Esos ficheros se dejan sin leer. Pero con cuidado, porque equivocarse aquí sería perder evidencia en silencio.

Un fichero se salta solo cuando **el nombre y el contenido coinciden** en decirlo: el nombre es el de un canal que masstin no lee, y el primer registro del primer trozo, el del último trozo en uso y los de cuatro trozos repartidos por el fichero dicen todos ese mismo canal.

Si algo no cuadra, se lee entero. Eso incluye:

- Un log **renombrado o archivado** (`Security-AAAA-MM-DD-HH-MM-SS.evtx`, el nombre que les pone Windows al archivarlos).
- Un log de **eventos reenviados** (`ForwardedEvents.evtx`), donde cada registro conserva su canal original y pueden venir mezclados los de muchas máquinas.
- Un fichero con **un trozo dañado**.
- Un registro que no dice de qué canal es.

Por la misma razón, el nombre del fichero nunca decide cómo se lee un evento. Cada registro se encamina por su propio canal. Un `Security.evtx` que alguien renombró a `copia.evtx` se lee igual, y lo cuento en [el artículo de los EVTX archivados](/es/tools/masstin-archived-evtx-provider-dispatch/).

## Cuando la evidencia viene rota

La evidencia de un caso real viene rota más veces de las que uno querría: un log truncado porque la máquina se apagó a medias, un trozo corrupto, un ZIP que no cierra.

La regla de masstin es seguir. Lo probé estropeando a propósito un `Security.evtx` del laboratorio: machaqué un trozo entero de 64 KiB con basura y corté el final del fichero a mitad de otro.

```
original:    Security.evtx (1247)
estropeado:  Security.evtx (1158)
```

Salen 1 158 eventos de 1 247: 89 menos. Se pierden los de los dos trozos dañados y el resto se lee con normalidad. Un fichero roto entre dos mil no tira la ejecución.

Ahora la parte que hay que saber: **no avisa**. No hay ninguna línea que diga «este fichero tenía un trozo corrupto». Lo único que ves es un número más bajo en el desglose por origen. Así que ese desglose hay que leerlo: si de un controlador de dominio salen cuarenta eventos de `Security.evtx`, ahí hay algo que mirar.

Para las imágenes E01 con zonas corruptas donde el carving se atasca hay una opción específica, `--skip-offsets`, que se salta las zonas que le indiques. Es de otra acción, `carve-image`, la que recupera eventos de logs borrados ([el artículo de carving](/es/tools/evtx-carving-unallocated/)). Se le da una lista de posiciones en hexadecimal separadas por comas (`--skip-offsets 0x6478b6000,0x7a0000000`), y por cada una se salta 32 MB a partir de ahí.

## Idéntico con uno o con treinta y dos hilos

Esto es lo más importante del apartado. Paralelizar es fácil. Paralelizar sin que cambie el resultado no lo es.

Cada etapa paralela recoge sus resultados **en el orden de sus entradas**, y la ordenación final es estable. La consecuencia es que el CSV es el mismo, byte a byte, con un hilo o con treinta y dos.

No es una promesa: se comprueba. En cada cambio, la integración continua analiza los conjuntos de muestra públicos con un hilo y con todos los de la máquina, en tres sistemas operativos, y compara los ficheros.

En forense eso no es un detalle técnico. Si mañana alguien repite tu análisis en otra máquina y le sale una timeline distinta, tienes un problema que no tiene nada que ver con el caso. Y lo puedes comprobar tú con tu propia evidencia: analízala una vez normal y otra con `--threads 1`, cada una con su propio fichero de salida (`-o`), y compara los dos ficheros. La forma más sencilla es calcular el hash de cada uno (SHA-256, por ejemplo) con la herramienta que uses para la evidencia: si los dos hashes coinciden, los ficheros son idénticos byte a byte.
