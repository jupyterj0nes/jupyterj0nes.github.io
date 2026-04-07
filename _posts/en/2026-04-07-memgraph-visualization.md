---
layout: post
title: "Memgraph: In-Memory Lateral Movement Visualization"
date: 2026-04-07 04:00:00 +0100
category: tools
lang: en
ref: tool-masstin-memgraph
tags: [masstin, memgraph, cypher, grafos, lateral-movement, visualization]
description: "Guide to visualizing lateral movement with Memgraph and masstin: in-memory graph database, Docker installation, and Cypher queries for incident analysis."
comments: true
---

## What is Memgraph

Memgraph is an **in-memory**, open-source graph database. It uses openCypher as its query language and is compatible with the Bolt protocol, which means any tool that works with Neo4j can connect to Memgraph without changes.

The key difference: Memgraph runs everything in RAM. This makes it significantly faster than Neo4j for graph queries, especially in scenarios where you need immediate results — like during incident response.

---

## Why Memgraph for DFIR

- **Speed**: in-memory execution means queries return in milliseconds even on large graphs
- **Lightweight**: no JVM required — minimal resource footprint compared to Neo4j
- **Instant deployment**: a single Docker command gives you the full environment
- **Open source**: no licenses, no node limits, no surprises
- **Bolt compatible**: the same libraries and connectors you use with Neo4j work directly

When you're in the middle of an incident and need to spin up a visualization environment fast, Memgraph removes all the friction.

---

## Installing Memgraph

