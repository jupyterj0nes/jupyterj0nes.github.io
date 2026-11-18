---
layout: post
title: "faramir: qué va a seguir ahí cuando reinicies"
short: "faramir: qué persiste, de un vistazo"
date: 2026-11-18 23:10:00 +0100
category: tools
section: faramir
order: 10
lang: es
ref: tool-faramir
tags: [faramir, persistencia, registro, autoruns, linux, dfir]
description: "faramir lee una imagen, un triage o un volumen montado y escribe una timeline con cada mecanismo de persistencia de Windows y Linux, vivo o borrado, con los sospechosos marcados."
comments: true
---
Echar a un atacante de una red tiene dos partes. Cortarle el acceso es la fácil. La difícil es estar seguro de que no ha dejado nada que se lo devuelva: una clave Run, una tarea programada, un servicio, una clave SSH en un `authorized_keys`, una línea en un crontab.

Windows tiene decenas de sitios donde algo puede quedarse a vivir, y Linux otros tantos. Revisarlos a mano en una máquina es una tarde. En veinte máquinas no se hace.

**faramir** los revisa todos y escribe una timeline.

```bash
faramir -d /evidencia/caso -o persistencia.csv
```

Es el sucesor en Rust de [Boromir](/es/tools/persistence-boromir/), el cazador de persistencia en Python de Alejandro Gamboa.

## Lo que lee

Lo mismo que el resto de la familia, sin montar ni extraer nada antes: imágenes E01, raw, VMDK y VHD/VHDX con NTFS, ext4 o XFS; triages de KAPE, Velociraptor, Cortex XDR, CyLR y UAC; volúmenes montados; o un único hive del registro.

Le di el caso entero del laboratorio: una imagen de disco de 50 GB, cuatro triages de Windows y dos de Linux.

```
Hunt: 36 significant, 75 candidate, 6051 habitual, 0 not evaluated
      (7 host(s), 89 row(s) tested, alpha 0.05)
Total persistence events collected: 6162
Diagnostics: 0 error(s), 444 warning(s), 900 info(s)
```

Siete máquinas, 6 162 entradas de persistencia, 42 segundos.

Seis mil entradas no es que haya seis mil cosas raras. Es que un Windows recién instalado ya trae más de mil: cada servicio, cada extensión del shell, cada tarea programada de Microsoft es técnicamente persistencia. En el servidor del laboratorio, solo los servicios son 564.

Por eso lo que importa no es la lista, sino las tres primeras cifras.

## Lo que encuentra

De las 6 162, quedan como habituales 6 051. Son lo que trae un sistema limpio o lo que está igual en varias máquinas. Las que hay que mirar son las otras.

Esto es lo que saca arriba del todo en `dev-srv01`:

| Técnica | Qué se ejecuta | Score | Por qué |
|---|---|---|---|
| Clave Run | `C:\Users\Public\update.bat` | 66 | Script en carpeta escribible por cualquiera; persistencia desde una carpeta de paso |
| Tarea programada | `C:\Users\Public\update.bat` | 91 | Lo mismo, y además se ejecuta como SYSTEM |

Un `.bat` en `C:\Users\Public` lanzado por una clave Run **y** por una tarea programada. Cualquier analista lo vería sospechoso si lo tuviera delante. El trabajo de faramir es ponértelo delante entre mil servicios legítimos.

En el controlador de dominio:

| Técnica | Qué se ejecuta | Score |
|---|---|---|
| Tarea programada | `cmd.exe /c powershell New-PSDrive ... -Root "\\PTR-DC01\Private"` | 66 |
| Tarea programada | `cmd.exe /c powershell c:\setup\bot_rdp.ps1` | 33 |

La primera monta un recurso de otro dominio desde una tarea programada. La segunda es del propio laboratorio. Es un falso positivo de manual, y está bien que salga. faramir no sabe que ese script es nuestro; sabe que hay un PowerShell lanzado desde una carpeta que no es de sistema, y eso es verdad.

Y en el servidor Linux:

