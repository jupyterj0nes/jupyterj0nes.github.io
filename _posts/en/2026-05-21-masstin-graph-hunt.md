---
layout: post
title: "graph-hunt: automated lateral movement detection on Memgraph and Neo4j GDS"
date: 2026-05-21 09:00:00 +0100
category: tools
lang: en
ref: tool-masstin-graph-hunt
tags: [masstin, graph-hunt, lateral-movement, neo4j, memgraph, gds, mage, dfir, detection]
description: "Loading a lateral movement timeline into a graph is one thing; automatically surfacing the suspicious patterns is another. masstin's graph-hunt runs seven detectors (novel edge, chain motif, PageRank/betweenness spike, community bridge, credential rotation, rare logon type) against an already-loaded graph and produces a ranked CSV of findings. Works against Memgraph (MAGE) and Neo4j (GDS 2.x) — this post documents requirements, setup, and the detector model."
comments: true
---

## The problem after `load-*`

A masstin timeline loaded into Memgraph or Neo4j gives you a beautiful graph of who-talked-to-whom. You can run path queries, you can pivot from a known indicator outward, you can spot weird-looking clusters by eye. That works when you already know what you're looking for.

The graph doesn't help when you DON'T know. Hundreds of thousands of edges in a real incident's worth of evidence, and the attacker's path is one rare structural anomaly hiding in a mass of legitimate admin activity. Manually browsing isn't going to find it; specific named-IOC queries won't either if the attacker used valid stolen credentials. You need an analytical pass over the graph that surfaces the patterns that **statistically don't fit the baseline**.

`masstin -a graph-hunt` (Memgraph) and `masstin -a graph-hunt-neo4j` (Neo4j) do exactly that. They take an already-loaded graph and a cutoff datetime, split the data into baseline (events before the cutoff) and investigation window (events at or after), and run seven detectors against the split. Each detector emits findings with a score, a host, a time window, a textual summary, and a Cypher snippet to reproduce the subgraph that produced the alert.

## The seven detectors

Each detector targets a different attacker signature. They're deliberately redundant — most real attacks light up three or four of them, which gives the analyst corroboration instead of a single fragile signal.

| Detector | What it catches |
|----------|-----------------|
| **`novel-edge`** | An edge appearing in the investigation window where (origin, destination) was never seen in baseline, OR the user was new for that destination, OR the logon type was new for that destination. Three independent novelty axes; score is the fraction of them that fire (1.0 = all three new, 0.33 = one). |
| **`chain-motif`** | A→B→C chains in the window where each consecutive hop happens within 5 minutes AND the user changes between hops. Classic operator-driven lateral movement: land on B with one credential, immediately pivot to C with a different one. Requires at least one novel hop (origin→destination unseen in baseline) to fire, so legitimate baseline chains with different users don't cause false positives. |
| **`pagerank-spike`** | A host that is globally important in the graph (high PageRank) AND is receiving an abnormally novel share of its incoming traffic in the window. The classic pivot signature: a host that already mattered for legitimate reasons (many systems talk to it) and that suddenly starts hearing from sources or at a rate it never did before. Uses a MIN_BASELINE_EDGES gate and a MAD z-score against the novelty distribution to avoid firing on hosts with sparse history. |
| **`betweenness-spike`** | Same shape as PageRank-spike but using betweenness centrality. Where PageRank measures "how important is this node from a random-walk perspective", betweenness measures "how many shortest paths between other nodes pass through this one" — closer to the operational notion of a pivot. The two detectors are deliberately redundant; they corroborate each other on real pivots and disagree on edge cases. |
| **`community-bridge`** | Runs Louvain community detection on the full graph, then walks every edge in the investigation window looking for the canonical "bridge to a new island" signature: an edge whose origin and destination sit in different communities AND the origin has never previously touched any node in the destination's community. AD networks cluster naturally by function and geography (HR talks to HR, the North subsidiary talks to itself, DCs replicate among themselves), so a brand-new cross-community bridge is a strong signal. |
| **`cred-rotation`** | A single source host that uses many distinct user identities in the window is the canonical pass-the-hash or credential-spraying signature: the attacker dumped multiple sets of credentials and is probing which ones still work, or pivoting through each in sequence. The detector requires at least three users **and** at least two of them to be novel for that source compared to the baseline — so an infrastructure host that legitimately uses its stable set of service accounts every day doesn't fire. |
| **`rare-logon-type`** | An edge in the window whose logon_type is rare in the baseline FOR THE DESTINATION'S HOST CLASS. The stratification matters: logon_type=0 is the loader's sentinel for non-Windows sources (Linux SSH via wtmp) — legitimate on Linux destinations but globally rare in a mixed corpus. A naive global rarity test fires a flood of false positives on every Linux SSH event. Class-stratified, the detector keeps its edge on the real targets: types like 9 (NewCredentials), 8 (NetworkCleartext), 11 (CachedInteractive), exotic types appearing suddenly on Windows hosts. |

