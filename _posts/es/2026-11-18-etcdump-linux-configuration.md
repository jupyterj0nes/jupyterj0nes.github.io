---
layout: post
title: "etcdump: cómo estaba configurado ese Linux"
short: "etcdump: la configuración de un Linux, de un vistazo"
date: 2026-11-18 23:40:00 +0100
category: tools
section: etcdump
order: 10
lang: es
ref: tool-etcdump
tags: [etcdump, linux, sudoers, ssh, cron, systemd, persistencia, dfir]
description: "etcdump lee /etc, los homes y los spools de cada Linux de una imagen o un triage y los escribe como texto que se puede leer con grep y como timeline, con 51 reglas de persistencia y bastionado."
comments: true
---
En un Linux casi todo lo que importa de un caso es texto: quién puede hacer sudo, qué claves SSH entran, qué arranca con el sistema, qué se ejecuta cada noche. No hace falta ninguna herramienta para leerlo. Hace falta tiempo, porque está repartido en cientos de ficheros con veinte sintaxis distintas, y en un triage además viene dentro de un `.tar.gz`.

**etcdump** los lee todos y los deja en dos formas: un texto por área, que se lee con los ojos o con `grep`, y una timeline.

```bash
etcdump -f lnx01-triage.tgz -o lnx01-etc --summary
```

`-f` es la evidencia, `-o` la carpeta donde deja el resultado, y `--summary` hace que al terminar imprima en la consola un resumen como el de más abajo.

## Lo que lee

Un triage (UAC, o cualquier carpeta que tenga un `etc/passwd`), un zip, un tar, o una imagen de disco con ext4, XFS o LVM dentro. Si la entrada tiene varios Linux, los encuentra todos.

Solo recorre las carpetas de configuración, nunca el volumen entero. Por eso tarda segundos.

Le di los dos triages Linux de nuestro laboratorio. Para pasarle más de un fichero se repite `-f`, una vez por cada uno:

```
leo-lnx01-triage.tgz: computer leo-lnx01, 1 Linux root(s) (tar)
red-01-triage.tgz: computer red-01, 1 Linux root(s) (tar)
area          files    rows   hits
accounts         18     870      6
sudo              8      21      1
ssh              10      35      0
keys              8       6      0
network          18      83      1
cron             27     211      0
systemd        1090    6707      0
init            250    3182      0
shell            46    1062      0
pam              50     257      0
...
1741 file(s), 0 deleted or previous version(s), 0 not parsed, 15252 row(s)
```

Dos máquinas, 1 741 ficheros de configuración, 15 252 elementos, cinco segundos.

Las áreas son veintitrés: cuentas, sudo, SSH, claves, red, montajes, cron, at, systemd, init, perfiles de shell, `ld.so.preload`, módulos del kernel, udev, PAM, repositorios de paquetes, autoarranque de escritorio, motd, entorno, cortafuegos, logrotate, servidores web y paquetes instalados.

## El texto

Esta es la parte que más se usa. Por cada máquina y cada área hay un fichero de texto en la carpeta de salida, con el área al final del nombre: `..._sudo.txt`, `..._ssh.txt`. Al lado quedan `timeline.csv`, `files.txt` (una línea por fichero de configuración leído) y `roots.txt`. Este es el de sudo, entero:

```
== etc/sudoers  (live, 1708 bytes, modified 2026-11-03T12:06:38.061340Z)
  [   9] Defaults = env_reset
  [  10] Defaults = mail_badpass
  [  12] Defaults = use_pty
  [  44] root = ALL=(ALL:ALL) ALL
  [  47] %admin = ALL=(ALL) ALL
  [  50] %sudo = ALL=(ALL:ALL) ALL
  [  54] includedir = /etc/sudoers.d
  [  55] %Leadership = ALL=(ALL) NOPASSWD:ALL    <<< candidate rule LNX-SUDO-NOPASSWD-ALL (medium)

== etc/sudoers.d/90-cloud-init-users  (live, 139 bytes, modified 2026-11-03T10:40:47.280999Z)
  [   4] ubuntu = ALL=(ALL) NOPASSWD:ALL    <<< habitual rule LNX-SUDO-NOPASSWD-ALL (medium)
```

