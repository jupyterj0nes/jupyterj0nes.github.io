---
layout: post
title: "graph-hunt: detección automatizada de movimiento lateral en Memgraph y Neo4j GDS"
date: 2026-05-21 09:00:00 +0100
category: tools
lang: es
ref: tool-masstin-graph-hunt
tags: [masstin, graph-hunt, movimiento-lateral, neo4j, memgraph, gds, mage, dfir, deteccion]
description: "Cargar un timeline de movimiento lateral en un grafo es una cosa; aflorar automáticamente los patrones sospechosos es otra. graph-hunt de masstin corre siete detectores (novel edge, chain motif, PageRank/betweenness spike, community bridge, credential rotation, rare logon type) contra un grafo ya cargado y produce un CSV de findings rankeado. Funciona contra Memgraph (MAGE) y Neo4j (GDS 2.x) — este post documenta requisitos, setup y el modelo de detectores."
comments: true
---

## El problema después de `load-*`

Un timeline de masstin cargado en Memgraph o Neo4j te da un grafo precioso de quién-habla-con-quién. Puedes lanzar queries de caminos, puedes pivotar desde un IOC conocido hacia fuera, puedes localizar a ojo clusters con pinta rara. Eso funciona cuando ya sabes qué buscas.

El grafo no ayuda cuando NO lo sabes. Cientos de miles de aristas en la evidencia de un incidente real, y el camino del atacante es una anomalía estructural rara escondida en una masa de actividad legítima de administración. Navegar a mano no la va a encontrar; las queries por IOC concreto tampoco si el atacante usó credenciales robadas válidas. Hace falta un pase analítico sobre el grafo que aflore los patrones que **estadísticamente no encajan con la baseline**.

`masstin -a graph-hunt` (Memgraph) y `masstin -a graph-hunt-neo4j` (Neo4j) hacen exactamente eso. Cogen un grafo ya cargado y un cutoff temporal, parten los datos en baseline (eventos previos al cutoff) y ventana de investigación (eventos en o después), y ejecutan siete detectores contra ese split. Cada detector emite findings con score, host, ventana temporal, resumen textual y un snippet de Cypher para reproducir el subgrafo que produjo la alerta.

## Los siete detectores

Cada detector ataca una firma distinta del atacante. Son deliberadamente redundantes — la mayoría de ataques reales encienden tres o cuatro, lo que le da al analista corroboración en vez de una única señal frágil.

