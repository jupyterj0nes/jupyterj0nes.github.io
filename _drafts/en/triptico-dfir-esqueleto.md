---
layout: post
title: "[[TITLE]] — [[technique]] in three acts"
date: 2026-10-07 10:00:00 +0100
category: laboratorio
lang: en
ref: lab-triptico-NN
tags: [dfir, attack, hardening, forensics, active-directory]
description: "One technique, three acts: we execute it, we mitigate it, and we read the trace raw on the lab."
comments: true
---

<!--
  SKELETON / DRAFT. Fill the [[placeholders]] with your REAL run
  (commands, screenshots under /assets/img/posts/<case>/, artifacts).
  GitHub Pages does NOT build _drafts/, so this is not published.
  To publish: move this file to _posts/en/ with the real date in the
  filename (YYYY-MM-DD-slug.md); keep the same `ref` as the ES twin.
-->

> One technique, three acts. We **execute** it (🔴), we **mitigate** it (🟢) and we **investigate** it (🔵) — and we learn to read the trace raw.

## Starting point

This case runs on the blog's lab. The **deployment is not explained here** — follow the matching guide in [The Lab]({{ '/en/laboratorio/' | relative_url }}) ([[link the specific article: manual build or RangeForge deploy]]).

**Initial state (only what's specific to this technique):** [[attacker host · compromised starting user · objective]]. We never attack as the analyst.

---

## Act I · 🔴 The crime — attack

**What we do:** [[technique — e.g. Kerberoasting / NTLM relay / lateral SMB / ADCS ESC1]].

**From where:** [[attacker host and compromised user — never the analyst]].

```bash
# [[real command]]
```

![[[screenshot description]]](/assets/img/posts/[[case]]/attack-01.png)

**What it leaves on the wire:** [[what a defender would —or wouldn't— see at this point]].

---

## Act II · 🟢 The defense — hardening

**Control applied:** [[LGPO / GPO / specific setting]].

```
# [[before  →  after]]
```

**What changes in the telemetry:**

| Signal | Before | After |
|--------|--------|-------|
| [[Event ID]] | [[…]] | [[…]] |
| [[…]] | [[…]] | [[…]] |

**Re-running the attack:** [[does it still work? what changes in the trace it leaves?]].

---

## Act III · 🔵 The investigation — forensics

We start from a **snapshot** of the compromised host, download it and analyze it **dead-box** — without touching the live system.

**Raw artifacts (no third-party tools):**

- [[registry key / EVTX / prefetch / UAL / …]] — what it says and why it matters.
- [[…]]

**With my tools:**

- `masstin` — [[lateral-movement graph / timeline]].
- `boromir` — [[persistence mechanisms]].
- [[others: sabonis, mftmactime, regripper…]].

**The analyst's conclusion:** [[what happened, in one sentence, with the concrete evidence that proves it]].

---

### Reproducibility

[[Link to the script / repo / commands to reproduce all three acts end to end.]]