Cada fichero con su fecha de modificación, cada línea útil con su número, sin comentarios ni líneas en blanco. Ese número entre corchetes es la línea del fichero original (`[  55]` es la línea 55 de `sudoers`), no una puntuación. Y una marca `<<<` donde saltó una regla.

Las dos últimas marcas dicen cosas distintas, y ahí está la gracia. Las dos líneas dan sudo completo sin contraseña. La de `ubuntu` es `habitual`: la trae cualquier imagen de Ubuntu en la nube. La de `%Leadership` es `candidate`: esa no la trae nadie. En el laboratorio es una debilidad puesta a propósito. En un caso real sería la primera pregunta para el administrador.

Como es texto, lo demás se hace con las herramientas de siempre:

```bash
grep -h "<<<" lnx01-etc/*.txt          # todo lo que marcó alguna regla
grep -i nopasswd lnx01-etc/*_sudo.txt  # una pregunta concreta
diff a_ssh.txt b_ssh.txt               # en qué se diferencian dos servidores
```

Lo último es más útil de lo que parece: dos servidores que deberían ser iguales, comparados área por área.

## Los secretos se quedan fuera

El resultado de etcdump se va a compartir, a pegar en un informe, a subir a un caso. Por eso hay cosas que no escribe nunca.

De `shadow` no sale el hash. Sale lo que hace falta saber de cada contraseña:

```
== etc/shadow  (live, 1028 bytes, modified 2026-11-10T07:54:17.632999Z)
  [   1] root = password=disabled scheme=none last_change=2026-10-21 min=0 max=99999
  [  33] ubuntu = password=disabled scheme=none last_change=2026-11-03 min=0 max=99999
```

Si tiene contraseña, si está vacía o bloqueada, con qué algoritmo y cuándo se cambió por última vez. Una cuenta de servicio a la que alguien le puso contraseña la semana pasada se ve aquí.

Los valores cuya clave habla de una contraseña, un token o un secreto (la `psk=` de una wifi, un `DB_PASSWORD=`) se sustituyen por `<redacted N chars>`. Las claves SSH privadas no se leen.

## Las reglas

Son 51, y buscan lo que deja un atacante que quiere volver:

- Una segunda cuenta con uid 0, contraseñas vacías, cuentas de sistema con shell.
- Sudo sin contraseña, o sudo sobre un editor o un shell.
- En SSH: login de root, `AuthorizedKeysFile` en un sitio raro, claves en cuentas de servicio.
- Tareas de cron, unidades de systemd o scripts de arranque que descargan y ejecutan, salen de `/tmp`, decodifican base64 o abren un shell inverso.
- `ld.so.preload`, `LD_PRELOAD` en el entorno, `pam_exec`, módulos PAM de sitios raros.
- Hooks de APT, repositorios sin firma, reglas de udev con `RUN+=`.
- El historial del shell desactivado, `PROMPT_COMMAND`, alias de `sudo` en un perfil.

`etcdump --list-rules` las enseña todas con su definición. Para añadir las tuyas, las escribes en YAML con ese mismo formato y le pasas `--rules` seguido del fichero o de la carpeta donde están.

Igual que en el resto de la familia, la puntuación de una regla no la decide nadie: es lo rara que resultó en un Linux limpio. Una regla que salta en una instalación de fábrica vale poco, y el elemento exacto que la hizo saltar allí queda como `habitual` en cualquier otra máquina.

## Lo que salió, sin maquillar

De 15 252 elementos, las reglas marcaron 18 para leer. No hay ningún ataque en la configuración de estas dos máquinas, así que lo interesante es ver qué clase de cosas salen. La tabla no lista los 18 uno a uno: los agrupa por clases, y alguna fila reúne varios elementos.

