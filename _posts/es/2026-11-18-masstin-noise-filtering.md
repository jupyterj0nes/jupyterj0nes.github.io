---
layout: post
title: "Quitar el ruido: --ignore-local y --exclude"
short: "Filtrar el ruido"
date: 2026-11-18 21:30:00 +0100
category: tools
section: masstin-read
order: 80
lang: es
ref: tool-masstin-noise-filtering
tags: [masstin, filtros, ruido, timeline, dfir]
description: "Cuatro opciones de masstin para dejar en la timeline solo lo que es movimiento lateral: --ignore-local, --exclude-users, --exclude-hosts y --exclude-ips, con el resumen de lo filtrado."
comments: true
---
Una timeline de masstin recién hecha tiene mucha paja. No es un defecto: masstin recoge todos los eventos de autenticación, y la mayoría no son alguien moviéndose de una máquina a otra. Son servicios arrancando, la propia máquina hablando consigo misma y sesiones de consola.

Para quitarlo hay cuatro opciones. Ninguna está activada por defecto.

## Cuánto ruido hay

La timeline de nuestro laboratorio tiene 30 731 filas. Le paso el filtro básico y quito además las cuentas de máquina:

```bash
masstin -a merge -f caso.csv --ignore-local --exclude-users '*$' -o filtrado.csv
```

```
Filter summary:
   Total records seen: 30731
   Total kept:         11065 (36.0%)
   Total filtered:     19666 (64.0%)

   --ignore-local:     18013 (58.6%)
      loopback_ip             2527
      literal_LOCAL              4
      service_logon           1567
      interactive_logon        274
      self_reference          3580
      both_noise             10061
   --exclude-users:    1653 (5.4%)   [1 patterns]
```

Se van dos tercios. Y el resumen dice por qué se fue cada cosa, que es lo que permite fiarse.

Dos cosas de esa orden, para que no despisten:

- Usa `merge`, y no `parse`, porque la timeline ya está hecha. `merge` también sabe filtrar un CSV que ya existe. Lo explico más abajo, en «Filtrar sin volver a analizar».
- Las comillas simples de `'*$'` son para la terminal, no para masstin. Sin ellas, la shell puede tocar el `*` o el `$` antes de pasárselos al programa.

## --ignore-local

Quita las filas que **no tienen un origen útil**. Una fila sin origen no es movimiento lateral, porque no hay «desde dónde».

Las categorías del resumen son los motivos:

| Motivo | Qué es |
|---|---|
| `both_noise` | Ni la dirección ni el nombre de origen dicen nada: están vacíos, son un guion (`-`) o un relleno como `MSTSC` o `default_value` |
| `self_reference` | El origen es la propia máquina de destino |
| `loopback_ip` | El origen es `127.0.0.1` o `::1` |
| `service_logon` | Un logon de servicio, sin origen |
| `interactive_logon` | Alguien sentado delante, sin origen de red |
| `literal_LOCAL` | El origen es la palabra `LOCAL` |

**Una garantía que importa.** Una fila con una dirección IP pública válida como origen **no se filtra nunca**, diga lo que diga el nombre del equipo. Windows muchas veces no resuelve el nombre de quien se conecta desde fuera, y justo esas filas son la fuerza bruta y el acceso externo.

La regla general es que la dirección manda. Si la IP de origen es una dirección real (no es de loopback ni de enlace local), la fila se queda aunque el nombre sea un relleno: una fila con `MSTSC` como nombre y una IP real se conserva, y la misma fila con `-` en lugar de la IP se filtra.

## --exclude-users, --exclude-hosts, --exclude-ips

Para lo que sabes que es ruido en *esa* red.

Lo de abajo no son órdenes completas. Son las opciones sueltas, para añadir al final de un `parse` o de un `merge` como el del principio.

```bash
# cuentas de servicio y cuentas de máquina
--exclude-users 'svc_*,*$,@cuentas-servicio.txt'

# servidores de salto y monitorización
--exclude-hosts 'JUMP01,JUMP02,*-MON,@jumpboxes.txt'

# el escáner de vulnerabilidades y una subred de gestión
--exclude-ips '10.0.5.20,10.99.0.0/16'
```

Las tres listas se escriben igual:

- Valores separados por comas.
- Comodines: `svc_*` (empieza por), `*$` (acaba en), `*admin*` (contiene).
- `@fichero.txt` importa un fichero, una entrada por línea, con `#` para comentarios.
- En las direcciones, además, rangos CIDR.

`--exclude-users` mira tanto la cuenta de destino como la de origen. `--exclude-hosts` mira el equipo de destino y el de origen.

## Probar antes

`--dry-run` con cualquier filtro enseña el resumen y no escribe más que la cabecera del CSV:

```bash
masstin -a parse -d /evidencia -o timeline.csv --ignore-local --dry-run
```

Es la forma de comprobar que el patrón hace lo que crees. Si `--exclude-users 'adm*'` se lleva el 40 % de las filas, has excluido algo que no querías.

Los números del resumen siempre suman. Cada fila filtrada se atribuye a una sola causa: la primera que encajó.

## Filtrar sin volver a analizar

Analizar veinte imágenes de disco lleva su tiempo. Filtrar no debería obligarte a repetirlo, y no obliga: `merge` aplica los mismos filtros sobre una timeline ya hecha.

```bash
masstin -a merge -f timeline.csv --ignore-local --exclude-users @svc.txt -o filtrada.csv
```

Así que el orden que recomiendo es este: **analiza sin filtros, guarda esa timeline completa y filtra sobre copias**. La completa es tu evidencia. Las filtradas son vistas de trabajo, y puedes hacer tantas como preguntas tengas.

## Cuidado con lo que quitas

Dos avisos, porque estas opciones se pueden volver contra ti.

**Las cuentas de máquina no siempre son ruido.** `*$` limpia muchísimo, pero una cuenta de máquina autenticándose desde una dirección que no es la suya es precisamente lo que deja un ataque de relay. Y el visor usa esas filas para saber [de quién es cada dirección](/es/tools/masstin-viewer-hosts-addresses/). Si vas a unir nombres con IPs, hazlo sobre la timeline completa.

**Excluir el servidor de salto es excluir por donde pasó el atacante.** Si el atacante usó `JUMP01`, que es lo habitual, con `--exclude-hosts JUMP01` lo has borrado del caso. Excluye lo que has comprobado que es ruido, no lo que supones.

Y si lo que quieres es no ver algo, sin eliminarlo, eso se hace mejor en el [visor](/es/tools/masstin-viewer-filters/): los filtros de allí no tocan el fichero.
