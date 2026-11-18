---
layout: post
title: "Semillas: reconstruir la cadena desde lo que ya sabes"
short: "Semillas: reconstruir desde lo que ya sabes"
date: 2026-11-18 19:00:00 +0100
category: tools
section: masstin-hunt
order: 40
lang: es
ref: tool-masstin-hunt-seeds
tags: [masstin, hunt, semillas, movimiento-lateral, reconstruccion, dfir]
description: "Con --seed, graph-hunt de masstin parte de una máquina, dirección o cuenta que ya sabes comprometida y reconstruye cada salto, siguiendo las sesiones abiertas."
comments: true
---
Muchas veces el caso no empieza de cero. Empieza con una alerta: una dirección que el cortafuegos marcó, una cuenta que apareció donde no debía, un servidor con una webshell. Ya tienes un punto. Lo que quieres es todo lo que salió de él.

Para eso está `--seed`.

```bash
masstin -a graph-hunt-csv -f leoncorp.csv \
        --investigation-from "2026-11-10 00:00:00" \
        --seed 203.0.113.45 --report seed.md
```

Una semilla puede ser un nombre de máquina, una dirección o una cuenta, y se pueden dar varias separadas por comas. `maquina:cuenta` nombra las dos a la vez.

Los datos son los del escenario generado de [el hunt desde el visor](/es/tools/masstin-hunt-viewer/): inventados, con una intrusión con guion. La semilla es la dirección externa que hizo fuerza bruta por SSH.

## Lo que devuelve

```
Seeds: 1 matched, 6 movement(s) (29 session(s)) reconstructed over 6 machine(s)
```

Y el informe se abre con la cadena:

| # | Prof. | Primer login | Origen | Cuenta | Destino | Certeza | Sigue a |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 01:39:12 | 203.0.113.45 | DEPLOY | LEO-LNX01 | 1 | semilla |
| 2 | 2 | 01:52:03 | LEO-LNX01 | SVC_SQL@DEV | DEV-DC01 | 1 | salto 1 |
| 3 | 2 | 01:52:05 | LEO-LNX01 | SVC_SQL@DEV | DEV-SRV01 | 1 | salto 1 |
| 4 | 3 | 02:06:43 | DEV-SRV01 | SVC_SQL@DEV | PTR-SRV01 | 1 | salto 3 |
| 5 | 3 | 02:20:11 | DEV-SRV01 | RYAN_DEVLEAD@DEV | DEV-DC01 | 1 | salto 3 |
| 6 | 2 | 03:50:08 | LEO-LNX01 | ADMINISTRATOR@DEV | LEO-FS01 | 1/2 | salto 1 |

Seis saltos sobre seis máquinas, a partir de una sola dirección IP.

## Cómo sigue el rastro

La regla es conservadora a propósito, y conviene entenderla.

**Empieza por los logins de la semilla.** Aquí, la entrada de `203.0.113.45` en `LEO-LNX01` como `deploy`.

**Desde cada máquina en la que entra, sigue solo mientras esa sesión está abierta.** Desde su logon hasta su cierre, o hasta el final del día si el cierre no se registró. Un login que sale de `LEO-LNX01` tres días después no es de la cadena.

**Y no sigue cualquier login.** Solo los que son conexiones nuevas o usan una cuenta que la cadena ya había usado. El tráfico habitual de un servidor que estaba ahí antes del ataque no se le cuelga al atacante.

Mira el salto 4: `DEV-SRV01 → PTR-SRV01` como `SVC_SQL`. El hunt lo tiene como **habitual**: esa cuenta de servicio hace esa conexión todos los días. Solo no lo habría marcado nunca. La cadena lo recoge porque usa una cuenta que el atacante ya llevaba en la mano. Y por ese salto se entra en el dominio del socio.

Es el ejemplo de por qué las semillas ven cosas que la estadística no puede ver: una acción perfectamente normal, hecha por quien no debía.

## La certeza

La columna más honrada de la tabla. Es **1 dividido entre las sesiones abiertas en esa máquina en ese momento**.

En los cinco primeros saltos es 1: cuando salió ese login, la única sesión abierta en el origen era la del atacante. No hay otra explicación.

En el sexto es 1/2. A las 03:50, en `LEO-LNX01` había dos sesiones abiertas, y el login a `LEO-FS01` pudo salir de cualquiera de ellas. masstin no lo esconde ni redondea: te dice que hay una posibilidad entre dos.

Ese es el número que hay que llevar al informe. «El atacante accedió al servidor de ficheros» es una frase. «Desde el servidor comprometido se accedió al servidor de ficheros mientras había dos sesiones abiertas, una de ellas la del atacante» es otra, y la segunda es la que aguanta una revisión.

## Lo que viene con la cadena

Debajo de la tabla, el informe añade tres cosas.

**Los intentos fallidos de las máquinas de la cadena.** Lo que el atacante probó y no le salió:

```
203.0.113.45 -> LEO-LNX01: 184 failed attempt(s) between 01:13:00 and 01:37:21
DEV-SRV01 -> DEV-BUILD01: 1 failed attempt(s) at 02:31:02
DEV-SRV01 -> LEO-BKP01:   1 failed attempt(s) at 02:31:07
DEV-SRV01 -> LEO-FS01:    1 failed attempt(s) at 02:31:00
DEV-SRV01 -> LEO-PRN01:   1 failed attempt(s) at 02:31:19
DEV-SRV01 -> PTR-FS01:    1 failed attempt(s) at 02:31:02
```

Aquí salen los 184 fallos de esa dirección, con todos los nombres de usuario que probó. En el informe del hunt la misma fuerza bruta aparece como 73, que son solo los de la cuenta con la que al final entró.

Veinticuatro minutos de fuerza bruta, y luego cinco intentos en veinte segundos desde el servidor SQL contra cinco máquinas distintas. Alguien probando una credencial recién robada a ver dónde abre. Eso también es alcance: son las máquinas que el atacante *quiso* tocar.

**Qué había abierto en la semilla cuando empezó a actuar.** Por si la semilla no es el principio sino un paso intermedio.

**Dos consultas Cypher.** Una dibuja exactamente esos saltos. La otra devuelve todo lo que pasó entre las máquinas de la cadena en ese periodo, para comprobarlo. Si no usas base de datos de grafos, lo mismo se ve en el [visor](/es/tools/masstin-viewer-find-path/).

## Semillas que ya existían

Un detalle que evita muchos falsos positivos. Si la semilla es una máquina que ya estaba en la referencia (un servidor de salto, por ejemplo), la cadena arranca **solo con sus conexiones nuevas**. Su rutina se lista, pero no se sigue.

Si la semilla no se había visto nunca, como aquí, arranca con todo lo que hizo.

Y si quieres acotar más: `--seed-from` y `--seed-to` limitan qué logins pueden iniciar la cadena.

## Desde el visor

Lo mismo está en el segundo paso del [asistente del hunt](/es/tools/masstin-hunt-viewer/): la caja **Known compromised**. Escribes las semillas ahí y el informe sale con la reconstrucción al principio.

## Cuándo usarlo y cuándo no

Úsalo cuando tengas un punto de partida fiable. La reconstrucción es tan buena como la semilla: si le das una máquina que no estaba comprometida, te devolverá con toda seriedad la «cadena» de su administrador.

Y recuerda de qué depende: de que los cierres de sesión estén en la timeline. Sin el 4634 o el 4647, o sin el final de la sesión SSH, la sesión se da por abierta hasta el final del día, y la cadena puede recoger más de la cuenta. La columna de certeza baja cuando eso pasa. Mírala.
