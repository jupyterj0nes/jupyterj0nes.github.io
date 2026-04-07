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

## Qué es Memgraph

Memgraph es una base de datos de grafos **en memoria** y de código abierto. Utiliza openCypher como lenguaje de consultas y es compatible con el protocolo Bolt, lo que significa que cualquier herramienta que funcione con Neo4j puede conectarse a Memgraph sin cambios.

La diferencia principal: Memgraph ejecuta todo en RAM. Esto lo hace significativamente más rápido que Neo4j para consultas sobre grafos, especialmente en escenarios donde necesitas resultados inmediatos — como durante una respuesta ante incidentes.

---

## Por qué Memgraph para DFIR

- **Velocidad**: al trabajar en memoria, las queries se ejecutan en milisegundos incluso con grafos grandes
- **Ligero**: no requiere JVM — el consumo de recursos es mínimo comparado con Neo4j
- **Despliegue inmediato**: un solo comando de Docker y tienes el entorno completo funcionando
- **Open source**: sin licencias, sin restricciones de nodos, sin sorpresas
- **Compatible con Bolt**: las mismas librerías y conectores que usas con Neo4j funcionan directamente

Cuando estás en medio de un incidente y necesitas levantar un entorno de visualización rápido, Memgraph elimina toda la fricción.

---

## Instalacion de Memgraph

| Plataforma | Instalacion |
|------------|-------------|
| **Windows** | Via Docker (ver [Requisitos previos en Windows](#requisitos-previos-en-windows-wsl-2--docker) mas abajo) |
| **Linux** | `sudo apt install memgraph` o descarga el paquete `.deb`/`.rpm` desde [memgraph.com/download](https://memgraph.com/download). Inicia con `sudo systemctl start memgraph` |
| **macOS** | `docker compose` (mismo enfoque que Windows/Docker) |

Una vez que Docker esta corriendo, instala Memgraph con:

```powershell
iwr https://windows.memgraph.com | iex
```

Esto descarga un `docker-compose.yml` e inicia dos contenedores automaticamente:

| Contenedor | Imagen | Puerto | Funcion |
|------------|--------|--------|---------|
| `memgraph` | `memgraph/memgraph-mage` | 7687 (Bolt), 7444 (logs) | Motor de grafos + algoritmos MAGE |
| `lab` | `memgraph/lab` | 3000 | Interfaz web (Memgraph Lab) |

Abre [http://localhost:3000](http://localhost:3000) en tu navegador, haz click en **"Connect now"**, y Memgraph Lab estara listo. No hace falta crear bases de datos ni proyectos — Memgraph no tiene esquema y acepta datos inmediatamente.

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

**Reinicia tu PC** despues de que ambos comandos se completen.

Tras reiniciar, abre PowerShell como Administrador de nuevo:

```powershell
wsl --update
wsl --set-default-version 2
wsl --install
```

Esto instala Ubuntu por defecto. Se te pedira crear un nombre de usuario y contrasena Unix.

### Paso 2: Instalar Docker Desktop

1. Descarga Docker Desktop desde [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. Ejecuta el instalador — asegurate de que **"Use WSL 2 instead of Hyper-V"** esta seleccionado
3. Reinicia tu PC si se te solicita
4. Abre Docker Desktop — confirma que "Engine running" aparece en verde en la parte inferior izquierda

### Paso 3: Instalar y ejecutar Memgraph

Con Docker Desktop corriendo, abre PowerShell y ejecuta:

```powershell
iwr https://windows.memgraph.com | iex
```

Esto descarga un `docker-compose.yml` e inicia dos contenedores: la base de datos Memgraph (`memgraph/memgraph-mage`) y la interfaz web (`memgraph/lab`).

Abre [http://localhost:3000](http://localhost:3000), haz click en **"Connect now"**, y Memgraph Lab estara listo.

<details>
<summary><strong>Solucion de problemas WSL / Docker</strong></summary>

**Servicio WSL no encontrado** (`ERROR_SERVICE_DOES_NOT_EXIST` al ejecutar `wsl --status`): asegurate de que las features de Windows del Paso 1 estan habilitadas y de que has reiniciado tu PC. Si el error persiste, registra el servicio manualmente:

```powershell
sc.exe create WslService binPath= 'C:\Program Files\WSL\wslservice.exe' start= auto
sc.exe start WslService
wsl --install
```

**wsl --update falla** ("The older version cannot be removed"): una instalacion previa de WSL dejo una entrada corrupta. Eliminala primero y luego reinstala:

```powershell
winget uninstall "Windows Subsystem for Linux"
wsl --install
```

**Verificar que todo funciona:**

```powershell
wsl --status              # WSL funciona
docker --version          # Docker esta instalado
docker run hello-world    # El motor de Docker esta corriendo
docker ps                 # El contenedor de Memgraph esta activo
```

</details>

---

## Carga de datos con masstin

El comando para cargar la timeline en Memgraph es `load-memgraph` (no `load-neo4j`):

```bash
masstin -a load-memgraph -f timeline.csv --database localhost:7687 --user memgraph
```

Por defecto, Memgraph no tiene autenticación habilitada. Si has configurado credenciales en tu instancia, usa los parámetros correspondientes. Pero para un despliegue rápido de análisis, la configuración por defecto es todo lo que necesitas.

Las mismas transformaciones de datos que masstin aplica en Neo4j se aplican aquí: puntos y guiones se convierten en guiones bajos, todo se pasa a mayúsculas, y se elimina el dominio de los usuarios. Consulta el [artículo de Neo4j](/es/tools/2026-04-07-neo4j-cypher-visualization/) para la tabla completa de transformaciones.

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

Para el catálogo completo de queries (filtrado por tipo de logon, cuentas de servicio, usuarios específicos, nodos más conectados), consulta el [artículo de Neo4j y Cypher](/es/tools/2026-04-07-neo4j-cypher-visualization/). Todas funcionan en Memgraph sustituyendo `datetime()` por `localDateTime()`.

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

## Referencia

- [masstin — Movimiento lateral en Rust](/es/tools/masstin-lateral-movement-rust/)
- [Neo4j y Cypher: Visualización con masstin](/es/tools/2026-04-07-neo4j-cypher-visualization/)
- [Memgraph Documentation](https://memgraph.com/docs)