| Detector | Qué captura |
|----------|-------------|
| **`novel-edge`** | Una arista en la ventana de investigación donde (origen, destino) nunca apareció en baseline, O el usuario era nuevo para ese destino, O el logon type era nuevo para ese destino. Tres ejes de novedad independientes; el score es la fracción que dispara (1.0 = los tres nuevos, 0.33 = uno). |
| **`chain-motif`** | Cadenas A→B→C en la ventana donde cada salto consecutivo pasa en menos de 5 minutos Y el usuario cambia entre saltos. Firma clásica de movimiento lateral conducido por operador: aterrizar en B con una credencial, pivotar inmediatamente a C con otra distinta. Requiere al menos un salto novel (par origen→destino no visto en baseline) para disparar, así las cadenas legítimas de baseline con usuarios diferentes no causan falsos positivos. |
| **`pagerank-spike`** | Un host globalmente importante en el grafo (PageRank alto) Y que recibe una fracción anormalmente novel de su tráfico entrante en la ventana. La firma clásica del pivot: un host que ya importaba por razones legítimas (muchos sistemas le hablan) y que de repente empieza a oír de fuentes o a un ritmo que nunca antes. Usa un gate MIN_BASELINE_EDGES y un z-score MAD sobre la distribución de novelty para no disparar en hosts con historial escaso. |
| **`betweenness-spike`** | Misma forma que PageRank-spike pero con betweenness centrality. Donde PageRank mide "qué importancia tiene este nodo desde la perspectiva de un random walk", betweenness mide "cuántos caminos más cortos entre otros nodos pasan por este" — más cercano a la noción operativa de pivot. Los dos detectores son deliberadamente redundantes; se corroboran mutuamente en pivots reales y discrepan en casos límite. |
| **`community-bridge`** | Ejecuta detección de comunidades Louvain sobre el grafo completo, luego recorre cada arista de la ventana de investigación buscando la firma canónica de "puente a una isla nueva": una arista cuyo origen y destino están en comunidades diferentes Y el origen nunca antes había tocado un nodo de la comunidad del destino. Las redes AD se agrupan naturalmente por función y geografía (HR habla con HR, la filial Norte habla consigo misma, los DCs replican entre ellos), así que un puente cross-community estrenado es señal fuerte. |
| **`cred-rotation`** | Un único host fuente que usa muchas identidades de usuario distintas en la ventana es la firma canónica de pass-the-hash o credential spraying: el atacante volcó múltiples sets de credenciales y está probando cuáles siguen funcionando, o pivotando a través de cada una en secuencia. El detector exige al menos tres usuarios **y** al menos dos novel respecto a la baseline de esa fuente — así un host de infraestructura que legítimamente usa su set estable de cuentas de servicio cada día no dispara. |
| **`rare-logon-type`** | Una arista en la ventana cuyo logon_type es raro en la baseline PARA LA CLASE DEL HOST DESTINO. La estratificación importa: logon_type=0 es el centinela del loader para fuentes no-Windows (SSH Linux via wtmp) — legítimo en destinos Linux pero globalmente raro en un corpus mixto. Un test global ingenuo de rareza dispara una avalancha de falsos positivos en cada evento SSH Linux. Estratificado por clase, el detector mantiene su filo sobre los objetivos reales: tipos como 9 (NewCredentials), 8 (NetworkCleartext), 11 (CachedInteractive), tipos exóticos apareciendo de repente en hosts Windows. |

La redundancia es el punto. En el corpus sintético de evaluación, cada escenario de ataque enciende de tres a seis de estos detectores — incluso escenarios adversariales diseñados para evadir detectores específicos (un ataque "living off the land" desde la jumpbox habitual de un admin hacia un DC que ese admin usa todos los días, sin ningún eje de novelty) los acaba pillando `betweenness-spike` y `rare-logon-type` porque el destino es un hub de alto betweenness y la combinación de tipo resulta rara para ese par (fuente, destino) específico.

## Dos motores, dos librerías de procedures

`graph-hunt` y `graph-hunt-neo4j` implementan los mismos siete detectores pero llaman a librerías de algoritmos de grafo distintas:

- **Memgraph (`graph-hunt`)** usa **MAGE** — Memgraph Advanced Graph Extensions. MAGE se distribuye **bundleada con la instalación por defecto de Memgraph**; no hay nada extra que instalar ni configurar. PageRank, Louvain y betweenness están disponibles como `pagerank.get()`, `community_detection.get()` y `betweenness_centrality.get()` nada más arrancar la BD.
- **Neo4j (`graph-hunt-neo4j`)** usa la **librería Graph Data Science (GDS) de Neo4j**. GDS es **un plugin aparte** que hay que instalar en la instancia Neo4j destino. masstin usa la **API de GDS 2.x** (`gds.graph.project`, `gds.pageRank.stream`, `gds.louvain.stream`, `gds.betweenness.stream`), lo que significa que se requiere **Neo4j 5.x o posterior** (Neo4j 4.x fue la última que usaba GDS 1.x con el nombre viejo `gds.graph.create`).

Ambos motores alcanzan el mismo 100% de recall / 98%+ de precisión en los corpus de evaluación usados durante el desarrollo, pero los detalles operativos difieren.

## Configurar Memgraph para `graph-hunt`

Memgraph no requiere pasos extra. La imagen Docker trae MAGE bundleada; la instalación nativa trae MAGE bundleada; en cualquier caso, tras `docker run ...` o `systemctl start memgraph`, las procedures están disponibles. Carga tu timeline y ejecuta graph-hunt:

```bash
masstin -a load-memgraph -f timeline.csv --database bolt://localhost:7687 --ungrouped
masstin -a graph-hunt --database bolt://localhost:7687 \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

El flag `--ungrouped` en la carga es importante: los detectores `chain-motif` y `cred-rotation` de graph-hunt necesitan timestamps por evento para evaluar el gap de 5 minutos del salto y los patrones de rotación por usuario. Una carga agrupada colapsa todos los eventos entre la misma tupla (src, user, type, dst) en una única arista con el timestamp más temprano, lo que destruye la granularidad temporal que esos detectores necesitan. Los otros cinco detectores funcionan en ambos modos, pero ungrouped es el setup recomendado para hunting activo.

## Configurar Neo4j Desktop para `graph-hunt-neo4j`

Paso a paso desde una instalación limpia de Neo4j Desktop:

### 1. Crear la instancia

En Neo4j Desktop, **Create instance** → elige **Neo4j 5.x o posterior** (la API GDS 2.x de masstin necesita 5.x; los kernels modernos 2026.x funcionan). Pon una contraseña — para el resto del post asumimos que la variable de entorno `NEO4J_PASSWORD` la lleva.

### 2. Instalar el plugin Graph Data Science

Aquí es donde ocurren la mayoría de errores de setup. La instalación del plugin son dos partes: copiar el JAR a la carpeta `plugins/` de la instancia, y reiniciar el JVM para que cargue las procedures. Neo4j Desktop maneja ambas **si lo haces vía la UI** en este orden:

1. Abre la instancia en Desktop (click sobre ella).
2. Click en el menú **`...`** (esquina superior derecha de la tarjeta de la instancia).
3. Elige **Plugins**.
4. Localiza **Graph Data Science** en la lista.
5. Click **Install**. Espera a que el badge cambie a **Installed** (10-30 segundos, según si Desktop tiene el JAR cacheado).
6. **Reinicia la instancia.** Desktop no reinicia automáticamente — tienes que pararla y arrancarla a mano para que el JVM cargue el plugin recién instalado.

### 3. Verificar que GDS está vivo

Tras el reinicio, abre la pestaña Query de la instancia y lanza:

```cypher
CALL gds.version()
```

Si te devuelve una cadena de versión (ej. `2026.04.0`), el plugin está cargado y estás listo. Si te devuelve `Neo.ClientError.Procedure.ProcedureNotFound`, el JAR está en `plugins/` pero el JVM no lo cargó — reinicia el DBMS otra vez. Esto ocurre ocasionalmente cuando Desktop reporta la instalación antes de que el JVM realmente recoja el fichero.

También puedes listar las procedures que masstin va a llamar para asegurarte:

```cypher
SHOW PROCEDURES YIELD name
WHERE name STARTS WITH 'gds.graph.project'
   OR name STARTS WITH 'gds.pageRank.stream'
   OR name STARTS WITH 'gds.louvain.stream'
   OR name STARTS WITH 'gds.betweenness.stream'
RETURN name
```

Las cuatro familias deberían aparecer. Si no aparecen — y `SHOW PROCEDURES YIELD name WHERE name STARTS WITH 'gds.'` no devuelve nada — el plugin cargó pero sus procedures fueron **denegadas por el allowlist**. Esto es un footgun real en Neo4j 2026.x: el kernel ship con `dbms.security.procedures.allowlist` puesto a `apoc.*,genai.*,ai.*` por defecto, y el plugin manager de Desktop **no actualiza esa lista cuando se instala GDS vía la UI**. El JAR del plugin acaba en `plugins/`, el log de arranque muestra `Graph Data Science extension built`, y aun así cada procedure `gds.*` se rechaza en silencio al registro con un WARN en `logs/debug.log`:

```
WARN  The procedure 'gds.X' is not on the allowlist and won't be loaded.
```

Fix: abre `conf/neo4j.conf` en la carpeta de la instancia (el botón **Open folder** de la tarjeta de la instancia en Desktop te lleva ahí) y edita ambas líneas:

```
dbms.security.procedures.unrestricted=apoc.*,gds.*
dbms.security.procedures.allowlist=apoc.*,genai.*,ai.*,gds.*
```

Luego reinicia la instancia. Las procedures pasan a ser visibles vía `SHOW PROCEDURES` y llamables desde masstin.

### 4. Ejecutar graph-hunt-neo4j

```bash
NEO4J_PASSWORD='tu-pass' masstin -a load-neo4j \
    -f timeline.csv --database bolt://localhost:7687 --user neo4j --ungrouped

