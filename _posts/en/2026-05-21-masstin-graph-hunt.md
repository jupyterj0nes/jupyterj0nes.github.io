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
SHOW PROCEDURES YIELD name
WHERE name STARTS WITH 'gds.graph.project'
   OR name STARTS WITH 'gds.pageRank.stream'
   OR name STARTS WITH 'gds.louvain.stream'
   OR name STARTS WITH 'gds.betweenness.stream'
RETURN name
```

All four families should appear. If they don't — and `SHOW PROCEDURES YIELD name WHERE name STARTS WITH 'gds.'` returns nothing — the plugin loaded but its procedures were **denied by the allowlist**. This is a real footgun on Neo4j 2026.x: the kernel ships with `dbms.security.procedures.allowlist` set to `apoc.*,genai.*,ai.*` by default, and the Desktop plugin manager **does not update that list when GDS is installed via the UI**. The plugin JAR ends up in `plugins/`, the startup log shows `Graph Data Science extension built`, and yet every `gds.*` procedure is silently rejected at registration with a WARN line in `logs/debug.log`:

```
WARN  The procedure 'gds.X' is not on the allowlist and won't be loaded.
```

Fix: open `conf/neo4j.conf` in the instance folder (Desktop's **Open folder** button on the instance card gets you there) and edit both lines:

```
dbms.security.procedures.unrestricted=apoc.*,gds.*
dbms.security.procedures.allowlist=apoc.*,genai.*,ai.*,gds.*
```

Then restart the instance. The procedures are now visible to `SHOW PROCEDURES` and callable from masstin.

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

`graph-hunt-neo4j` is validated on a dual-corpus harness — a **small control** corpus that reproduces a known baseline and a **stress corpus** that models a 200-host / 85-account enterprise. The eval framework lives outside the masstin repo (test fixtures don't belong in the tool's distribution) but the methodology is reproducible:

1. **Topology generator** builds a synthetic AD network (DCs, fileservers, jumpboxes, workstations across multiple clusters and a DMZ) with realistic per-host retention models for Security.evtx (3-60 days depending on host class), UAL (24 months), wtmp (30 days), and the rest of the source matrix that real captures pull from.

2. **Baseline activity model**. 90 days of legitimate traffic from 70+ user identities + 13 service accounts. The activity model is calibrated against published empirical sources rather than uniform random sampling, which produces unrealistically high novelty rates at scale:

   - **Per-user persistent profile**: a single primary workstation receives 88-96% of a user's logons (Kent & Liebrock authentication-graph sparsity finding; CISA AA23-059A Privileged Access Workstation guidance), with optional secondary workstation and rare hot-desk tail.
   - **Tiered destinations** sampled with Zipf exponent ~1.2 within three tiers: a small "core" set covering 80% of events, an "occasional" set covering 15%, and a long "rare" tail for 5% (Hopper enterprise corpus, USENIX Security 2021, observed a 222× raw-to-meaningful-login ratio that this tiering reproduces).
   - **Service accounts** have scoped fixed target sets — SCCM-style client-push touches the managed estate, DNS/DHCP stay on the DCs that host the role, backups walk fileservers + DCs — rather than uniform across all servers (SpecterOps SCCM research; Microsoft Defender for Identity baselining premise).
   - **3:1 weekday/weekend ratio** for humans, 24/7 flat for services (ActivTrak/BLS-style productivity benchmarks).

   The resulting baseline has a new-edge rate in the investigation window of ~6% on triples — close to the <1% that mature production environments exhibit per MDI 30-day-baseline literature, with the residual difference attributable to attack injections and modeled employee churn.

3. **Attack scenarios** injected into the last 7 days: 22 scenarios covering standard MITRE techniques (initial-access dump + lateral, cred-spray, Kerberoasting, golden/silver ticket, DCSync, internal-recon, WMI lateral, service-creation chains, VPN pivot, insider exfil, etc.) plus 5 explicitly adversarial scenarios designed to evade specific detectors (living-off-the-land with no novelty axis, slow-burn cred theft, intra-cluster lateral, distributed-user, service-host pivot).

4. **Legitimate-but-novel patterns** also injected and NOT in the truth file: new employee onboarding, helpdesk promotion to admin, project team formation, DR test, Patch Tuesday, external auditor visit. If a detector fires on them it counts as a false positive — measures resilience against realistic noise.

5. **Eval harness** classifies each finding TP/FP against the truth file (host + time window with ±2 minute tolerance) and computes precision/recall per detector, per scenario, and **Precision@K** (top-K triage quality, the metric that actually matters for DFIR workflow).

### Current results

Two questions matter when evaluating a DFIR triage tool: **how much does it reduce the analyst's workload**, and **does it miss attacks**. `graph-hunt-neo4j` is evaluated against both.

On the stress corpus — 3.87M events, 200 hosts, 85 accounts, 90-day baseline + 7-day investigation window with 23 attack scenarios injected (22 MITRE-canonical + 5 adversarial + 6 legitimate-but-novel decoys) — the tool surfaces **380 prioritized alerts**, a **10,190× reduction** over the raw event stream. Of those 380 alerts, **252 are real attacks (66.3% hit rate)**. The base rate of attacks in the raw events is ~0.003%, so the enrichment factor over random sampling is roughly **23,300×** — an analyst reviewing graph-hunt's output is twenty-three thousand times more efficient at finding lateral movement than reviewing logs at random.

On the recall side, **109 of the 110 injected attack events were detected (99.1%)**, and **23 of 23 scenarios** were caught by at least one detector. The single missed event belongs to a 3-event scenario that two other detectors still flagged — at the scenario level, nothing was missed.

Top-of-list quality drives the real triage workflow: **P@10 = 90%** means the first 10 alerts the analyst reviews contain 9 real attacks; **P@20 = 85%** supports a 20-alert daily review cycle; **P@50 = 92%** means even an exhaustive 50-alert daily review is essentially noise-free.

**Control (5M edges, 50 hosts, 14 users, 14 scenarios)**:

| Findings | TP | FP | Hit rate | Recall (events) | Recall (scenarios) | P@10 | P@20 | P@50 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 83 | 83 | 0 | **100.0%** | **100%** | **14/14** | 100% | 100% | 100% |

The historical SCCM false positive that lived in this corpus for two years vanished — `betweenness-spike` now compares each host's centrality against a baseline-only snapshot of the graph, so structural hubs that were always central don't surface as anomalies (Times Square doesn't become "suspicious" just because it has a lot of traffic). Only hosts whose centrality genuinely grew during the investigation window fire.

**Stress (3.87M edges, 200 hosts, 85 accounts, 23 scenarios)**:

| Findings | TP | FP | Hit rate | Recall (events) | Recall (scenarios) | P@10 | P@20 | P@50 | P@100 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 380 | 252 | 128 | **66.3%** | **109/110 (99.1%)** | **23/23 (100%)** | **90%** | **85%** | **92%** | **73%** |

P@50 = 92% — a small note worth calling out: precision actually rises between K=20 and K=50 on this corpus because the handful of high-score residual FPs from centrality detectors (legitimate hubs like monitoring servers experiencing a real activity surge) cluster at the very top of the ranking, while positions 20-50 are dominated by clean triple-novelty findings. An analyst reviewing the top 50 sees almost no noise.

### Algorithmic notes

Four detector changes contributed materially to the stress numbers:

1. **`betweenness-spike` and `pagerank-spike` use a two-snapshot delta**. A baseline-only GDS projection (`mass-hunt-baseline`, edges with `r.time < cutoff`) is created alongside the full graph, betweenness/PageRank is computed on both, and findings emit only when a host's centrality has grown materially between the two snapshots. Suppresses the entire class of "structural hub" false positives (SCCM, jumpboxes, Citrix farms) that single-snapshot centrality always flags.

2. **`community-bridge` runs Louvain on the baseline-only projection plus the same destination-density + origin-fanout context gate as novel-edge** (same two-snapshot pattern). Critical finding: running Louvain on the full graph (baseline + window) lets the attacker's window edges shift community boundaries — the algorithm can absorb a lateral-movement bridge into a single community, hiding the cross-cluster jump from the detector entirely. Freezing community structure to the pre-cutoff state via baseline-only Louvain restored visibility into 10 attack scenarios that the previous full-graph version was algorithmically blind to (chain-pivot, cred-spray, dcsync, golden-ticket, kerberoasting, service-creation-chain, silver-ticket, slow-burn-creds, svc-account-abuse, wmi-lateral). The context gate then suppresses the residual FP class — infrastructure hosts (monitoring/SIEM/SCCM/backup) bridging into small communities — by filtering origins with baseline out-degree above 30% of the estate and destinations with too few baseline events. Combined effect: community-bridge precision rose from ~17% (single-snapshot full-graph Louvain) to **66.7%**, with zero true positives lost.

3. **`novel-edge` uses (source, user, destination) triple novelty** plus a destination-density + origin-fanout context gate. Triple novelty replaces the previous 3-axis disjunctive test (pair-novel OR user-novel OR logon-type-novel) — it captures the canonical lateral-movement signature directly and includes the "both sub-pairs known in baseline but never as the same event" case (classic compromised-host + stolen-credential signature) that the disjunctive test missed. The context gate then suppresses two residual FP classes at scale: destinations with too few baseline events (where novelty is a coverage artifact rather than anomaly) and origins that talked to more than ~30% of the estate in baseline (services, monitoring agents — new triples are operational rotation, not signal). The logon-type signal is delegated to the dedicated `rare-logon-type` detector, which handles it with destination-class stratification.

4. **GDS 2.x projection lifecycle resilience**. Each algorithmic detector calls `ensure_projection()` at start, defensively re-creating the projection if it has vanished from the catalog between consecutive calls. Required because the per-database GDS catalog can desynchronize across Bolt sessions on Neo4j 2026.x.

### Backend parity: Neo4j vs Memgraph

The numbers above are on Neo4j 2026.x + GDS 2.x. The Memgraph variant of `graph-hunt` shares the same triple-novelty refactor and context-gate logic for `novel-edge` and `community-bridge`, so the most impactful detector improvements ship on both backends. However, MAGE (Memgraph's algorithmic library) doesn't expose `_subgraph` variants for `pagerank.get` or `betweenness_centrality.get` — only for community detection (Louvain and Leiden). That means the two-snapshot centrality pattern can't be replicated in Memgraph without destructive edge manipulation (DELETE/restore) or non-equivalent weight-based workarounds, neither of which is acceptable for an incident-response tool.

The Memgraph variant therefore keeps single-snapshot scoring for `pagerank-spike` and `betweenness-spike`. On the small control corpus this still yields **100% P@10 / 100% P@20 / 100% scenario recall** — operationally identical for top-K triage. The trade-off is ~13 percentage points lower overall precision than Neo4j, concentrated in the long tail (positions 50+) where DFIR triage workflows typically don't reach. Recommendation: Memgraph for corpora up to ~5M edges; Neo4j for larger enterprise stress.

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
