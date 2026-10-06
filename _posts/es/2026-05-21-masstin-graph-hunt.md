---
layout: post
title: "graph-hunt: el movimiento lateral como pregunta estadística"
date: 2026-10-06 09:00:00 +0200
category: tools
lang: es
ref: tool-masstin-graph-hunt
tags: [masstin, graph-hunt, movimiento-lateral, estadistica, hopper, neo4j, memgraph, dfir, deteccion]
description: "graph-hunt de masstin ya no puntúa logins con pesos elegidos a mano. Cada conexión de la ventana se mide contra la propia línea base de la red, el único número que eliges es la tasa de falsos descubrimientos, y la salida es una lista ordenada con el motivo en palabras, una clase de Hopper, la cadena desde cualquier semilla y un informe para el analista. Esto es lo que se ve en una ejecución, cómo decide, y qué encontró en el conjunto público de LANL."
comments: true
---

<video autoplay loop muted playsinline style="display:block; margin: 0 auto 1rem; max-width: 100%; border-radius: 6px;" poster="/assets/images/masstin-graph-hunt-seed.gif">
  <source src="/assets/video/masstin-graph-hunt-seed.mp4" type="video/mp4">
  <img src="/assets/images/masstin-graph-hunt-seed.gif" alt="graph-hunt-csv reconstruyendo la cadena del atacante desde una IP semilla">
</video>