| Qué | Estado | Qué es en realidad |
|---|---|---|
| `%Leadership ALL=(ALL) NOPASSWD:ALL` | candidate | La debilidad del laboratorio. Acierto |
| Una línea de `/etc/hosts` que fija el nombre del dominio a una dirección | candidate | Configuración del laboratorio. Una pista razonable |
| Miembros de `adm`, `sudo` y `lxd` en `/etc/group-` | candidate | La copia de seguridad que el sistema guarda de `group`. En el fichero vivo esas mismas líneas son `habitual` |
| `modules-load.d/modules.conf` carga módulos al arrancar | candidate | Un enlace de fábrica a `/etc/modules`. Ruido |
| `50-motd-news` usa `wget` | significant | Un script de fábrica de Ubuntu. Falso positivo |

Los tres últimos son ruido, y se entiende por qué: la regla acierta en lo que ve (un script que se ejecuta como root en cada login y sale a la red), y lo que falta es que la referencia limpia lo reconozca como de fábrica. Para una red concreta se arregla midiendo una máquina limpia propia:

```bash
etcdump -d imagen-limpia --measure -o medido
etcdump -f sospechoso.tgz --reference medido/reference.tsv -o salida
```

[![El resumen real de etcdump sobre el triage de un servidor Linux del laboratorio: ficheros y filas por área, y debajo lo primero que conviene leer. Se ve también el falso positivo del que habla esta sección: el 50-motd-news de fábrica marcado como significant.](/assets/images/terminal/etcdump.webp){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}](/assets/images/terminal/etcdump.webp)

<p class="video-cap">El resumen real de etcdump sobre el triage de un servidor Linux del laboratorio: ficheros y filas por área, y debajo lo primero que conviene leer. Se ve también el falso positivo del que habla esta sección: el 50-motd-news de fábrica marcado como significant.</p>

## Lo borrado

Sobre una imagen de disco, etcdump lee también los ficheros de configuración borrados que el diario de ext4 todavía describe, y las versiones anteriores de los que se reescribieron. Salen con estado `deleted` en una sección aparte de cada texto.

Es el caso del cron que alguien crea, deja ejecutarse una vez y borra. En un triage no hay diario que leer, y en esta ejecución la cuenta es cero.

## La timeline

`timeline.csv` tiene las 19 columnas del resto de la familia: una fila por elemento, en la fecha de modificación de su fichero, o en la suya propia cuando la tiene (el último cambio de una contraseña, la instalación de un paquete).

```
2026-11-03T12:06:38Z  leo-lnx01  etc:sudo  %Leadership  ALL=(ALL) NOPASSWD:ALL  candidate  35
```

El 35 del final es la puntuación. El artículo de [faramir](/es/tools/faramir-persistence/) da 29 a esta misma línea, y no es un error: cada herramienta mide sus reglas contra su propia referencia limpia.

Esa fecha es la del fichero entero, no la de la línea. Dice cuándo se tocó `sudoers` por última vez, no cuándo se añadió esa regla. Aun así sirve: puesta junto a los logins de [masstin](/es/tools/masstin-parse/) responde a quién estaba dentro cuando se modificó.

Para quedarse solo con lo marcado, o con unas áreas:

```bash
etcdump -f lnx01.tgz --area sudo,ssh,keys,cron,systemd --only-hunted -o salida
```

## Lo que no hace

- No enseña propietario ni permisos de los ficheros, así que un shell con set-uid o un fichero de configuración escribible por todos no se detectan todavía.
- No lee logs, historiales de shell ni el journal. Eso no es configuración, y lo leen masstin y [caarea](/es/tools/caarea-execution/).
- Las bases de datos RPM se listan, pero no se leen.

El código y la documentación completa están en [GitHub](https://github.com/jupyterj0nes/etcdump).
