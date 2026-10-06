---
layout: post
title: "graph-hunt: lateral movement as a statistical question"
date: 2026-10-06 09:00:00 +0200
category: tools
lang: en
ref: tool-masstin-graph-hunt
tags: [masstin, graph-hunt, lateral-movement, statistics, hopper, neo4j, memgraph, dfir, detection]
description: "masstin's graph-hunt no longer scores logins with hand-picked weights. Every window connection is measured against the network's own baseline, the only number you choose is the false discovery rate, and the output is a ranked list with the reason in words, a Hopper class, a chain from any seed and an analyst report. Here is what a run looks like, how it decides, and what it found on the public LANL set."
comments: true
---

<video autoplay loop muted playsinline style="display:block; margin: 0 auto 1rem; max-width: 100%; border-radius: 6px;" poster="/assets/images/masstin-graph-hunt-seed.gif">
  <source src="/assets/video/masstin-graph-hunt-seed.mp4" type="video/mp4">
  <img src="/assets/images/masstin-graph-hunt-seed.gif" alt="graph-hunt-csv reconstructing the attacker's chain from one seed IP">
</video>

That is the whole of the [DFIR Madness "Szechuan sauce"](https://dfirmadness.com/the-stolen-szechuan-sauce/) case in one command: the timeline masstin parsed from the two disk images, one known-bad IP as a seed, and 0.2 seconds later the chain. The attacker enters the domain controller as `ADMINISTRATOR` over RDP, the DC reaches the workstation with the built-in administrator's SID and then with the named account, and the workstation goes back to the DC. Every hop carries a certainty: 1 for the seed's own login, 1/55 and 1/63 where the DC had dozens of sessions open and any of them could have been the hand on the keyboard, 1/9 for the way back.

This post is about the engine behind that output. It replaced the one I wrote about in May.

## The question after `load-*`

Load a month of logins from fifty machines into a graph and you have a beautiful picture of who talks to whom. It answers questions you already know how to ask: what did this IP do, who used this account, which path joins these two hosts in time. It does not answer the question an analyst actually brings to the first day of an incident: **of everything that happened after the compromise, what is new for this network?**

The first graph-hunt answered it with seven detectors, each with its own weights, windows and minimums, combined into a score. On synthetic corpora it did well. On real logs the first thing it ranked was a credentialed vulnerability scanner. Every constant in that engine was a guess about what networks look like, and real networks look different. A score of 0.93 does not tell you how often a benign day scores 0.93.

So the engine was rewritten around one idea: **do not choose any number; measure it.** The only parameter left is the false discovery rate, and the output is a p-value per connection that means what a p-value means.

## What a run looks like

```bash
masstin -a graph-hunt-csv -f timeline.csv \
        --investigation-from "2020-09-19 00:00:00" \
        --seed 194.61.24.102 --report hunt.md -o hunt.csv
```

No database is involved: `graph-hunt-csv` reads the timeline that any `parse-*` action wrote and computes everything in memory. The same engine runs on a loaded graph with `graph-hunt` (Memgraph) and `graph-hunt-neo4j`, and gives the same rows; the graph is only there if you want to explore afterwards. No MAGE, no GDS, no plugin of any kind.

The terminal tells you what it is measuring before it tells you what it found:

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

Each line is a decision the engine made and you can disagree with. Two IPs were folded into host names because the same logins were recorded under both far more often than chance allows. Seven destinations have continuous log coverage, so counts are only compared on them. One baseline day forms the null, which is why nothing is significant here: Szechuan ships two days of logs, and with one day of reference the engine cannot tell "new" from "unseen". It says so instead of inventing a threshold. The seed reconstruction does not need a null, so the chain comes out anyway.

## How it decides

**The unit is the connection.** One origin, one destination, one account, one result (login, failure, or a touch without authentication), on one UTC day. A connection that already happened on another earlier day is habitual: p = 1, never reported. The hunt is only ever about the new ones.

**New means new for this network.** A fact is new on a day when it occurred on no earlier day, whether that day is in the baseline or in the window. A baseline day is therefore judged by the same rule as a window day, and the baseline days become the yardstick: how often does a new connection look like this on an ordinary day here?

**Ten facts, one test.** For a new connection the engine measures what is new about it and about its origin's day: destinations the origin reached for the first time, accounts it had never used, account-destination pairs nobody had made, a destination outside the origin's community, failures and pre-authentication touches, a refused attempt followed by a login with a different account, an origin with no history at all, the rarest logon type, how fast it chains from the login that preceded it, the change in the destination's centrality. None of them has a weight. They are combined into one joint statistic and that statistic is calibrated against the baseline connections of the same network, which gives a p-value that stays valid however the signals depend on each other (a conformal p-value, for the statistically minded). Then Benjamini-Hochberg across all the new connections at the rate you asked for.

**Coverage is a fact too.** Every log file has a time span, and the loaders write it on the host it belongs to. Counts are only compared across a panel of destinations watched continuously; a login to a host whose logs start on the day of the incident is reported as *not evaluable*, not ranked as if its novelty meant something.

**Hopper's signature orders the rows.** Ho et al. (USENIX Security 2021) found that lateral movement almost always combines a **credential switch** (an account that belongs to other machines, used from one that never used it) with a **new access** (a destination new for that origin or that account). Hopper read the owner of an account from an inventory. masstin reads it from the logs: of the account's earlier login-days, the share that came from its most frequent origin. An account that always came from one workstation and now appears from a server is a switch that weighs 1; a service account used from 900 machines weighs almost nothing. Within the significant set, switches with new access come first, then unknown accounts, then new destinations with habitual credentials (scanners, orchestration, an admin on their own account), then the rest. The p-value is untouched; the class is the first thing you read.

## Reading the output

The CSV has one row per connection, most unusual first:

```
rank, significant, p_value, q_value, day, first_seen_utc, last_seen_utc, origin, destination,
account, result, events, logs, signature, why_unusual, evidence, chain, campaign, cypher_snippet
```

`why_unusual` is the reason in short phrases: *origin never seen before; that day the origin reached 29 destination(s) for the first time; the account belongs elsewhere: 100% of its earlier login-days came from C8198*. `evidence` repeats each reason with the baseline count behind it, so every claim can be checked. `signature` is the Hopper class, one value to filter on. `chain` is the connection's place in the seed reconstruction when you gave one.

With `--report hunt.md` you also get one story per origin that has a significant connection: whether it existed in the baseline and what it usually did, what it did in the window in chronological phases, why each phase is unusual with the count behind every statement, who owns the accounts it used for the first time, its causal paths, the origins it moves with, and three paragraphs I found myself writing by hand on every case before they were generated: *could be benign if*, *to rule that out*, and *events to pull* (the raw Windows or Linux events that settle it, chosen from the log families that recorded the origin). On Neo4j each origin ends with a Browser query that draws exactly that subgraph.

Two more inputs, both optional. `--seed` is what the video shows: hosts, IPs or accounts you already know are bad, followed through the sessions they opened until the end of the day, with a certainty on every hop and a Cypher query that draws the chain. `--sigma` takes the JSON output of [Hayabusa](https://github.com/Yamato-Security/hayabusa) or [Chainsaw](https://github.com/WithSecureLabs/chainsaw): a rule that fired on a machine while a login session was open on it becomes one more measured signal of that connection, and the explanation names the rule, the time and the level. masstin does not detect PsExec or WMI itself; it joins what those tools found to the login that made it possible.

## Does it work

One measurement, with ground truth that was not produced by me.

**A public benchmark.** The Los Alamos ["Comprehensive, Multi-Source Cyber-Security Events"](https://csr.lanl.gov/data/cyber1/) set is the reference every lateral-movement paper uses: 58 days of a real enterprise, 1.05 billion authentication events, 749 labelled red-team logins. It was converted to a masstin timeline the way a DFIR collection would look (the logs of the red-team machines plus 200 others, user accounts only, 16 days, cutoff at day 7) and run with `graph-hunt-csv`: 21.3 million rows, 14 minutes, 3.3 GB of memory.

| | value |
|---|---:|
| connections in the window | 465,074 |
| red-team connections among them | 444 |
| significant at FDR 5 % | 204: 185 red team, 19 from one unlabelled machine that failed on 47 hosts and then logged in with 7 accounts new to it |
| precision of the first 100 rows | 99 % |
| red-team connections in the first 500 rows | 286 of 444 |
| incident-free period (days 40 to 43, 241,423 connections) | 0 significant |

What it does not catch is also in the table: the second red-team machine made one quiet login per host with a different user each time, and this network's baseline contains that pattern thousands of times a day (people using their own account from a machine never seen before). No login-graph method detects those without an inventory of who owns which machine; Hopper's own misses are of that kind. For scale, Hopper reports 94.5 % detection at about nine alerts a day with an inventory and two months of training; the best graph-neural-network result on LANL reports an average precision of 0.32 that falls to 0.09 under fair labelling (Larroche, 2026).

## When not to use it

Two days of logs is not a baseline; the Szechuan run above says so itself. A single host's triage has no network to compare against. And an attacker who makes one login with the victim's own account from the victim's own workstation has done nothing new for the network; that is what the seed reconstruction and the Sigma corroboration are for.

## Try it

`graph-hunt-csv`, `graph-hunt` and `graph-hunt-neo4j` ship in [masstin v1.1.0](https://github.com/jupyterj0nes/masstin/releases/latest), one binary for Windows, Linux and macOS.

```bash
masstin -a parse-massive -d /evidence/case/ -o timeline.csv
masstin -a graph-hunt-csv -f timeline.csv --investigation-from "2026-03-15 00:00:00" \
        --report hunt.md -o hunt.csv
```

The design, with the reason behind every choice and the assumptions it rests on, is in [docs/graph-hunt-statistics.md](https://github.com/jupyterj0nes/masstin/blob/main/docs/graph-hunt-statistics.md); the options and the output columns in [docs/graph-hunt.md](https://github.com/jupyterj0nes/masstin/blob/main/docs/graph-hunt.md). If it ranks something wrong on your data, in either direction, an issue with a sanitised row and its `evidence` column is the most useful thing you can send.

---

## Related

| Topic | Link |
|-------|------|
| Masstin main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Neo4j and Cypher visualization | [neo4j-cypher-visualization](/en/tools/neo4j-cypher-visualization/) |
| Memgraph in-memory visualization | [memgraph-visualization](/en/tools/memgraph-visualization/) |
| CSV format and event classification | [masstin-csv-format](/en/tools/masstin-csv-format/) |
| Hopper: Modeling and Detecting Lateral Movement (Ho et al., USENIX Security 2021) | [usenix.org](https://www.usenix.org/conference/usenixsecurity21/presentation/ho) |