Eso es el caso completo de [DFIR Madness "Szechuan sauce"](https://dfirmadness.com/the-stolen-szechuan-sauce/) en un comando: el timeline que masstin sacó de las dos imágenes de disco, una IP conocida como mala de semilla, y 0,2 segundos después la cadena. El atacante entra en el controlador de dominio como `ADMINISTRATOR` por RDP, el DC llega a la estación de trabajo con el SID del administrador integrado y luego con la cuenta por nombre, y la estación vuelve al DC. Cada salto lleva una certeza: 1 para el login de la propia semilla, 1/55 y 1/63 donde el DC tenía decenas de sesiones abiertas y cualquiera de ellas podía ser la mano en el teclado, 1/9 para la vuelta.

Este artículo va del motor que hay detrás de esa salida. Sustituye al que conté en mayo.

## La pregunta después de `load-*`

Carga un mes de logins de cincuenta máquinas en un grafo y tienes una foto preciosa de quién habla con quién. Responde a las preguntas que ya sabes hacer: qué hizo esta IP, quién usó esta cuenta, qué camino une estos dos hosts en el tiempo. No responde a la que el analista trae de verdad el primer día de un incidente: **de todo lo que pasó después del compromiso, ¿qué es nuevo para esta red?**

El primer graph-hunt la respondía con siete detectores, cada uno con sus pesos, ventanas y mínimos, combinados en una puntuación. En corpus sintéticos iba bien. Con logs reales lo primero que ordenaba era un escáner de vulnerabilidades con credenciales. Cada constante de ese motor era una suposición sobre cómo son las redes, y las redes reales son distintas. Una puntuación de 0,93 no te dice cuántas veces un día benigno puntúa 0,93.

Así que el motor se reescribió alrededor de una idea: **no elijas ningún número; mídelo.** El único parámetro que queda es la tasa de falsos descubrimientos, y la salida es un p-valor por conexión que significa lo que significa un p-valor.

## Qué se ve en una ejecución

```bash
masstin -a graph-hunt-csv -f timeline.csv \
        --investigation-from "2020-09-19 00:00:00" \
        --seed 194.61.24.102 --report hunt.md -o hunt.csv
```

No hay base de datos por medio: `graph-hunt-csv` lee el timeline que escribió cualquier acción `parse-*` y lo calcula todo en memoria. El mismo motor corre sobre un grafo cargado con `graph-hunt` (Memgraph) y `graph-hunt-neo4j`, y da las mismas filas; el grafo sólo está ahí si luego quieres explorar. Ni MAGE, ni GDS, ni ningún plugin.

El terminal te cuenta qué está midiendo antes de contarte qué ha encontrado:

```
[4/4] Computing statistics...
      Machines: 359 graph nodes -> 357 machines (2 IP(s) folded into a host name:
                unanimous same-login evidence, chance coincidence significant at FDR 0.05)
      Panel: 7 destination(s) with continuous login coverage and 7 with failure coverage
             from 2020-09-18 to the cutoff; 1 baseline day(s) form the null
      Connections: 5 new connections tested (origin, destination, account, result, day)
                   against 1 baseline day(s), 4 habitual (p = 1, not tested);
                   0 significant at FDR 0.05 (Benjamini-Hochberg over the new ones)
      Seeds: 1 matched, 4 movement(s) (53 session(s)) reconstructed over 3 machine(s)
      Done: 9 rows in 0.0s
```

Cada línea es una decisión del motor con la que puedes no estar de acuerdo. Dos IPs se han plegado en nombres de host porque los mismos logins aparecen bajo ambos muchas más veces de lo que permite el azar. Siete destinos tienen cobertura de log continua, así que los conteos sólo se comparan sobre ellos. Un solo día de línea base forma el nulo, y por eso aquí nada es significativo: Szechuan trae dos días de logs, y con un día de referencia el motor no puede distinguir "nuevo" de "no visto". Lo dice en lugar de inventarse un umbral. La reconstrucción desde semilla no necesita nulo, así que la cadena sale igual.

## Cómo decide

**La unidad es la conexión.** Un origen, un destino, una cuenta, un resultado (login, fallo, o un toque sin autenticar), en un día UTC. Una conexión que ya ocurrió otro día anterior es habitual: p = 1, nunca se reporta. La caza va siempre y sólo de las nuevas.

**Nuevo quiere decir nuevo para esta red.** Un hecho es nuevo un día cuando no ocurrió ningún día anterior, esté ese día en la línea base o en la ventana. Un día de línea base se juzga por tanto con la misma regla que uno de la ventana, y los días de línea base se convierten en la vara de medir: ¿cuántas veces una conexión nueva tiene esta pinta en un día normal de aquí?

**Diez hechos, un test.** Para una conexión nueva el motor mide qué tiene de nuevo ella y el día de su origen: destinos que el origen alcanza por primera vez, cuentas que nunca había usado, pares cuenta-destino que nadie había hecho, un destino fuera de la comunidad del origen, fallos y toques de preautenticación, un intento rechazado seguido de un login con otra cuenta, un origen sin historia ninguna, el tipo de logon más raro, cuán rápido encadena desde el login que le precedió, el cambio de centralidad del destino. Ninguno tiene peso. Se combinan en un único estadístico conjunto y ese estadístico se calibra contra las conexiones de línea base de la misma red, lo que da un p-valor que sigue siendo válido dependan como dependan las señales entre sí (un p-valor conformal, para quien le guste la estadística). Después, Benjamini-Hochberg sobre todas las conexiones nuevas a la tasa que pediste.

**La cobertura también es un hecho.** Cada fichero de log tiene un intervalo temporal, y los loaders lo escriben en el host al que pertenece. Los conteos sólo se comparan sobre un panel de destinos vigilados de forma continua; un login a un host cuyos logs empiezan el día del incidente se reporta como *no evaluable*, no se ordena como si su novedad significase algo.

**La firma de Hopper ordena las filas.** Ho et al. (USENIX Security 2021) encontraron que el movimiento lateral casi siempre combina un **cambio de credencial** (una cuenta que pertenece a otras máquinas, usada desde una que nunca la usó) con un **acceso nuevo** (un destino nuevo para ese origen o esa cuenta). Hopper leía el dueño de una cuenta de un inventario. masstin lo lee de los logs: de los días con login anteriores de la cuenta, la fracción que vino de su origen más frecuente. Una cuenta que siempre vino de una estación y ahora aparece desde un servidor es un cambio que pesa 1; una cuenta de servicio usada desde 900 máquinas pesa casi nada. Dentro del conjunto significativo van primero los cambios con acceso nuevo, luego las cuentas desconocidas, luego los destinos nuevos con credencial habitual (escáneres, orquestación, un administrador con su propia cuenta), luego el resto. El p-valor no se toca; la clase es lo primero que lees.

## Leer la salida

El CSV tiene una fila por conexión, la más inusual primero:

```
rank, significant, p_value, q_value, day, first_seen_utc, last_seen_utc, origin, destination,
account, result, events, logs, signature, why_unusual, evidence, chain, campaign, cypher_snippet
```

`why_unusual` es el motivo en frases cortas: *origin never seen before; that day the origin reached 29 destination(s) for the first time; the account belongs elsewhere: 100% of its earlier login-days came from C8198*. `evidence` repite cada motivo con el conteo de línea base que hay detrás, de modo que toda afirmación se puede comprobar. `signature` es la clase de Hopper, un único valor para filtrar. `chain` es el lugar de la conexión en la reconstrucción desde semilla cuando diste una.

Con `--report hunt.md` tienes además una historia por cada origen con alguna conexión significativa: si existía en la línea base y qué solía hacer, qué hizo en la ventana por fases cronológicas, por qué cada fase es inusual con el conteo detrás de cada afirmación, de quién son las cuentas que usó por primera vez, sus caminos causales, los orígenes con los que se mueve, y tres párrafos que me descubrí escribiendo a mano en cada caso antes de que se generasen: *podría ser benigno si*, *para descartarlo*, y *eventos que pedir* (los eventos crudos de Windows o Linux que lo zanjan, elegidos según las familias de log que registraron al origen). En Neo4j cada origen termina con una consulta para el Browser que dibuja exactamente ese subgrafo.

Dos entradas más, ambas opcionales. `--seed` es lo que enseña el vídeo: hosts, IPs o cuentas que ya sabes que son malas, seguidas por las sesiones que abrieron hasta el final del día, con una certeza en cada salto y una consulta Cypher que dibuja la cadena. `--sigma` toma la salida JSON de [Hayabusa](https://github.com/Yamato-Security/hayabusa) o [Chainsaw](https://github.com/WithSecureLabs/chainsaw): una regla que saltó en una máquina mientras había una sesión de login abierta en ella se convierte en una señal medida más de esa conexión, y la explicación nombra la regla, la hora y el nivel. masstin no detecta PsExec ni WMI por sí mismo; une lo que esas herramientas encontraron al login que lo hizo posible.

## ¿Funciona?

Una medición, con una verdad de referencia que no fabriqué yo.

**Un benchmark público.** El conjunto ["Comprehensive, Multi-Source Cyber-Security Events"](https://csr.lanl.gov/data/cyber1/) de Los Álamos es la referencia que usa todo artículo sobre movimiento lateral: 58 días de una empresa real, 1.050 millones de eventos de autenticación, 749 logins del equipo rojo etiquetados. Se convirtió a un timeline de masstin como se vería una recogida DFIR (los logs de las máquinas del equipo rojo más otras 200, sólo cuentas de usuario, 16 días, corte en el día 7) y se corrió con `graph-hunt-csv`: 21,3 millones de filas, 14 minutos, 3,3 GB de memoria.

| | valor |
|---|---:|
| conexiones en la ventana | 465.074 |
| conexiones del equipo rojo entre ellas | 444 |
| significativas a FDR 5 % | 204: 185 del equipo rojo, 19 de una máquina sin etiquetar que falló en 47 hosts y luego entró con 7 cuentas nuevas para ella |
| precisión de las 100 primeras filas | 99 % |
| conexiones del equipo rojo en las 500 primeras filas | 286 de 444 |
| periodo sin incidente (días 40 a 43, 241.423 conexiones) | 0 significativas |

Lo que no caza también está en la tabla: la segunda máquina del equipo rojo hizo un login discreto por host con un usuario distinto cada vez, y la línea base de esta red contiene ese patrón miles de veces al día (gente usando su propia cuenta desde una máquina nunca vista). Ningún método sobre el grafo de logins detecta eso sin un inventario de quién es dueño de qué máquina; los propios fallos de Hopper son de ese tipo. Para situarlo, Hopper reporta un 94,5 % de detección a unas nueve alertas al día con inventario y dos meses de entrenamiento; el mejor resultado con redes neuronales de grafos sobre LANL reporta una precisión media de 0,32 que cae a 0,09 con etiquetado justo (Larroche, 2026).

## Cuándo no usarlo

Dos días de logs no son una línea base; la ejecución de Szechuan de arriba lo dice ella misma. El triaje de un solo host no tiene red con la que comparar. Y un atacante que hace un login con la cuenta de la víctima desde la estación de la víctima no ha hecho nada nuevo para la red; para eso están la reconstrucción desde semilla y la corroboración con Sigma.

## Pruébalo

`graph-hunt-csv`, `graph-hunt` y `graph-hunt-neo4j` van en [masstin v1.1.0](https://github.com/jupyterj0nes/masstin/releases/latest), un binario para Windows, Linux y macOS.

```bash
masstin -a parse-massive -d /evidencias/caso/ -o timeline.csv
masstin -a graph-hunt-csv -f timeline.csv --investigation-from "2026-03-15 00:00:00" \
        --report hunt.md -o hunt.csv
```

El diseño, con el porqué de cada decisión y los supuestos sobre los que descansa, está en [docs/graph-hunt-statistics.md](https://github.com/jupyterj0nes/masstin/blob/main/docs/graph-hunt-statistics.md); las opciones y las columnas de salida en [docs/graph-hunt.md](https://github.com/jupyterj0nes/masstin/blob/main/docs/graph-hunt.md). Si ordena algo mal con tus datos, en cualquiera de los dos sentidos, lo más útil que puedes mandar es un issue con una fila anonimizada y su columna `evidence`.

---

## Relacionado

| Tema | Enlace |
|------|--------|
| Página principal de masstin | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Visualización con Neo4j y Cypher | [neo4j-cypher-visualization](/es/tools/neo4j-cypher-visualization/) |
| Visualización en memoria con Memgraph | [memgraph-visualization](/es/tools/memgraph-visualization/) |
| Formato CSV y clasificación de eventos | [masstin-csv-format](/es/tools/masstin-csv-format/) |
| Hopper: Modeling and Detecting Lateral Movement (Ho et al., USENIX Security 2021) | [usenix.org](https://www.usenix.org/conference/usenixsecurity21/presentation/ho) |
