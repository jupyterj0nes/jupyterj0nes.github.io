---
layout: post
title: "What a 78 means: the same scale in every tool"
short: "The hunt columns: the same states and the same scale"
date: 2026-11-18 23:52:00 +0100
category: tools
section: family
order: 20
lang: en
ref: tool-family-hunt-scale
tags: [hunt, hunt_score, masstin, caarea, faramir, allymacb, etcdump, statistics, dfir]
description: "The three hunt columns mean the same in masstin, caarea, faramir, allymacb and etcdump: the same states, a 0 to 100 scale that measures rarity and not confidence, and rules whose weight is measured on clean machines."
comments: true
---
Every tool on this page ends its timelines with the same columns: `hunt`, `hunt_score` and `hunt_why`. And they mean the same in all of them. This article explains what, because without knowing it a `significant 78` says little, and knowing it you can compare a login row with a persistence row.

## The states

The `hunt` column can only hold one of these words:

| State | What it means |
|---|---|
| `significant` | It clears the bar: a high rule, or a statistical rarity that survives the correction for having looked at thousands of rows |
| `candidate` | It does not clear the bar, but deserves a look: a medium rule, something rare but not enough, something deleted |
| `habitual` | Something vouches for it: it is on a clean reference machine, or on many machines of the case, or on a list of known items |
| `baseline` | It is from before the date you gave as the start. It serves as reference, it is not judged |
| `not_evaluated` | There was nothing to compare it with |
| empty | The hunt was not run, or nobody had anything to say about that row |

One word is missing on purpose: *suspicious*. A person decides that, and it goes in another column, `verdict`, which no tool writes in.

## The scale

`hunt_score` runs from 0 to 100 and measures **how rare the row is**, not how sure the tool is.

The sum is `−10 · log10(p)`, where `p` is the share of normal rows that look at least this rare. Without the formula, every ten points are one order of magnitude:

| Points | Read as |
|---|---|
| 0 | Like any other |
| 13 | One in twenty |
| 20 | One in a hundred |
| 30 | One in a thousand |
| 60 | One in a million |
| 100 | The cap |

That is why `hunt_score >= 30` means the same in masstin's timeline as in faramir's: what is rarer than one in a thousand.

When two independent rules meet on one row, their points add. That is what happens with the probabilities of independent things: they multiply, and on a logarithmic scale multiplying is adding. The lab's `invoice.pdf.exe` scores 78 in caarea because it carries two rules worth 39.

## Where a rule's points come from

This is the least usual part. In almost any tool, whoever writes a rule also sets its severity: "this is an 80". Not here.

A rule's author states only its **level** (high, medium or low), which decides the state. The **points** are measured: the rule is run over clean machines and the hits are counted.

- A rule that fired 19 times on 2,003 clean rows is worth 20 points: one in a hundred.
- A rule that never fired is not worth "infinity". It is worth what the size of the reference allows you to claim: one in 2,004, which is 33 points.
- A rule that fires on more than one clean row in ten is noise: it gives no state and no points, it is only noted.

That last line is the one that changes things most. The classic timestomping rule, `$SI` earlier than `$FN`, fires on one file in four of a clean modern Windows. In [allymacb](/en/tools/allymacb-timestomping-rules/) it is worth zero.

And it explains an oddity: the ceiling of a single rule depends on how large the clean reference is. That is why a rule that never fails is worth 33 in faramir (2,003 reference rows), 39 in caarea (8,671), 40 in etcdump (10,017) and 56 in allymacb (431,153). allymacb is not more certain. It has more clean files to compare with than faramir has persistence entries.

## Who vouches

A rule judges a single row. But a freshly installed machine does things every day that, looked at one by one, are extremely rare: Defender running a binary from a temporary folder, an installer laying down thousands of files with old dates, a cloud image with passwordless sudo.

That is why each tool carries inside it what real clean machines did, and whatever matches that is `habitual` **whatever the rule says**. The rule keeps its sentence in `hunt_why`, so that you can see it fired, but it adds nothing.

It shows on a single screen of [etcdump](/en/tools/etcdump-linux-configuration/):

```
[  55] %Leadership = ALL=(ALL) NOPASSWD:ALL    <<< candidate rule LNX-SUDO-NOPASSWD-ALL (medium)
[   4] ubuntu = ALL=(ALL) NOPASSWD:ALL         <<< habitual rule LNX-SUDO-NOPASSWD-ALL (medium)
```

The same rule, on two lines that grant the same thing. Ubuntu ships with the second.

## The statistics

masstin has no rules: it only compares. faramir and allymacb have both, rules and comparison. caarea and etcdump, today, have rules and a clean reference, with no statistical test. Where there is one, the idea is the same:

1. What is being investigated is separated from what serves as reference. In masstin, the days before the start date. In faramir, the other machines or what predates `--baseline`. In allymacb, what the volume did before.
2. For each investigated row, the reference rows that are at least as rare are counted. That gives `p`.
3. Since thousands of rows are looked at together, some will come out rare by chance. That is corrected (Benjamini-Hochberg), and `--alpha` is the share of false findings you accept among the significant ones. 0.05 by default.

The most important limit comes out of that design, and it is the same in all three: **without a reference there are no statistics**. With `N` reference rows or days, nothing can be rarer than one in `N + 1`. The lab has a single day of activity before the incident, which is why its statistical hunt gives little, and noisily, while the rules, which need no past, are right.

How masstin does it in detail is in [graph-hunt](/en/tools/masstin-graph-hunt/).

## How to read `hunt_why`

The third column explains the other two, always in the same order: first the rules, strongest to weakest; then the statistics' words.

```
rule H1009 (high): Script run from a user-writable folder [T1059];
rule H3001 (high): Persistence from a scratch folder [T1547]; on 2 of 5 hosts
```

Each rule starts with `rule`, its identifier and its level. To keep only what the rules said, filter on `rule `. To keep only the statistics, on its absence.

## What the scale does not say

- **It does not say something is bad.** A 78 is "this almost never happens on a normal machine". The administrator who installs an odd tool once a year also gets a 78.
- **It does not say the rest is good.** An attacker who uses what that network's administrators use, at the same hours and from the same machines, is `habitual`.
- **It depends on the reference.** The clean machines behind it are few and from a lab: Windows Server 2016 and Ubuntu 22.04. On another system, or on a network with a lot of in-house software, there will be more noise. Several tools let you measure a reference of your own, and it is worth doing.

What it does do is put things in order. Six thousand persistence entries or a million and a half files are not read; a hundred rows sorted by rarity, with the reason written beside them, are.