NEO4J_PASSWORD='tu-pass' masstin -a graph-hunt-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

### 5. Setups multi-database: `--db`

Neo4j 5.x soporta múltiples bases de datos nombradas por instancia. masstin va por defecto a la `neo4j` estándar, pero si mantienes cada caso (o cada entorno) en su propia base de datos, pasa `--db <nombre>` tanto a `load-neo4j` como a `graph-hunt-neo4j`:

```bash
NEO4J_PASSWORD='tu-pass' masstin -a load-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --db caso-2026-03-cliente-x \
    -f timeline.csv --ungrouped

NEO4J_PASSWORD='tu-pass' masstin -a graph-hunt-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --db caso-2026-03-cliente-x \
    --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

Usuarios de Aura: el nombre de la base de datos sale de la consola de Aura; el resto es idéntico.

## Dimensionar el heap para corpus DFIR

El heap por defecto de Neo4j (1 GB) está bien hasta aproximadamente 2-3 millones de aristas. Más allá, la proyección en memoria de GDS crece por encima del heap y el hunt o bien falla con OOM o se machaca contra la garbage collection. Para capturas DFIR que rondan 5-15 millones de aristas (una sola red de un dominio con Security.evtx + UAL + SSH + Cortex de 90 días de investigación), el heap necesita más margen.

En Neo4j Desktop:

1. Para la instancia.
2. Menú **`...`** → **Settings** (o abre `conf/neo4j.conf` en la carpeta de la instancia).
3. Sube las líneas relevantes:

```
server.memory.heap.initial_size=2G
server.memory.heap.max_size=6G
server.memory.pagecache.size=2G
```

4. Arranca la instancia de nuevo.

Un heap de 6 GB maneja cómodamente 15 M de aristas + la proyección GDS en un PC de escritorio moderno. Si vas a cargar algo genuinamente grande (50+ M aristas), sube a 12-16 GB o ejecuta sobre un servidor dedicado con las recomendaciones de dimensionamiento apropiadas de Neo4j Enterprise.

Los defaults de Memgraph manejan grafos más grandes sin tocar nada porque MAGE no construye una proyección separada — recorre el grafo vivo. No hay paso equivalente de tuning de heap para usuarios de Memgraph.

## Filtrar detectores

Si el analista solo quiere señales específicas (digamos, solo los detectores temporales durante triage inicial, o solo los estructurales al re-correr sobre un grafo stale), los flags `--only-detectors` y `--skip-detectors` aceptan una lista separada por comas de nombres de detectores. Los dos son mutuamente excluyentes.

```bash
# Ejecutar solo los detectores estructurales (no requieren timestamps por evento)
masstin -a graph-hunt-neo4j --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" \
        --only-detectors novel-edge,community-bridge,pagerank-spike,betweenness-spike,rare-logon-type \
        -o findings.csv

# Saltarse los detectores GDS pesados en una re-corrida rápida
masstin -a graph-hunt-neo4j --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" \
        --skip-detectors pagerank-spike,betweenness-spike,community-bridge \
        -o findings.csv
