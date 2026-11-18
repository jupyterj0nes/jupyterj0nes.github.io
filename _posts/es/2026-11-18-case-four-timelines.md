---
layout: post
title: "Cómo se lee un caso: cuatro timelines y la misma mañana"
short: "Cómo se lee un caso con las cuatro herramientas"
date: 2026-11-18 23:50:00 +0100
category: tools
section: family
order: 10
lang: es
ref: tool-family-case
tags: [masstin, caarea, faramir, allymacb, timeline, dfir]
description: "Tres minutos de un servidor de laboratorio vistos por masstin, caarea, faramir y allymacb a la vez: qué sabe cada herramienta, qué no, y por qué todas escriben el mismo tipo de timeline."
comments: true
---
Cada herramienta de esta página responde a una sola pregunta. Eso tiene un precio: ninguna cuenta el caso entero. Este artículo enseña lo que pasa cuando se ponen las cuatro sobre la misma evidencia y se mira el mismo minuto.

La evidencia es la de nuestro laboratorio: la imagen de disco de un servidor Windows, los triages de sus vecinos y un par de máquinas Linux. Lo que se ve lo plantó un script del laboratorio, no un atacante. Las herramientas no lo sabían.

## Las cuatro ejecuciones

```bash
masstin  -a parse -d caso/ -o logins.csv
caarea   -d caso/ -o ejecucion.csv --hunt
faramir  -d caso/ -o persistencia.csv
allymacb -f caso/images/dev-srv01.vmdk -o ficheros.csv
```

Ninguna necesita montar la imagen ni extraer nada antes. caarea, que es la que más fuentes lee, tarda dos minutos.

## Lo que encuentra cada una por su cuenta

Sin decirles qué buscar, esto es lo que cada una pone arriba del todo en el servidor:

| Herramienta | Lo que señala |
|---|---|
| [faramir](/es/tools/faramir-persistence/) | Una clave Run y una tarea programada que lanzan `C:\Users\Public\update.bat` |
| [allymacb](/es/tools/allymacb-filesystem-timeline/) | `invoice.pdf.exe`, borrado, con fecha de modificación de 2018 y de creación de 2026 |
| [caarea](/es/tools/caarea-execution/) | `invoice.pdf.exe` y un `svch0st.exe` en `ProgramData`, ejecutados desde PowerShell |

Tres hallazgos de tres fuentes de evidencia que no comparten nada: el registro, el `$MFT` y el log de seguridad. Por separado, cada uno es una pista. La pregunta es si son la misma historia.

## El mismo minuto

Todas escriben la hora en UTC y con el mismo formato, así que basta con filtrar las cuatro timelines por el mismo intervalo y leerlas juntas. El 10 de noviembre, en `dev-srv01`:

| Hora (UTC) | Quién lo dice | Qué pasa |
|---|---|---|
| 08:32:42.486 | masstin | `Administrator` inicia sesión por SSH |
| 08:32:43.677 | allymacb | Nace `C:\Users\Public\update.bat` |
| 08:32:43.677 | caarea | Clave Run `Updater` → `update.bat` |
| 08:32:43.693 | caarea | `schtasks /create /tn "RF Updater" /tr C:\Users\Public\update.bat /sc daily`, tecleado por `Administrator` |
| 08:32:43.755 | allymacb | Nace `invoice.pdf.exe`, con fecha de modificación de 2018 |
| 08:32:43.824 | caarea | Se ejecuta `invoice.pdf.exe`, lanzado por `powershell.exe` |
| 08:34:55.753 | masstin | `ryan.devlead` inicia sesión por RDP desde `10.10.0.37` |
| 08:35:12.396 | caarea | `explorer.exe` lanza `update.bat` con la cuenta `ryan.devlead` |
| 19:47:26.043 | caarea, allymacb | Se borra `invoice.pdf.exe` |

Leído de arriba abajo ya no son tres pistas. Alguien entra por SSH como administrador y, un segundo después, deja un script, lo engancha a una clave Run y a una tarea programada, y suelta y ejecuta un binario con la fecha falseada. Dos minutos más tarde entra otro usuario por escritorio remoto y la clave Run le ejecuta el script a él. Por la tarde, alguien borra el binario.

## Lo que sabe cada una, y lo que no

Lo interesante de la tabla es que cada fila solo podía darla una herramienta.

- **masstin** sabe quién estaba dentro y desde dónde. No sabe qué hizo.
- **caarea** sabe qué se ejecutó, con qué línea de comandos y quién era el padre. Sabe que el binario colgaba de `sshd.exe`. No sabe desde qué máquina se abrió esa sesión.
- **faramir** sabe que el script va a seguir ejecutándose mañana a las 03:00 y cada vez que alguien inicie sesión. No sabe si llegó a ejecutarse.
- **allymacb** sabe cuándo llegó cada fichero al disco, que uno miente sobre su fecha y que luego se borró. No sabe quién lo trajo.

Las dos sesiones de masstin son las que convierten una lista de artefactos en una secuencia con autor: la de SSH explica quién plantó, y la de RDP explica por qué `update.bat` se ejecutó con una cuenta que no tenía nada que ver.

Y al revés: sin caarea, masstin tendría dos logins normales. Un administrador que entra por SSH y un usuario que abre un escritorio remoto no llaman la atención de nadie.

## Por qué el mismo formato

Para que esa tabla se pueda hacer sin trabajo, las cuatro herramientas (y [etcdump](/es/tools/etcdump-linux-configuration/), para la configuración de Linux) escriben el mismo tipo de fichero:

- **19 columnas**, y cada una en la posición de la que más se le parece en las demás: la hora primero, la máquina después, el tipo de evento, la cuenta, y al final el fichero del que se leyó.
- **La hora en UTC, con anchura fija.** Ordenar el texto es ordenar el tiempo.
- **Las mismas cinco columnas al final:** `hunt`, `hunt_score` y `hunt_why` para lo que encuentra la herramienta; `verdict` y `notes` para lo que decide el analista.

Las tres del hunt usan las mismas palabras en todas: `significant`, `candidate`, `habitual`. Y la misma escala de 0 a 100, que en todas mide lo mismo: lo raro que es eso comparado con lo normal, no la confianza de quien escribió la regla. Un 78 en caarea y un 70 en allymacb se pueden poner en la misma lista.

Las dos últimas columnas son del analista y ninguna herramienta escribe en ellas. Lo que se marca en una timeline se queda en la timeline.

## Lo que falta

Hoy esa tabla se hace a mano: cuatro CSV abiertos y el mismo filtro de hora en cada uno. Funciona, y es mucho mejor que cuatro formatos distintos, pero es trabajo.

La herramienta que las lanza todas sobre un caso, las junta y deja saltar de una fila de ejecución a la sesión que estaba abierta en ese momento está en preparación. Hasta entonces, el visor de [masstin](/es/tools/masstin-viewer/) cubre la parte de los logins, y las demás se leen en cualquier visor de CSV.

Y una advertencia sobre el ejemplo: este caso es limpio porque es un laboratorio. Un servidor de verdad tiene años de actividad alrededor de esos tres minutos, y el hunt de cada herramienta trae más ruido del que se ve aquí. Cada artículo cuenta el suyo. Lo que sí se traslada tal cual a un caso real es el método: una pista en una timeline, el mismo minuto en las otras tres.