The redundancy is the point. On the synthetic eval corpus, every attack scenario fires three to six of these detectors — even adversarial scenarios designed to evade specific detectors (a "living off the land" attack from an admin's normal jumpbox to a DC the admin uses every day, with no novelty axis at all) still get caught by `betweenness-spike` and `rare-logon-type` because the destination is a high-betweenness hub and the type combination happens to be rare for that specific (source, destination) pair.

## Two engines, two procedure libraries

`graph-hunt` and `graph-hunt-neo4j` implement the same seven detectors but call different graph algorithm libraries:

- **Memgraph (`graph-hunt`)** uses **MAGE** — Memgraph Advanced Graph Extensions. MAGE ships **bundled with the default Memgraph install**; there is nothing extra to install or configure. PageRank, Louvain, and betweenness are available as `pagerank.get()`, `community_detection.get()`, and `betweenness_centrality.get()` immediately after the DB is up.
- **Neo4j (`graph-hunt-neo4j`)** uses the **Neo4j Graph Data Science (GDS) library**. GDS is **a separate plugin** that has to be installed in the target Neo4j instance. masstin uses the **GDS 2.x API** (`gds.graph.project`, `gds.pageRank.stream`, `gds.louvain.stream`, `gds.betweenness.stream`), which means **Neo4j 5.x or later** is required (Neo4j 4.x was the last to use GDS 1.x with the old `gds.graph.create` procedure name).

Both engines reach the same 100% recall / 98%+ precision on the eval corpora used during development, but the operational details differ.

## Set up Memgraph for `graph-hunt`

Memgraph requires no extra steps. The Docker image bundles MAGE; the native install bundles MAGE; either way, after `docker run ...` or `systemctl start memgraph`, the procedures are available. Load your timeline and run graph-hunt:

```bash
masstin -a load-memgraph -f timeline.csv --database bolt://localhost:7687 --ungrouped
masstin -a graph-hunt --database bolt://localhost:7687 \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

The `--ungrouped` flag on the load is important: graph-hunt's `chain-motif` and `cred-rotation` detectors need per-event timestamps to evaluate the 5-minute hop gap and per-user rotation patterns. A grouped load collapses all events between the same (src, user, type, dst) tuple into one edge with the earliest timestamp, which destroys the temporal granularity those detectors need. The other five detectors work in both modes, but ungrouped is the recommended setup for active hunting.

## Set up Neo4j Desktop for `graph-hunt-neo4j`

Step-by-step from a fresh Neo4j Desktop install:

### 1. Create the instance

In Neo4j Desktop, **Create instance** → pick **Neo4j 5.x or later** (masstin's GDS 2.x API needs 5.x; the modern 2026.x kernels work). Set a password — for the rest of this post we'll assume the `NEO4J_PASSWORD` environment variable carries it.

### 2. Install the Graph Data Science plugin

This is where most setup mistakes happen. The plugin install is two parts: copying the JAR to the instance's `plugins/` folder, and restarting the JVM so it loads the procedures. Neo4j Desktop handles both **if you do it via the UI** in this order:

1. Open the instance in Desktop (click on it).
2. Click the **`...`** menu (top-right of the instance card).
3. Choose **Plugins**.
4. Find **Graph Data Science** in the list.
5. Click **Install**. Wait for the badge to flip to **Installed** (10-30 seconds, depending on whether Desktop has the JAR cached).
6. **Restart the instance.** Desktop won't restart automatically — you have to stop and start it manually for the JVM to load the just-installed plugin.

### 3. Verify GDS is live

After the restart, open the instance's Query tab and run:

```cypher
CALL gds.version()
```

If you get a version string back (e.g. `2026.04.0`), the plugin is loaded and you're done. If you get `Neo.ClientError.Procedure.ProcedureNotFound`, the JAR is in `plugins/` but the JVM didn't load it — restart the DBMS again. This happens occasionally when Desktop reports the install before the JVM actually picks up the file.

You can also list the procedures masstin will call to be extra sure:

```cypher
CALL gds.list() YIELD name
WHERE name STARTS WITH 'gds.graph.project'
   OR name STARTS WITH 'gds.pageRank.stream'
   OR name STARTS WITH 'gds.louvain.stream'
   OR name STARTS WITH 'gds.betweenness.stream'
RETURN name
```

All four families should appear. If any are missing, the GDS install is partial and `graph-hunt-neo4j` will fail at the projection step.

### 4. Run graph-hunt-neo4j

```bash
NEO4J_PASSWORD='your-pass' masstin -a load-neo4j \
    -f timeline.csv --database bolt://localhost:7687 --user neo4j --ungrouped

NEO4J_PASSWORD='your-pass' masstin -a graph-hunt-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

### 5. Multi-database setups: `--db`

Neo4j 5.x supports multiple named databases per instance. masstin defaults to the standard `neo4j` database, but if you keep each case (or each environment) in its own database, pass `--db <name>` to both `load-neo4j` and `graph-hunt-neo4j`:

```bash
NEO4J_PASSWORD='your-pass' masstin -a load-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --db case-2026-03-customer-x \
    -f timeline.csv --ungrouped

NEO4J_PASSWORD='your-pass' masstin -a graph-hunt-neo4j \
    --database bolt://localhost:7687 --user neo4j \
    --db case-2026-03-customer-x \
    --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

Aura users: pick the database name from the Aura console; everything else is identical.

## Heap sizing for DFIR-scale corpora

The default Neo4j heap (1 GB) is fine up to roughly 2-3 million edges. Beyond that, the GDS in-memory projection grows past the heap and the hunt either fails with an OOM or thrashes against garbage collection. For DFIR captures that often run 5-15 million edges (a single domain's worth of Security.evtx + UAL + SSH + Cortex from a 90-day investigation), the heap needs more headroom.

In Neo4j Desktop:

1. Stop the instance.
2. **`...`** menu → **Settings** (or open `conf/neo4j.conf` in the instance folder).
3. Raise the relevant lines:

```
server.memory.heap.initial_size=2G
server.memory.heap.max_size=6G
server.memory.pagecache.size=2G
```

4. Start the instance again.

A 6 GB heap comfortably handles 15 M edges + the GDS projection on a modern desktop. If you're loading something genuinely huge (50+ M edges), bump to 12-16 GB or run on a dedicated server with the appropriate Neo4j Enterprise sizing recommendations.

Memgraph's defaults handle larger graphs out of the box because MAGE doesn't build a separate projection — it walks the live graph. There's no equivalent heap-tuning step for Memgraph users.

## Filtering detectors

If the analyst only wants specific signals (say, only the temporal-aware detectors during initial triage, or only the structural detectors when re-running on a stale graph), the `--only-detectors` and `--skip-detectors` flags take a comma-separated list of detector names. The two are mutually exclusive.

```bash
# Run only the structural detectors (no per-event timestamps required)
masstin -a graph-hunt-neo4j --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" \
        --only-detectors novel-edge,community-bridge,pagerank-spike,betweenness-spike,rare-logon-type \
        -o findings.csv

# Skip the heavy GDS detectors on a quick re-run
masstin -a graph-hunt-neo4j --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" \
        --skip-detectors pagerank-spike,betweenness-spike,community-bridge \
        -o findings.csv
```

## Reading the findings CSV

The output looks like this:

```
rank,score,detector,host,time_window,summary,cypher_snippet
1,0.93,betweenness-spike,JUMP-HQ-02,from 2026-03-15T00:00:00,"JUMP-HQ-02: betweenness=204.5, novelty_ratio=0.46 ...","MATCH (a:host)-[r]->(b:host {name:'JUMP-HQ-02'}) WHERE r.time >= datetime('2026-03-15T00:00:00') RETURN a, r, b"
2,0.85,chain-motif,JUMP-HQ-02,2026-03-15T11:01:20 .. 2026-03-15T11:03:00,"Pivot via JUMP-HQ-02: WKS-FIN-02 -[HEIDI.IT]-> JUMP-HQ-02 -[ALICE.ADMIN]-> DC02-HQ ...","MATCH ..."
...
```

`rank` is the global ordering by score (highest first). `score` is detector-specific but normalized to [0, 1]. `host` is the focus of the alert — for most detectors it's the destination; for `chain-motif` it's the pivot (middle node B); for `cred-rotation` it's the source. The `cypher_snippet` is a ready-to-paste query that reproduces the subgraph producing the alert in Neo4j Browser or Memgraph Lab, so the analyst can immediately move from "what's the alert" to "what does it actually look like".

A real DFIR triage workflow looks like:

1. Sort the findings by score (already done — they come pre-sorted).
2. For each of the top N (typically 20-30), copy the `cypher_snippet` into the graph DB UI and look at the subgraph.
3. If it's clearly legitimate (e.g. an SCCM monitoring host with 200k baseline edges firing on `betweenness-spike` because of a routine patch wave), dismiss and move on.
4. If it's suspicious, follow the edges outward — the snippet only shows the immediately involved subgraph; the temporal path query from the main masstin post finds the chronologically coherent route.

## What the eval looks like

`graph-hunt-neo4j` has been validated on synthetic corpora of increasing size and adversarial difficulty. The eval framework lives outside the masstin repo (test fixtures don't belong in the tool's distribution) but the methodology is reproducible:

1. A topology generator builds a synthetic AD network (DCs, fileservers, jumpboxes, workstations across multiple clusters and a DMZ) with realistic per-host retention models for Security.evtx (3-60 days depending on host class), UAL (24 months), wtmp (30 days), and the rest of the source matrix that real captures pull from.
2. Legitimate baseline traffic is generated for 90 days from 60+ user identities (admins, helpdesk, role-restricted users, service accounts) following realistic access patterns.
3. Attack scenarios are injected into the last 7 days: 22 different scenarios covering the standard MITRE techniques (initial access, credential dumping + lateral, Kerberoasting, golden/silver ticket, DCSync, internal reconnaissance, WMI lateral, service-creation chains, VPN pivot, insider exfil, etc.) plus 5 explicitly adversarial scenarios designed to evade specific detectors (living-off-the-land with no novelty axis, slow-burn cred theft, intra-cluster lateral, distributed-user, service-host pivot).
4. Legitimate-but-novel patterns also go in: new employee onboarding, helpdesk promotion to admin, project team formation, DR test, Patch Tuesday, external auditor. These are NOT in the truth file — if a detector fires on them it counts as a false positive, measuring resilience against realistic noise.
5. After `load-neo4j` + `graph-hunt-neo4j`, an eval harness classifies each finding TP/FP against the truth file (matching on host + time window with ±2 minute tolerance) and computes precision/recall per detector and per scenario.

The current eval state at 5M edges + adversarial scenarios is 98.9% precision / 100% recall (every one of the 22 attack scenarios caught by at least one detector). The single false positive is `betweenness-spike` firing on an SCCM monitoring host that is legitimately a high-betweenness hub doing its job — the kind of FP that no algorithmic detector can fully eliminate without context the data doesn't carry.

The 15M-edge ladder is in progress at the time of writing; the streaming loader work that enabled it shipped in `load-neo4j` v0.13 (the previous in-memory pre-pass OOMd around 1.7M edges on contended Windows hosts).

## When `graph-hunt` is NOT the right tool

Two limits are worth calling out:

- **Pure single-edge attacks**: an attacker who logs in once, accesses one file, and logs out — without any of the structural anomalies the detectors target — won't fire anything. `graph-hunt` is a complement to manual review and IOC matching, not a replacement.
- **Very sparse graphs**: if the loaded timeline only has a few hundred edges (a small triage from a single host, say), there isn't enough baseline to compute meaningful novelty distributions. The detectors will run but the alerts won't be statistically meaningful. Use `graph-hunt` on graphs of at least a few thousand edges spanning multiple hosts.

## Try it

`graph-hunt` and `graph-hunt-neo4j` ship in **masstin v0.13** and later. Pre-built binaries are on the [Releases page](https://github.com/jupyterj0nes/masstin/releases) — no Rust toolchain required.

```bash
# Parse evidence, load into Memgraph, hunt
masstin -a parse-massive -d /evidence/2026-03-customer-x/ -o timeline.csv
masstin -a load-memgraph -f timeline.csv --database bolt://localhost:7687 --ungrouped
masstin -a graph-hunt --database bolt://localhost:7687 \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv

# Same on Neo4j (GDS plugin required — see setup above)
NEO4J_PASSWORD='your-pass' masstin -a load-neo4j \
        -f timeline.csv --database bolt://localhost:7687 --user neo4j --ungrouped
NEO4J_PASSWORD='your-pass' masstin -a graph-hunt-neo4j \
        --database bolt://localhost:7687 --user neo4j \
        --investigation-from "2026-03-15 00:00:00" -o findings.csv
```

If a detector misbehaves on your data (false positives you can't explain, or attack patterns it should have caught), open an issue on the [masstin repo](https://github.com/jupyterj0nes/masstin/issues) with a sanitized sample subgraph — the detector tuning is an ongoing process and real-case feedback is the most useful input.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| README — Detect lateral movement: graph-hunt | [`README.md#detect-lateral-movement-graph-hunt`](https://github.com/jupyterj0nes/masstin#detect-lateral-movement-graph-hunt) |
| Neo4j and Cypher visualization | [neo4j-cypher-visualization](/en/tools/neo4j-cypher-visualization/) |
| Memgraph in-memory visualization | [memgraph-visualization](/en/tools/memgraph-visualization/) |
| CSV format and event classification | [masstin-csv-format](/en/tools/masstin-csv-format/) |
| Forensic image parsing + VSS recovery | [masstin-vss-recovery](/en/tools/masstin-vss-recovery/) |
