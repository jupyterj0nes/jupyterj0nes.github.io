---
layout: post
title: "Timestomping: doce reglas y cuánto vale cada una"
short: "Fechas falseadas: las reglas y lo que valen"
date: 2026-11-18 23:55:00 +0100
category: tools
section: allymacb
order: 20
lang: es
ref: tool-allymacb-rules
tags: [allymacb, timestomping, mft, ntfs, ext4, anti-forense, dfir]
description: "Las doce reglas con las que allymacb busca fechas y nombres manipulados, qué más las produce en un sistema limpio, y por qué la regla más famosa del timestomping no vale nada sola."
comments: true
---
La regla de timestomping que todo el mundo conoce dice: si la fecha de creación de `$STANDARD_INFORMATION` es anterior a la de `$FILE_NAME`, alguien cambió la fecha. Es correcta. Y aplicada tal cual a un Windows moderno recién instalado salta en **uno de cada cuatro ficheros**.

Este artículo cuenta las doce reglas de [allymacb](/es/tools/allymacb-filesystem-timeline/), qué otra cosa legítima produce cada una, y cómo se decide cuánto vale cada aviso.

## Por qué se puede detectar

NTFS guarda las fechas de un fichero dos veces. Las de `$STANDARD_INFORMATION` (`$SI`) son las que enseña el Explorador, y cualquier programa puede cambiarlas con una llamada normal del sistema. Las de `$FILE_NAME` (`$FN`) las escribe el núcleo al crear o renombrar el fichero, y desde un programa corriente no se pueden tocar.

Una herramienta de timestomping cambia las primeras. Las segundas se quedan diciendo la verdad.

En Linux pasa algo parecido con otra pareja: `mtime` se cambia con un `touch`, pero `ctime` lo mueve el núcleo con cada cambio y no se puede fijar a mano.

## Las reglas

**Sobre fechas de NTFS:**

| Regla | Qué ve | Qué más la produce |
|---|---|---|
| `si_before_fn` | Creación en `$SI` anterior a la de `$FN` | Copias que conservan fechas: robocopy, 7-Zip, instaladores. En un Windows instalado, casi todo `C:\Windows` |
| `si_subsec_zero` | `$SI` en segundos exactos, `$FN` con fracción. Escrito con una API de segundos enteros | Ficheros extraídos de zip o cab |
| `b_after_c` | Creación posterior al último cambio del registro. El cambio se mueve con cada creación, así que esa creación se puso a mano | Instaladores que fijan las cuatro fechas |
| `usn_basic_info` | Un registro del diario USN cuyo único motivo es «cambio de información básica»: se tocaron fechas o atributos sin tocar los datos | `attrib`, agentes de copia de seguridad |
| `backdated` | `--carve` encontró un estado anterior de ese registro con una fecha **posterior** a la actual: las fechas se movieron hacia atrás | Nada legítimo |

**Sobre fechas de cualquier sistema:**

| Regla | Qué ve | Qué más la produce |
|---|---|---|
| `future` | Una fecha más de un día posterior a la ejecución | Reloj mal puesto en la máquina |
| `pre_1980` | Una fecha anterior a 1980 | Nada legítimo |
| `m_before_b` | Unix: modificado antes de creado | `cp -p`, `tar`, paquetes. Casi todo `/usr` |
| `m_after_c` | Unix: `mtime` posterior a `ctime` | Cambios de reloj entre dos escrituras |

**Sobre nombres:**

| Regla | Qué ve |
|---|---|
| `double_ext` | Extensión de documento seguida de una ejecutable: `invoice.pdf.exe` |
| `rtlo_name` | Un carácter de escritura de derecha a izquierda (U+202E) en el nombre. `report` + U+202E + `fdp.exe` se ve como `reportexe.pdf` |
| `invisible_name` | Caracteres de anchura cero en el nombre |

La columna de la derecha es la importante. Casi todas las reglas de fechas tienen una explicación inocente, y algunas la tienen miles de veces por máquina.

## Cuánto vale cada una

Aquí está la diferencia con una lista de reglas cualquiera: los puntos no los pone nadie. Se miden.

La medida es sencilla: se pasa la regla por un sistema limpio y se cuenta cuántas veces salta. La referencia de NTFS es el `$MFT` de un Windows Server 2016 limpio, con 431 153 registros. La de Unix, la raíz ext4 de un Ubuntu 22.04, con 77 881 inodos.

| Regla | Saltó en el sistema limpio | Puntos |
|---|---|---|
| `si_before_fn` | 103 104 de 431 153 | 6. Ruido: sin estado y sin puntos |
| `b_after_c` | 16 964 de 431 153 | 14 |
| `usn_basic_info` | 6 520 de 273 208 registros del diario | 16 |
| `si_subsec_zero` | 2 073 de 431 153 | 23 |
| `si_before_fn` + `si_subsec_zero` juntas | 2 061 de 431 153 | 23 por la pareja |
| `future`, `pre_1980`, nombres | Ninguna vez | 56 |
| `m_before_b` en Unix | 71 982 de 77 881 | 0. Ruido |
| `future`, `pre_1980`, `m_after_c` en Unix | Ninguna vez | 49 |

