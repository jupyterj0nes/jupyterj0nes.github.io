---
layout: post
title: "Memgraph: Visualización de movimiento lateral en memoria"
date: 2026-04-07 04:00:00 +0100
category: tools
lang: es
ref: tool-masstin-memgraph
tags: [masstin, memgraph, cypher, grafos, lateral-movement, visualization]
description: "Guía para visualizar movimiento lateral con Memgraph y masstin: base de datos de grafos en memoria, instalación con Docker y queries Cypher para análisis de incidentes."
comments: true
---

## ¿Qué es Memgraph?

Memgraph es una base de datos de grafos **en memoria** y de código abierto. Utiliza openCypher como lenguaje de consultas y es compatible con el protocolo Bolt, lo que significa que cualquier herramienta que funcione con Neo4j puede conectarse a Memgraph sin cambios.

La diferencia principal: Memgraph ejecuta todo en RAM. Esto lo hace significativamente más rápido que Neo4j para consultas sobre grafos, especialmente en escenarios donde necesitas resultados inmediatos — como durante una respuesta ante incidentes.

---

## Por qué Memgraph para DFIR

- **Velocidad**: al trabajar en memoria, las queries se ejecutan en milisegundos incluso con grafos grandes
- **Ligero**: no requiere JVM — el consumo de recursos es mínimo comparado con Neo4j
- **Despliegue inmediato**: un solo comando de Docker y tienes el entorno completo funcionando
- **Open source**: sin licencias, sin restricciones de nodos, sin sorpresas
- **Compatible con Bolt**: las mismas bibliotecas y conectores que usas con Neo4j funcionan directamente

Cuando estás en medio de un incidente y necesitas levantar un entorno de visualización rápido, Memgraph elimina toda la fricción.

---

## Instalación de Memgraph