| Platform | Installation |
|----------|-------------|
| **Windows** | Via Docker (see [Windows prerequisites](#windows-prerequisites-wsl-2--docker) below) |
| **Linux** | `sudo apt install memgraph` or download the `.deb`/`.rpm` package from [memgraph.com/download](https://memgraph.com/download). Start with `sudo systemctl start memgraph`. Access Memgraph Lab at `http://localhost:3000` |
| **macOS** | Docker is recommended: `docker run -p 7687:7687 -p 7444:7444 -p 3000:3000 memgraph/memgraph-platform` |
| **Docker** | `docker run -p 7687:7687 -p 7444:7444 -p 3000:3000 memgraph/memgraph-platform` |

This starts three services:
- **Port 7687**: Bolt connection for Cypher queries
- **Port 7444**: Memgraph logs
- **Port 3000**: Memgraph Lab (web interface)

Open [http://localhost:3000](http://localhost:3000) in your browser and Memgraph Lab is ready. No database creation, no user setup, no configuration files. It just works.

---

## Windows prerequisites: WSL 2 + Docker

On Windows, Memgraph runs inside a Docker container, and Docker Desktop requires **WSL 2** (Windows Subsystem for Linux). The dependency chain is:

```
WSL 2 → Docker Desktop → Memgraph container
```

### Step 1: Enable WSL 2

Open **PowerShell as Administrator** and run:

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

**Restart your PC** after both commands complete.

After restarting, open PowerShell as Administrator again:

```powershell
wsl --update
wsl --set-default-version 2
wsl --install
```

This installs Ubuntu by default. You will be asked to create a Unix username and password.

### Step 2: Install Docker Desktop

1. Download Docker Desktop from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. Run the installer — make sure **"Use WSL 2 instead of Hyper-V"** is selected
3. Restart your PC if prompted
4. Launch Docker Desktop — confirm "Engine running" appears in green at the bottom left

### Step 3: Run Memgraph

```powershell
docker run -d --name memgraph -p 7687:7687 -p 7444:7444 -p 3000:3000 memgraph/memgraph-platform
```

Open [http://localhost:3000](http://localhost:3000) and Memgraph Lab is ready.

<details>
<summary><strong>Troubleshooting WSL / Docker</strong></summary>

**WSL service not found** (`ERROR_SERVICE_DOES_NOT_EXIST` when running `wsl --status`): ensure the Windows features from Step 1 are enabled and you have restarted your PC. If the error persists, register the service manually:

```powershell
sc.exe create WslService binPath= 'C:\Program Files\WSL\wslservice.exe' start= auto
sc.exe start WslService
wsl --install
```

**wsl --update fails** ("The older version cannot be removed"): a previous WSL installation left a corrupted entry. Remove it first, then reinstall:

```powershell
winget uninstall "Windows Subsystem for Linux"
wsl --install
```

**Verify everything works:**

```powershell
wsl --status              # WSL is working
docker --version          # Docker is installed
docker run hello-world    # Docker engine is running
docker ps                 # Memgraph container is up
```

</details>

---

## Loading data with masstin

The command to load the timeline into Memgraph is `load-memgraph` (not `load-neo4j`):

```bash
masstin -a load-memgraph -f timeline.csv --database localhost:7687 --user memgraph
```

By default, Memgraph has no authentication enabled. If you've configured credentials on your instance, use the corresponding parameters. But for a quick analysis deployment, the default configuration is all you need.

The same data transformations that masstin applies for Neo4j are applied here: dots and hyphens become underscores, everything is uppercased, and domain suffixes are stripped from usernames. See the [Neo4j article](/en/tools/2026-04-07-neo4j-cypher-visualization/) for the full transformation table.

---

## Differences from Neo4j

While Memgraph is openCypher compatible, there are a few differences you need to know:

### Timestamps

Memgraph uses `localDateTime()` instead of `datetime()` for timestamps:

```cypher
-- Neo4j
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")

-- Memgraph
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
```

### Shortest path

The syntax changes. Instead of `shortestPath()`, Memgraph uses BFS notation on the relationship:

```cypher
-- Neo4j
MATCH path = shortestPath((a:host {name:'WS_HR02'})-[*]->(b:host {name:'SRV_BACKUP'}))
RETURN path

-- Memgraph
MATCH path = (a:host {name:'WS_HR02'})-[*BFS]->(b:host {name:'SRV_BACKUP'})
RETURN path
```

### Persistence

This is the most important point: **Memgraph is in-memory**. If you restart the Docker container, the data is gone. For a one-off analysis during an incident this isn't a problem — you load, analyze, and move on. If you need persistence, you can configure snapshots in Memgraph, but for most DFIR use cases it's not necessary.

---

## Cypher Queries

The queries are virtually the same as Neo4j, replacing `datetime()` with `localDateTime()`. Here are the most useful ones:

### View all lateral movement

```cypher
MATCH (h1:host)-[r]->(h2:host)
RETURN h1, r, h2
```

### Filter by time range

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
  AND localDateTime(r.time) <= localDateTime("2026-03-13T00:00:00")
RETURN h1, r, h2
ORDER BY localDateTime(r.time)
```

### Exclude machine accounts and unresolved users

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE localDateTime(r.time) >= localDateTime("2026-03-12T00:00:00")
  AND localDateTime(r.time) <= localDateTime("2026-03-13T00:00:00")
  AND NOT r.target_user_name ENDS WITH '$'
  AND NOT r.target_user_name = 'NO_USER'
RETURN h1, r, h2
ORDER BY localDateTime(r.time)
```

### Temporal path between two hosts

The temporal path query works the same way — the `ALL()` + `range()` logic is compatible:

```cypher
MATCH path = (start:host {name:'10_99_88_77'})-[*]->(end:host {name:'SRV_BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path
ORDER BY length(path)
LIMIT 5
```

For the full query catalog (filtering by logon type, service accounts, specific users, most connected nodes), see the [Neo4j and Cypher article](/en/tools/2026-04-07-neo4j-cypher-visualization/). All of them work in Memgraph by replacing `datetime()` with `localDateTime()`.

---

## When to use Memgraph vs Neo4j

| | Memgraph | Neo4j |
|---|----------|-------|
| **Speed** | Faster (in-memory) | Slower (disk-based) |
| **Resources** | Lightweight, no JVM | Requires JVM, more RAM |
| **Deployment** | One Docker command | More configuration |
| **Persistence** | Volatile by default | Persistent |
| **License** | Open source | Community / Enterprise |

For quick analysis during an incident, Memgraph is the most practical option. If you need a persistent environment for extended investigations, Neo4j may be more suitable.

---

## Reference

- [masstin — Lateral Movement in Rust](/en/tools/masstin-lateral-movement-rust/)
- [Neo4j and Cypher: Visualization with masstin](/en/tools/2026-04-07-neo4j-cypher-visualization/)
- [Memgraph Documentation](https://memgraph.com/docs)