```

## Leyendo el CSV de findings

La salida tiene esta forma:

```
rank,score,detector,host,time_window,summary,cypher_snippet
1,0.93,betweenness-spike,JUMP-HQ-02,from 2026-03-15T00:00:00,"JUMP-HQ-02: betweenness=204.5, novelty_ratio=0.46 ...","MATCH (a:host)-[r]->(b:host {name:'JUMP-HQ-02'}) WHERE r.time >= datetime('2026-03-15T00:00:00') RETURN a, r, b"
2,0.85,chain-motif,JUMP-HQ-02,2026-03-15T11:01:20 .. 2026-03-15T11:03:00,"Pivot via JUMP-HQ-02: WKS-FIN-02 -[HEIDI.IT]-> JUMP-HQ-02 -[ALICE.ADMIN]-> DC02-HQ ...","MATCH ..."
...
```

`rank` es el orden global por score (mayor primero). `score` es específico del detector pero normalizado a [0, 1]. `host` es el foco de la alerta — para la mayoría de detectores es el destino; para `chain-motif` es el pivot (nodo intermedio B); para `cred-rotation` es la fuente. El `cypher_snippet` es una query lista para pegar que reproduce el subgrafo productor de la alerta en Neo4j Browser o Memgraph Lab, así el analista pasa inmediatamente de "qué es la alerta" a "qué pinta tiene realmente".

Un workflow de triage DFIR real se ve así:

1. Ordena los findings por score (ya hecho — vienen pre-ordenados).
2. Para cada uno de los top N (típicamente 20-30), copia el `cypher_snippet` en la UI de la BD de grafo y mira el subgrafo.
3. Si es claramente legítimo (ej. un host de monitoring SCCM con 200k aristas baseline disparando `betweenness-spike` por una oleada rutinaria de parches), lo descartas y sigues.
4. Si es sospechoso, sigue las aristas hacia fuera — el snippet solo muestra el subgrafo directamente involucrado; la query de path temporal del post principal de masstin encuentra la ruta cronológicamente coherente.

## Qué pinta tiene el eval

`graph-hunt-neo4j` se valida sobre un harness de doble corpus — un **corpus pequeño de control** que reproduce una baseline conocida, y un **corpus de estrés** que modela una empresa de 200 hosts / 85 cuentas. El framework de eval vive fuera del repo de masstin (los fixtures de test no pertenecen a la distribución de la herramienta) pero la metodología es reproducible:

1. **Generador de topología** que construye una red AD sintética (DCs, fileservers, jumpboxes, workstations en múltiples clusters y una DMZ) con modelos realistas de retención por-host para Security.evtx (3-60 días según clase de host), UAL (24 meses), wtmp (30 días), y el resto de la matriz de fuentes de la que tiran las capturas reales.

2. **Modelo de actividad de baseline**. 90 días de tráfico legítimo de 70+ identidades de usuario + 13 cuentas de servicio. El modelo está calibrado contra fuentes empíricas publicadas en vez de muestreo aleatorio uniforme, que produce tasas de novedad irrealmente altas a escala:

   - **Perfil persistente por usuario**: una única workstation primaria recibe el 88-96% de los logons del usuario (hallazgo de sparsity de Kent & Liebrock sobre grafos de autenticación; guía CISA AA23-059A sobre Privileged Access Workstations), con workstation secundaria opcional y cola rara de hot-desk.
   - **Destinos en niveles** muestreados con Zipf exponente ~1.2 dentro de tres tiers: un set "core" pequeño que cubre el 80% de eventos, un set "occasional" que cubre el 15%, y una cola larga "rare" del 5% (el corpus enterprise de Hopper, USENIX Security 2021, observó un ratio raw-a-significativo de 222× que este tiering reproduce).
   - **Cuentas de servicio** con sets de objetivos scoped y fijos — el client-push de SCCM toca el estate gestionado, DNS/DHCP se quedan en los DCs que alojan el rol, los backups recorren fileservers + DCs — en vez de uniforme sobre todos los servidores (investigación SCCM de SpecterOps; premisa de baselining de Microsoft Defender for Identity).
   - **Ratio 3:1 weekday/weekend** para humanos, plano 24/7 para servicios (benchmarks de productividad tipo ActivTrak/BLS).

   El baseline resultante tiene una tasa de aristas-nuevas en la ventana de investigación de ~6% sobre ternas — cercano al <1% que entornos productivos maduros exhiben según la literatura de baselines de 30 días de MDI, con la diferencia residual atribuible a inyecciones de ataques y churn modelado de empleados.

3. **Escenarios de ataque** inyectados en los últimos 7 días: 22 escenarios cubriendo técnicas MITRE estándar (initial-access dump + lateral, cred-spray, Kerberoasting, golden/silver ticket, DCSync, internal-recon, WMI lateral, cadenas de creación de servicios, pivot VPN, exfil de insider, etc.) más 5 escenarios explícitamente adversariales diseñados para evadir detectores específicos (living-off-the-land sin eje de novelty, slow-burn cred theft, lateral intra-cluster, distributed-user, pivot vía host de servicio).

4. **Patrones legítimos-pero-novedosos** también inyectados y NO en el fichero truth: onboarding de nuevo empleado, promoción de helpdesk a admin, formación de equipo de proyecto, test de DR, Patch Tuesday, visita de auditor externo. Si un detector dispara sobre ellos cuenta como falso positivo — mide la resiliencia frente a ruido realista.

5. **Eval harness** que clasifica cada finding TP/FP contra el fichero truth (host + ventana temporal con tolerancia ±2 minutos) y computa precision/recall por detector, por escenario, y **Precision@K** (calidad del triage top-K, la métrica que realmente importa para el flujo DFIR).

### Resultados actuales

Dos preguntas importan al evaluar una herramienta de triage DFIR: **cuánto reduce el trabajo del analista**, y **¿se pierde ataques?**. `graph-hunt-neo4j` se evalúa contra ambas.

Sobre el corpus de estrés — 3.87M eventos, 200 hosts, 85 cuentas, baseline de 90 días + ventana de investigación de 7 días con 23 escenarios de ataque inyectados (22 canónicos de MITRE + 5 adversariales + 6 señuelos legítimos-pero-novedosos) — la herramienta emite **380 alertas priorizadas**, una **reducción de 10,190×** sobre el flujo bruto de eventos. De esas 380 alertas, **252 son ataques reales (66.3% hit rate)**. La base rate de ataques en los eventos brutos es ~0.003%, así que el factor de enrichment sobre muestreo aleatorio es de aproximadamente **23,300×** — un analista revisando el output de graph-hunt es veintitrés mil veces más eficiente encontrando lateral movement que revisando logs al azar.

En el lado del recall, **109 de los 110 eventos de ataque inyectados fueron detectados (99.1%)**, y **23 de 23 escenarios** fueron pillados por al menos un detector. El único evento perdido pertenece a un escenario de 3 eventos que otros dos detectores sí marcaron — al nivel de escenario, no se perdió nada.

La calidad de la cima de la lista es lo que dirige el workflow real de triage: **P@10 = 90%** significa que las primeras 10 alertas que revisa el analista contienen 9 ataques reales; **P@20 = 85%** soporta un ciclo de revisión diaria de 20 alertas; **P@50 = 92%** significa que incluso una revisión exhaustiva de 50 alertas diarias es prácticamente sin ruido.

**Control (5M aristas, 50 hosts, 14 usuarios, 14 escenarios)**:

| Findings | TP | FP | Hit rate | Recall (eventos) | Recall (escenarios) | P@10 | P@20 | P@50 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 83 | 83 | 0 | **100.0%** | **100%** | **14/14** | 100% | 100% | 100% |

El falso positivo histórico de SCCM que vivió en este corpus durante dos años desapareció — `betweenness-spike` ahora compara la centralidad de cada host contra un snapshot baseline-only del grafo, así que los hubs estructurales que siempre fueron centrales no salen como anomalías (Times Square no se vuelve "sospechoso" solo porque tiene mucho tráfico). Solo los hosts cuya centralidad creció genuinamente durante la ventana de investigación disparan.

**Estrés (3.87M aristas, 200 hosts, 85 cuentas, 23 escenarios)**:

| Findings | TP | FP | Hit rate | Recall (eventos) | Recall (escenarios) | P@10 | P@20 | P@50 | P@100 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 380 | 252 | 128 | **66.3%** | **109/110 (99.1%)** | **23/23 (100%)** | **90%** | **85%** | **92%** | **73%** |

P@50 = 92% — un detalle que merece la pena destacar: la precisión sube entre K=20 y K=50 en este corpus porque los pocos FPs de alto score residuales de los detectores de centralidad (hubs legítimos como servidores de monitorización que viven un pico real de actividad) se concentran en lo más alto del ranking, mientras que las posiciones 20-50 están dominadas por findings limpios de triple-novelty. Un analista revisando los primeros 50 ve casi nada de ruido.

### Notas algorítmicas

Cuatro cambios de detectores contribuyeron materialmente a los números del estrés:

1. **`betweenness-spike` y `pagerank-spike` usan un delta two-snapshot**. Se crea una proyección GDS baseline-only (`mass-hunt-baseline`, aristas con `r.time < cutoff`) junto a la del grafo completo, se computa betweenness/PageRank en ambas, y se emiten findings solo cuando la centralidad de un host creció materialmente entre las dos snapshots. Suprime la clase entera de falsos positivos de "hub estructural" (SCCM, jumpboxes, granjas Citrix) que la centralidad single-snapshot siempre marca.

2. **`community-bridge` corre Louvain sobre la proyección baseline-only más el mismo gate de contexto destination-density + origin-fanout que novel-edge** (mismo patrón two-snapshot). Hallazgo crítico: correr Louvain sobre el grafo completo (baseline + ventana) deja que las aristas del atacante de la ventana muevan las fronteras de comunidades — el algoritmo puede absorber un bridge de lateral movement en una sola comunidad, ocultándole el salto cross-cluster al detector por completo. Congelar la estructura de comunidades al estado pre-cutoff vía Louvain baseline-only restauró la visibilidad sobre 10 escenarios de ataque a los que la versión anterior sobre grafo completo era algorítmicamente ciega (chain-pivot, cred-spray, dcsync, golden-ticket, kerberoasting, service-creation-chain, silver-ticket, slow-burn-creds, svc-account-abuse, wmi-lateral). El gate de contexto entonces suprime la clase residual de FPs — hosts de infraestructura (monitorización/SIEM/SCCM/backup) bridging hacia comunidades pequeñas — filtrando orígenes con out-degree de baseline por encima del 30% del estate y destinos con muy pocos eventos de baseline. Efecto combinado: la precision de community-bridge subió de ~17% (Louvain single-snapshot sobre grafo completo) a **66.7%**, sin perder ningún true positive.

3. **`novel-edge` usa la novelty de terna (origen, usuario, destino)** más un gate de contexto destination-density + origin-fanout. La novelty de terna reemplaza el test disyuntivo de 3 ejes anterior (par-novel OR usuario-novel OR logon-type-novel) — captura la firma canónica de lateral movement directamente e incluye el caso "ambos sub-pares conocidos en baseline pero nunca como el mismo evento" (firma clásica de host comprometido + credencial robada) que el test disyuntivo perdía. El gate de contexto entonces suprime dos clases residuales de FP a escala: destinos con muy pocos eventos en baseline (donde la novelty es un artefacto de cobertura, no anomalía) y orígenes que hablaron con más de ~30% del estate en baseline (servicios, agentes de monitorización — las ternas nuevas desde esos orígenes son rotación operacional, no señal). La señal de logon-type se delega al detector dedicado `rare-logon-type`, que la trata con estratificación por clase de host.

4. **Resiliencia del ciclo de vida de proyección GDS 2.x**. Cada detector algorítmico llama `ensure_projection()` al arrancar, recreando defensivamente la proyección si ha desaparecido del catálogo entre llamadas consecutivas. Requerido porque el catálogo GDS por-base-de-datos puede desincronizarse entre sesiones Bolt en Neo4j 2026.x.

### Paridad entre backends: Neo4j vs Memgraph

Los números de arriba son sobre Neo4j 2026.x + GDS 2.x. La variante Memgraph de `graph-hunt` comparte el mismo refactor de triple-novelty y la lógica de context gate para `novel-edge` y `community-bridge`, así que las mejoras más impactantes de detectores shippean en ambos backends. Sin embargo, MAGE (la librería algorítmica de Memgraph) no expone variantes `_subgraph` para `pagerank.get` ni `betweenness_centrality.get` — solo para community detection (Louvain y Leiden). Esto significa que el patrón two-snapshot de centralidad no se puede replicar en Memgraph sin manipulación destructiva de aristas (DELETE/restore) o workarounds basados en peso que no son estructuralmente equivalentes, ninguno de los cuales es aceptable para una herramienta de incident response.

La variante Memgraph mantiene por tanto el scoring single-snapshot para `pagerank-spike` y `betweenness-spike`. En el corpus pequeño de control esto produce igualmente **100% P@10 / 100% P@20 / 100% recall de escenarios** — operacionalmente idéntico para triage top-K. El trade-off es ~13 puntos porcentuales menos de precisión overall que Neo4j, concentrados en la cola larga (posiciones 50+) donde los workflows de triage DFIR típicamente no llegan. Recomendación: Memgraph para corpus hasta ~5M aristas; Neo4j para stress enterprise mayor.

## Cuándo `graph-hunt` NO es la herramienta correcta

Dos límites merecen mención explícita:

- **Ataques puros de arista única**: un atacante que se loguea una vez, accede a un fichero, y se desloguea — sin ninguna de las anomalías estructurales que los detectores atacan — no encenderá nada. `graph-hunt` es un complemento a la revisión manual y al matching de IOCs, no un reemplazo.
- **Grafos muy escasos**: si el timeline cargado solo tiene unos cientos de aristas (un triage pequeño de un único host, por ejemplo), no hay suficiente baseline para computar distribuciones de novelty significativas. Los detectores correrán pero las alertas no serán estadísticamente significativas. Usa `graph-hunt` sobre grafos de al menos unos pocos miles de aristas abarcando múltiples hosts.

## Pruébalo

`graph-hunt` y `graph-hunt-neo4j` shippean en **masstin v0.13** y posteriores. Los binarios pre-compilados están en la [página de Releases](https://github.com/jupyterj0nes/masstin/releases) — no se necesita toolchain de Rust.

```bash
# Parsear evidencia, cargar en Memgraph, hunt
masstin -a parse-massive -d /evidence/2026-03-cliente-x/ -o timeline.csv
masstin -a load-memgraph -f timeline.csv --database bolt://localhost:7687 --ungrouped
masstin -a graph-hunt --database bolt://localhost:7687 \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv

# Lo mismo en Neo4j (plugin GDS requerido — ver setup arriba)
NEO4J_PASSWORD='tu-pass' masstin -a load-neo4j \
        -f timeline.csv --database bolt://localhost:7687 --user neo4j --ungrouped
NEO4J_PASSWORD='tu-pass' masstin -a graph-hunt-neo4j \
        --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

Si un detector se comporta mal en tus datos (falsos positivos que no puedes explicar, o patrones de ataque que debería haber pillado), abre un issue en el [repo de masstin](https://github.com/jupyterj0nes/masstin/issues) con un subgrafo de muestra sanitizado — el tuning de detectores es un proceso continuo y el feedback de casos reales es el input más útil.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Página principal de Masstin | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| README — Detect lateral movement: graph-hunt | [`README.md#detect-lateral-movement-graph-hunt`](https://github.com/jupyterj0nes/masstin#detect-lateral-movement-graph-hunt) |
| Visualización Neo4j y Cypher | [neo4j-cypher-visualization](/es/tools/neo4j-cypher-visualization/) |
| Visualización Memgraph en memoria | [memgraph-visualization](/es/tools/memgraph-visualization/) |
| Formato CSV y clasificación de eventos | [masstin-csv-format](/es/tools/masstin-csv-format/) |
| Parsing de imágenes forenses + recuperación VSS | [masstin-vss-recovery](/es/tools/masstin-vss-recovery/) |