```
linux:sudoers:nopasswd   Sudoers [line 55]: %Leadership ALL=(ALL) NOPASSWD:ALL   candidate, 29
```

Un grupo entero con sudo sin contraseña. Es configuración del laboratorio, no un ataque, pero es exactamente la línea que añade quien quiere volver como root.

## Dos motores, una columna

Cada fila pasa por dos exámenes.

**Reglas.** Un catálogo de cómo es la persistencia mala conocida: un binario del sistema descargando de una URL, PowerShell codificado u oculto, un nombre de sistema fuera de su carpeta, una DLL cargada desde AppData, `ld.so.preload`, un shell inverso, un cron que sale de `/tmp`. Cada regla tiene su identificador y su técnica de ATT&CK.

**Estadística.** El mismo método del [hunt de masstin](/es/tools/masstin-graph-hunt/), aplicado a la persistencia: cómo de rara es esta entrada comparada con las demás de la ejecución. En cuántas máquinas aparece, cómo de común es su carpeta, qué forma tiene su nombre.

El resultado va a las mismas tres columnas que en masstin, con las mismas palabras: `hunt`, `hunt_score` y `hunt_why`. La última dice quién habló:

```
rule H1009 (high): Script run from a user-writable folder [T1059];
rule H3001 (high): Persistence from a scratch folder [T1547]; on 2 of 5 hosts
```

## Lo que ya no está

Un atacante con algo de oficio borra su persistencia al irse. faramir busca también lo borrado, en tres sitios:

- **Celdas libres del registro.** Cuando se borra una clave, sus datos siguen en el hive hasta que algo los pisa. En el `SOFTWARE` del servidor del laboratorio recuperó 711 claves borradas.
- **Copias de sombra.** Lo que estaba en una instantánea y ya no está en el volumen vivo. En este caso, tres entradas.
- **El diario de ext4.** En Linux, crontabs, unidades de systemd y claves SSH borradas, con su nombre, sus fechas y su contenido.

Esas filas llevan su estado en una columna (`deleted`, `removed_since_vss`) y salen como candidatas solo por eso. Algo que estuvo configurado para arrancar y ya no está merece un vistazo.

Y con `--carve`, además, recorre los bytes de la imagen buscando hives enteros a los que ya no apunta ningún fichero. Lento, y solo si lo pides.

## Hives sucios

Un detalle que arregla un problema que muchos no saben que tienen. Un hive recogido de un sistema encendido suele estar «sucio»: los últimos cambios no están en el fichero sino en sus logs de transacciones (`.LOG1`, `.LOG2`). Si lees el hive sin ellos, te faltan justo las modificaciones más recientes, que en un incidente son las que interesan.

faramir encuentra esos logs donde los dejara el recolector, comprueba que son de ese hive y los aplica antes de leer nada.

## Lo que no hay que creerse

Lo que marca son pistas, no veredictos. En esta misma ejecución, entre las 36 filas significativas hay varias que son ruido: servicios por usuario del propio Windows (los que acaban en un sufijo como `_30f3b`), que aparecen como «borrados y raros». Son raros de verdad, estadísticamente. No son un ataque.

La cuenta honrada es esta: de 6 162 entradas te deja un centenar largo para mirar, y entre ellas están las que importan. Eso es leer cien filas en vez de seis mil. No es leer cero.

Para bajar el ruido en una red concreta hay dos opciones: `--known-good`, con el CSV de una máquina limpia de esa organización, y `--baseline`, con la fecha hasta la que el sistema era de fiar.

## Con el resto del caso

La timeline tiene las 19 columnas de masstin, cada una en su sitio. Y aquí es donde encaja: [allymacb](/es/tools/allymacb-filesystem-timeline/), mirando el sistema de ficheros de esa misma imagen, ve crearse `update.bat` el 10 de noviembre a las 08:32:43. En ese mismo segundo aparece al lado un fichero con la fecha falseada. faramir te dice que ese `.bat` se va a ejecutar en cada arranque; allymacb, cuándo llegó y qué vino con él.

El código y la documentación completa están en [GitHub](https://github.com/jupyterj0nes/faramir).