Una regla que salta en más de un registro limpio de cada diez es ruido: se anota en la explicación de la fila, pero no da estado ni puntos.

Las dos primeras líneas de esa tabla son lo que más sorprende:

- **`si_before_fn` sola no vale nada en un Windows moderno.** Una cuarta parte de los ficheros de un Server 2016 limpio la tienen, porque la instalación los deja con las fechas de la imagen de fábrica.
- **`m_before_b` no vale nada en Linux.** Los paquetes traen cada fichero con la fecha en que se compiló, que es anterior a la del inodo que se crea al instalarlo.

Y un dato más para no fiarse de las recetas: en el `$MFT` de un Windows XP, la misma `si_before_fn` salta en 324 registros de 12 183 y vale 16 puntos. Lo que vale una regla depende de la generación de Windows que tiene delante.

La pareja `si_before_fn` + `si_subsec_zero` es la firma clásica de una herramienta de timestomping: fecha vieja y segundos redondos. Vale más que cada una por separado, pero tampoco es limpia: 2 061 registros de fábrica la tienen.

## El volumen habla antes

Con las reglas solas, el servidor limpio de la referencia daba 8 169 registros significativos y 17 078 candidatos. Demasiados para un sistema en el que no ha pasado nada.

Lo que los quita no es otra regla, sino dos cosas que el volumen sabe de sí mismo.

**La ventana de instalación.** Un volumen nace en un momento concreto y se llena de golpe. En la referencia, el 98 % de los registros cambiaron en las cuatro horas siguientes al nacimiento. allymacb calcula esa ventana a partir del propio volumen, y lo que cambió dentro de ella queda como `baseline`: instalado con el sistema. Sus reglas de fechas conservan la explicación y no suman.

En la imagen de nuestro laboratorio se ve así:

```
p1 $MFT: installed from 2026-10-26T03:37:07Z to 2026-10-26T05:59:59Z, 493053 of 519302 records
87332 file(s) installed with their volume: the rules that fired on them add nothing
```

**La hora, comparada con horas limpias.** Fuera de la instalación, cada registro se juzga junto a los demás de su hora. Si en esa hora 1 139 ficheros de 3 319 llevan el mismo patrón, eso no son 1 139 anomalías: es una operación, y la pregunta es si una máquina limpia tiene horas así. El primer arranque de una máquina virtual las tiene, y sale como `habitual` con los números al lado:

```
1139 of the 3319 records changed in 2026-11-03T10 carry si_before_fn+si_subsec_zero
and 1 of 14 clean hours reach that share (what a clean machine does)
```

Con las dos cosas, el servidor limpio pasa de 8 169 significativos a ninguno.

Lo que no se pliega nunca son los patrones que ninguna hora limpia tiene: `future`, `pre_1980`, los nombres y `backdated`. Esos conservan su estado siempre.

## En el caso del laboratorio

Sobre la imagen de 50 GB, más de doscientas mil filas llevan `si_before_fn` en su explicación. Las reglas, por sí solas, señalan dos ficheros:

```
[ALERT] 2 file(s) `significant` by their rules (timestomping, name tricks):
[ALERT]   b_after_c+double_ext   C:\Users\Public\Documents\invoice.pdf.exe  (meta 532164)
```

De doscientas mil a dos. Y `invoice.pdf.exe` es justo lo que había que encontrar: tiene fecha de modificación de 2018, fecha de creación de 2026 y un nombre que ninguna máquina limpia produce.

## Lo que no puede decir

- **Ninguna regla es una prueba.** Dicen dónde mirar primero.
- **La referencia limpia tiene catorce horas medidas.** Con catorce, ningún patrón puede ser más raro que uno entre quince. En NTFS eso significa que, hoy, solo los patrones que una máquina limpia no produce nunca llegan a tener estado por las reglas. Una única copia con fechas conservadas, en una hora tranquila, no destaca.
- **`backdated` necesita `--carve`,** y no está medida todavía: avisa, pero no suma puntos.
- **Un atacante que cambie también `$FILE_NAME`** (hay que mover o renombrar el fichero después de falsear la fecha) escapa a `si_before_fn`. Queda el diario USN, que anota el cambio de fechas como `usn_basic_info`, y por eso conviene darle a allymacb el `$MFT` y el diario del mismo volumen en una sola ejecución. Sobre una imagen lo hace solo.

Las reglas, las medidas y cómo se comprobaron están en la [documentación de allymacb](https://github.com/jupyterj0nes/allymacb).
