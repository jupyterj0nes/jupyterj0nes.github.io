---
layout: post
title: "Recuperar lo borrado: qué hace --carve en cada herramienta"
short: "Lo borrado: qué se recupera por defecto y qué con --carve"
date: 2026-11-18 23:47:00 +0100
category: tools
section: common
order: 20
lang: es
ref: tool-common-carving
tags: [carving, blockcarve, mft, evtx, registro, ext4, masstin, caarea, faramir, allymacb, dfir]
description: "Dos niveles de recuperación en todas las herramientas: lo que el sistema de ficheros todavía describe, que se lee siempre, y lo que solo queda en bytes sueltos, que se busca con --carve. Qué recupera cada una y cuánto cuesta."
comments: true
---
Borrar un fichero no borra sus bytes. Borra la anotación que decía dónde estaban. Lo mismo pasa con una clave del registro o con un log de eventos vaciado: el contenido sigue ahí hasta que algo escribe encima.

Todas las herramientas de esta página recuperan cosas borradas, y todas lo hacen en dos niveles que conviene no confundir, porque uno es gratis y el otro cuesta una lectura entera del disco.

## Nivel uno: lo que todavía está descrito

Se lee **siempre**, sin pedir nada. Son estructuras que la herramienta ya está recorriendo y que conservan lo borrado en su interior:

| Dónde | Qué queda |
|---|---|
| Registros sin usar del `$MFT` | El nombre, las fechas y el tamaño de un fichero borrado, hasta que otro fichero reutiliza el registro |
| Celdas libres de un hive | Claves y valores de registro borrados |
| Copias de sombra | El volumen entero tal como estaba en el momento de la instantánea |
| El diario de ext4 | Copias de inodos y de directorios de antes de cada cambio |
| Huecos en los directorios de XFS | El nombre de un fichero borrado |

Es lo que explica que, en el caso de nuestro laboratorio y sin ninguna opción especial, [caarea](/es/tools/caarea-execution/) diera 1 180 filas de cosas borradas y 1 136 que solo existían en la copia de sombra, y [faramir](/es/tools/faramir-persistence/) recuperase 711 claves borradas de un solo hive.

Estas filas se distinguen por su estado: `deleted`, `vss`, `removed_since_vss`.

## Nivel dos: lo que ya no describe nadie

Cuando el registro del `$MFT` se reutiliza, o el log de eventos se vacía, ya no hay ninguna estructura que diga «aquí había algo». Quedan los bytes, en el espacio libre, en el fichero de paginación, en una copia de sombra vieja.

`--carve` los busca. Lee la imagen desde el primer byte hasta el último, una segunda vez, buscando estructuras por su forma. Está **apagado por defecto** en todas las herramientas porque cuesta lo que cuesta leer el disco entero.

| Herramienta | Qué busca con `--carve` |
|---|---|
| [masstin](/es/tools/evtx-carving-unallocated/) | Trozos de log de eventos y registros de evento sueltos |
| [faramir](/es/tools/faramir-persistence/) | Hives de registro enteros, que luego pasan por todas sus técnicas |
| [allymacb](/es/tools/allymacb-filesystem-timeline/) | Registros antiguos del `$MFT`, entradas de índice `$I30`, el diario de ext4, y líneas de log y registros `utmp` en el espacio libre |
| [caarea](/es/tools/caarea-execution/) | Todo lo anterior y además Prefetch, registros del diario USN, journals de systemd, registros `pacct`, líneas de auditd e historial de shell con fecha |

caarea, además, lee `pagefile.sys`, `swapfile.sys` e `hiberfil.sys` de cada partición, y acepta un volcado de memoria o un fichero de espacio libre suelto.

## Cómo se evita devolver basura

El problema del carving no es encontrar candidatos. Es que una firma de cuatro bytes aparece por casualidad miles de veces en un disco. Por eso cada estructura tiene que demostrar que lo es:

| Estructura | Qué tiene que cumplir |
|---|---|
| Hive de registro | Cabecera válida, tamaños con sentido, cadena de bins seguida de principio a fin, clave raíz comprobada |
| Trozo de log de eventos | Su suma CRC32, y después se analiza en un proceso aparte, para que un trozo malformado no tumbe la ejecución |
| Registro del `$MFT` | Geometría de la cabecera y la secuencia de corrección: los dos últimos bytes de cada sector tienen que coincidir con un número que guarda el registro. Los datos al azar no pasan |
| Entrada de índice | Lo anterior, y además longitud, caracteres del nombre y fechas plausibles |
| Registro `pacct` o `utmp` | Versión, texto imprimible, fecha entre límites razonables |

Y una regla común a las cuatro: **solo se recupera lo que lleva su propia fecha dentro.** Un trozo de fichero sin fecha no se puede colocar en una timeline, y ninguna herramienta se inventa una.

Ese trabajo lo hace [blockcarve](/es/tools/evidencefs-blockcarve-dirtyhive/), la biblioteca que comparten. Las cuatro aceptan una estructura por las mismas razones.

## Lo que se descarta