| Plataforma | Instalación |
|------------|-------------|
| **Windows** | Vía Docker (ver [Requisitos previos en Windows](#requisitos-previos-en-windows-wsl-2--docker) más abajo) |
| **Linux** | `sudo apt install memgraph` o descarga el paquete `.deb`/`.rpm` desde [memgraph.com/download](https://memgraph.com/download). Inicia con `sudo systemctl start memgraph` |
| **macOS** | `docker compose` (mismo enfoque que Windows/Docker) |

Una vez que Docker está corriendo, instala Memgraph con:

```powershell
iwr https://windows.memgraph.com | iex
```

Esto descarga un `docker-compose.yml` e inicia dos contenedores automáticamente:

| Contenedor | Imagen | Puerto | Función |
|------------|--------|--------|---------|
| `memgraph` | `memgraph/memgraph-mage` | 7687 (Bolt), 7444 (logs) | Motor de grafos + algoritmos MAGE |
| `lab` | `memgraph/lab` | 3000 | Interfaz web (Memgraph Lab) |

Abre [http://localhost:3000](http://localhost:3000) en tu navegador, haz click en **"Connect now"**, y Memgraph Lab estará listo. No hace falta crear bases de datos ni proyectos — Memgraph no tiene esquema y acepta datos inmediatamente.

---

## Requisitos previos en Windows: WSL 2 + Docker

En Windows, Memgraph se ejecuta dentro de un contenedor Docker, y Docker Desktop requiere **WSL 2** (Windows Subsystem for Linux). La cadena de dependencias es:

```
WSL 2 → Docker Desktop → Contenedor Memgraph
```

### Paso 1: Habilitar WSL 2

Abre **PowerShell como Administrador** y ejecuta:

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

**Reinicia tu PC** después de que ambos comandos se completen.

Tras reiniciar, abre PowerShell como Administrador de nuevo:

```powershell
wsl --update
wsl --set-default-version 2
wsl --install
```

Esto instala Ubuntu por defecto. Se te pedirá crear un nombre de usuario y contraseña Unix.

### Paso 2: Instalar Docker Desktop

1. Descarga Docker Desktop desde [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. Ejecuta el instalador — asegúrate de que **"Use WSL 2 instead of Hyper-V"** está seleccionado
3. Reinicia tu PC si se te solicita
4. Abre Docker Desktop — confirma que "Engine running" aparece en verde en la parte inferior izquierda

### Paso 3: Instalar y ejecutar Memgraph

Con Docker Desktop corriendo, abre PowerShell y ejecuta:

```powershell
iwr https://windows.memgraph.com | iex
```

Esto descarga un `docker-compose.yml` e inicia dos contenedores: la base de datos Memgraph (`memgraph/memgraph-mage`) y la interfaz web (`memgraph/lab`).

Abre [http://localhost:3000](http://localhost:3000), haz click en **"Connect now"**, y Memgraph Lab estará listo.

<details>
<summary><strong>Solución de problemas WSL / Docker</strong></summary>

**Servicio WSL no encontrado** (`ERROR_SERVICE_DOES_NOT_EXIST` al ejecutar `wsl --status`): asegúrate de que las features de Windows del Paso 1 están habilitadas y de que has reiniciado tu PC. Si el error persiste, registra el servicio manualmente:

```powershell
sc.exe create WslService binPath= 'C:\Program Files\WSL\wslservice.exe' start= auto
sc.exe start WslService
wsl --install
```

**wsl --update falla** ("The older version cannot be removed"): una instalación previa de WSL dejó una entrada corrupta. Elimínala primero y luego reinstala:

```powershell
winget uninstall "Windows Subsystem for Linux"
wsl --install
```

**Verificar que todo funciona:**

```powershell
wsl --status              # WSL funciona
docker --version          # Docker está instalado
docker run hello-world    # El motor de Docker está corriendo
docker ps                 # El contenedor de Memgraph está activo
```

</details>

---

## Carga de datos con masstin

El comando para cargar la timeline en Memgraph es `load-memgraph` (no `load-neo4j`):

```bash
masstin -a load-memgraph -f timeline.csv --database localhost:7687
```

Por defecto, Memgraph no tiene autenticación habilitada. Si has configurado credenciales en tu instancia, usa los parámetros correspondientes. Pero para un despliegue rápido de análisis, la configuración por defecto es todo lo que necesitas.

Masstin preserva los valores originales de la evidencia. Los nombres de nodos y propiedades se almacenan sin transformación. Solo los tipos de relación (cuentas de usuario) se normalizan a identificadores Cypher válidos (mayúsculas, guiones bajos, eliminar `@dominio`, sustituir cualquier carácter no alfanumérico — incluyendo el `$` final de las cuentas de máquina). Consulta el [artículo de Neo4j](/es/tools/2026-04-07-neo4j-cypher-visualization/) para más detalles.

### Opciones del cargador que cambian la forma del grafo

| Flag | Qué hace |
|------|----------|
| `--ungrouped` | Emite una arista por cada fila del CSV en lugar de colapsar las tuplas idénticas `(src, user, dst, logon_type)` en una sola arista con la propiedad `count`. Útil para ventanas de tiempo estrechas donde te interesa cada evento individual — combínalo con los flags de ventana temporal de abajo. |
| `--start-time "YYYY-MM-DD HH:MM:SS"` | Descarta las filas cuyo `time_created` sea anterior a este momento antes de construir el grafo. |
| `--end-time "YYYY-MM-DD HH:MM:SS"` | Descarta las filas cuyo `time_created` sea posterior a este momento. |

```bash
masstin -a load-memgraph -f timeline.csv --database localhost:7687 \
        --ungrouped --start-time "2026-03-15 14:00:00" --end-time "2026-03-15 14:30:00"
```

### Unificación de IP y nombre de host

Un mismo equipo físico aparece con frecuencia en distintos eventos, unas veces como IP y otras como hostname. Ambos cargadores construyen internamente un mapa de frecuencias y los resuelven a un único nodo del grafo de forma automática. Los eventos `4778` (Sesión Reconectada) y `4779` (Sesión Desconectada) reciben un **peso x1000** en ese mapa porque Windows siempre rellena de forma fiable tanto el nombre de la estación como la IP en esos eventos — así que un solo 4778/4779 pesa más que cientos de eventos normales que pudieran contradecirlo. Las IPs externas de atacantes que no tienen sesión asociada simplemente se quedan como nodos IP.

Si después de cargar todavía ves duplicados, mira la acción `merge-memgraph-nodes` al final de este artículo.

---

## Diferencias con Neo4j

Aunque Memgraph es compatible con openCypher, hay algunas diferencias que debes conocer:

### Timestamps

Memgraph usa `localDateTime()` en lugar de `datetime()` para las marcas temporales:

```cypher
-- Neo4j
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")

-- Memgraph
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
```

### Camino más corto (Shortest Path)

La sintaxis cambia. En lugar de `shortestPath()`, Memgraph usa la notación BFS en la relación:

```cypher
-- Neo4j
MATCH path = shortestPath((a:host {name:'WS_HR02'})-[*]->(b:host {name:'SRV_BACKUP'}))
RETURN path

-- Memgraph
MATCH path = (a:host {name:'WS_HR02'})-[*BFS]->(b:host {name:'SRV_BACKUP'})
RETURN path
```

### Persistencia

Este es el punto más importante: **Memgraph es en memoria**. Si reinicias el contenedor Docker, los datos se pierden. Para un análisis puntual durante un incidente esto no es problema — cargas, analizas, y listo. Si necesitas persistencia, puedes configurar snapshots en Memgraph, pero para la mayoría de casos en DFIR no es necesario.

---

## Queries Cypher

Las queries son prácticamente las mismas que en Neo4j, cambiando `datetime()` por `localDateTime()`. Aquí las más útiles:

### Ver todo el movimiento lateral

```cypher
MATCH (h1:host)-[r]->(h2:host)
RETURN h1, r, h2
```

![Grafo de movimiento lateral en Memgraph Lab](/assets/images/memgraph_output1.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

### Filtrar por rango temporal

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
  AND localDateTime(r.time) <= localDateTime("2026-03-13T00:00:00")
RETURN h1, r, h2
ORDER BY localDateTime(r.time)
```

### Excluir cuentas de máquina y usuarios sin resolver

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
  AND localDateTime(r.time) <= localDateTime("2026-03-13T00:00:00")
  AND NOT r.target_user_name ENDS WITH '$'
  AND NOT r.target_user_name = 'NO_USER'
RETURN h1, r, h2
ORDER BY localDateTime(r.time)
```

### Camino temporal entre dos hosts

La query de camino temporal funciona igual — la lógica de `ALL()` + `range()` es compatible:

```cypher
MATCH path = (start:host {name:'10_99_88_77'})-[*]->(end:host {name:'SRV_BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path
ORDER BY length(path)
LIMIT 5
```

![Reconstrucción de camino temporal en Memgraph Lab](/assets/images/memgraph_temporal_path.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

Para el catálogo completo de queries (filtrado por tipo de logon, cuentas de servicio, usuarios específicos, nodos más conectados), consulta el [artículo de Neo4j y Cypher](/es/tools/2026-04-07-neo4j-cypher-visualization/). Todas funcionan en Memgraph sustituyendo `datetime()` por `localDateTime()`.

---

## Estilo del grafo

Por defecto, Memgraph Lab muestra todo el texto en el mismo color, lo que dificulta distinguir los nombres de máquinas (nodos) de los nombres de usuario (relaciones). El repositorio de masstin incluye un estilo GSS personalizado en [`memgraph-resources/style.gss`](https://github.com/jupyterj0nes/masstin/blob/main/memgraph-resources/style.gss) que soluciona esto:

- **Etiquetas de nodos** (nombres de máquinas): negro, fuente más grande
- **Etiquetas de relaciones** (nombres de usuario): azul, fuente más pequeña

Para aplicarlo:

1. Abre la pestaña **Graph Style editor** en Memgraph Lab (junto al Cypher editor)
2. Selecciona todo el contenido existente (Ctrl+A)
3. Pega el contenido de [`style.gss`](https://github.com/jupyterj0nes/masstin/blob/main/memgraph-resources/style.gss)
4. Haz click en **Apply**

Para guardarlo permanentemente y que sea el estilo por defecto en todas las queries futuras:

1. Haz click en **Save style**
2. Introduce el nombre `masstin`
3. Selecciona **Save locally**
4. Activa **Default Graph Style** — esto aplicará el estilo automáticamente a todos los nuevos resultados de queries

![Guardar estilo como defecto](/assets/images/memgraph_save_style.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

---

## Cuándo usar Memgraph vs Neo4j

| | Memgraph | Neo4j |
|---|----------|-------|
| **Velocidad** | Más rápido (en memoria) | Más lento (disco) |
| **Recursos** | Ligero, sin JVM | Requiere JVM, más RAM |
| **Despliegue** | Un comando Docker | Más configuración |
| **Persistencia** | Volátil por defecto | Persistente |
| **Licencia** | Open source | Community / Enterprise |

Para análisis rápido durante un incidente, Memgraph es la opción más práctica. Si necesitas un entorno persistente para investigaciones prolongadas, Neo4j puede ser más adecuado.

---

## Post-carga: fusionar dos nodos que son el mismo equipo físico

A veces el cargador no logra atar un nodo en forma de IP con su gemelo en forma de hostname — normalmente porque el dataset no contenía eventos `4778` o `4779` de Security que actúen como evidencia autoritativa. masstin incluye una acción `merge-memgraph-nodes` que fusiona ambos nodos en uno, transfiriendo cada relación del nodo viejo al nuevo, preservando el tipo de relación y sus propiedades, y borrando después el nodo huérfano. **No requiere el módulo MAGE.**

```bash
masstin -a merge-memgraph-nodes \
        --database localhost:7687 \
        --old-node "10.0.0.10" --new-node "WORKSTATION-A"
```

Internamente, masstin descubre los tipos de relación que tocan al nodo viejo y ejecuta una query de transferencia por cada tipo — porque Cypher vanilla **no permite tipos de relación dinámicos** en `CREATE`, y masstin produce un tipo por cada `target_user_name`. Si prefieres ejecutar el Cypher a mano para un tipo concreto `:RELTYPE`, el patrón es:

```cypher
// Aristas SALIENTES de un tipo concreto
MATCH (new:host {name:'WORKSTATION-A'})
WITH new
MATCH (old:host {name:'10.0.0.10'})-[r:RELTYPE]->(target)
CREATE (new)-[nr:RELTYPE]->(target)
SET nr = properties(r)
DELETE r;

// Aristas ENTRANTES del mismo tipo
MATCH (new:host {name:'WORKSTATION-A'})
WITH new
MATCH (source)-[r:RELTYPE]->(old:host {name:'10.0.0.10'})
CREATE (source)-[nr:RELTYPE]->(new)
SET nr = properties(r)
DELETE r;

// Borrar el nodo huérfano una vez que ya no tiene aristas
MATCH (old:host {name:'10.0.0.10'}) DELETE old;
```

Si tienes el módulo `merge` de MAGE instalado, `CALL merge.nodes([new, old]) YIELD merged` hace lo mismo en una sola sentencia. La acción de masstin cubre el caso en que MAGE no está disponible.

---

## Referencia

- [masstin — Movimiento lateral en Rust](/es/tools/masstin-lateral-movement-rust/)
- [Neo4j y Cypher: Visualización con masstin](/es/tools/2026-04-07-neo4j-cypher-visualization/)
- [Memgraph Documentation](https://memgraph.com/docs)