Un disco está lleno de copias legítimas de sus propias estructuras: el `$MFT` tiene un espejo, las copias de sombra guardan versiones idénticas, el fichero de paginación tiene trozos de todo. Devolverlas sería multiplicar la timeline por tres sin añadir nada.

Lo recuperado se compara con lo vivo, y lo que es idéntico se descarta. De un registro del `$MFT` se conserva:

- Un **estado anterior** de un fichero que sigue existiendo: mismas señas, otras fechas u otro tamaño.
- Un registro cuyo número **ya se reutilizó** para otro fichero.
- Un registro de un **volumen que ya no existe**.

La comparación es por identidad (qué es), nunca por posición en el disco.

El primer caso tiene una consecuencia que no se ve venir. Si el estado antiguo de un fichero tiene una fecha **posterior** a la del estado actual, alguien movió sus fechas hacia atrás. Es la regla `backdated` de allymacb, y solo se puede comprobar con carving. Una versión vieja no puede ser más nueva.

## Cómo se marcan

Una fila recuperada por carving no es la misma clase de evidencia que una leída de la tabla viva, y la timeline no lo mezcla. Cada una lleva su origen y la posición exacta en la que se encontró:

```
evtx:4688:carved [@0x1c3f80000]
prefetch:carved [pagefile @0x4f000]
C:\Users\Public\Documents\invoice.pdf.exe ($I30) (carved @0x2D20990A8)
```

Con esa posición, otro analista puede ir a ese byte de la imagen y comprobarlo. Y un filtro sobre `carved` deja la timeline con o sin ellas.

`[ORPHAN]` significa que se recuperó el fichero pero no la carpeta: el registro del directorio padre ya no está.

## Lo que cuesta, y lo que da

Una medida real. allymacb con `--carve` sobre la imagen de 50 GB de nuestro laboratorio:

```
Carving: 534092 FILE record(s) seen, 30 not in the live $MFT;
         58485 INDX block(s), 838063 entries, 8727 not in the live $MFT;
         free space: 23510 MiB searched, 0 log line(s), 50 utmp record(s)

Timeline entries written : 1490519
Carved entries           : 18730
Elapsed time             : 500.46s
```

Ocho minutos y veinte segundos, frente a los 35 segundos de la ejecución normal. Es el precio de leer cada sector.

Lo que dio:

- **De 534 092 registros del `$MFT` encontrados, 30 no estaban en la tabla viva.** Los demás eran copias de lo que ya se tenía, y se descartaron. Es lo normal en un disco joven que nunca se ha formateado: casi nada se ha reutilizado todavía.
- **De 838 063 entradas de índice, 8 727 no estaban en el `$MFT` vivo.** Aquí está el grueso: los índices de las carpetas conservan nombres de ficheros que la tabla viva ya no tiene.
- **18 730 filas nuevas** sobre un millón y medio.

Entre ellas, `invoice.pdf.exe` otra vez, ahora en el índice de su carpeta:

```
2018-09-15T07:12:55  m...  carved  C:\Users\Public\Documents\invoice.pdf.exe ($I30) (carved @0x2D20990A8)
```

En este caso no añade nada, porque el fichero ya se veía sin carving. Si algo hubiera reutilizado su registro del `$MFT`, esa entrada de índice sería lo único que quedaría de él.

Y una cosa que salió mal: los **50 registros `utmp`** son falsos. Es un volumen de Windows, donde no hay `utmp`, y las filas llevan fechas de 1995. Son datos al azar que pasaron las comprobaciones. Llevan su marca `carved` y su posición, así que se descartan de un vistazo, pero es justo el tipo de basura que el carving produce cuando una estructura tiene poca forma que comprobar.

Como referencia de un disco con más historia: la documentación de caarea recoge una estación de trabajo de 50 GB en la que una pasada tardó unos quince minutos, y 37 223 de las 69 795 filas existían solo por carving. Allí había un log de seguridad vaciado.

## Cuándo usarlo

No siempre. El nivel uno ya da la mayor parte de lo borrado reciente, y va incluido.

`--carve` es para tres situaciones:

- **Se vaciaron los logs.** Un 1102 en el log de seguridad, o un log que empieza justo después del incidente.
- **El volumen se formateó o se reinstaló.** El `$MFT` nuevo no sabe nada del anterior. Los registros viejos siguen en el espacio libre.
- **Hay que saber qué había antes.** Estados anteriores de ficheros que siguen existiendo.

## Lo que no hace

- **No recupera el contenido.** Recupera el rastro: que el fichero existió, cómo se llamaba, cuándo. Para sacar el fichero en sí hay herramientas de recuperación de datos.
- **No llega lejos en el tiempo en Linux.** El diario de ext4 es pequeño y circular: cubre horas o días, no meses.
- **Los discos SSD con TRIM** borran de verdad los bloques liberados. En un portátil moderno el espacio libre puede estar vacío a los pocos minutos.
- **`hiberfil.sys` se lee en bruto.** Sus páginas comprimidas no se descomprimen todavía.
- **Los logs rotados y comprimidos** (`.gz`) no se descomprimen al buscarlos en el espacio libre.
