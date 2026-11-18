---
layout: post
title: "Performance and damaged evidence: what masstin does without being asked"
short: "Performance and damaged evidence"
date: 2026-11-18 22:30:00 +0100
category: tools
section: masstin-read
order: 100
lang: en
ref: tool-masstin-performance
tags: [masstin, performance, evtx, threads, dfir]
description: "How masstin shares the work among the cores that are idle, why it leaves three quarters of a triage unread, how it copes with a four-gigabyte log, and why the result is identical with one thread or thirty-two."
comments: true
---
There is a part of masstin you do not see and that has more work behind it than it seems: going fast without leaving the machine unusable, and not falling over when the evidence comes broken. Neither has an option to switch on. This article says what happens underneath, in case the behaviour surprises you one day.

## It uses what is idle, not what there is

On start, masstin says what it is going to work with:

```
Threads: up to 11, what is idle at each moment (12 cores, 11.4 idle now, 6.1 GB free;
         --threads fixes it, 1 runs serial); priority below normal
```

Twelve cores, up to eleven threads. It always leaves one for the system. But the phrase that matters is *what is idle at each moment*: it does not reserve eleven threads, **it uses the ones that are free at each moment**, and measures again at most once a second.

On an analysis server with nothing else to do, it uses all of it. On a laptop with another tool working alongside, it steps aside. And since it runs below normal priority, your desktop and whatever you have open come first.

If you would rather fix it, `--threads N`. With `--threads 1` it runs serially.

## Memory is measured too

EVTX files are read several at a time, in waves that fit a budget: a quarter of the free memory, with half a gigabyte at least. A file bigger than the budget is read alone.

And an EVTX on disk **is never loaded whole**: it is read chunk by chunk, 64 KiB at a time. A four-gigabyte `Security.evtx`, and there are such things on domain controllers with badly configured retention, takes no more memory than the chunks in flight.

The exception is an EVTX inside a ZIP, which has to be decompressed in memory.

## Images: how many at once

With several disk images, how many are read in parallel? It depends on the storage, and masstin does not assume: it measures.

It starts with one reader if the disk is a spinning one (two would only make the head dance) and with two anywhere else. It counts the bytes a second coming off, over three-second windows. While the rate keeps growing, it doubles the readers. When doubling brings nothing, it goes back to the previous size. And if the rate drops, because the storage or the network fell behind, it halves them.

Images on a NAS over a slow network and images on a local NVMe end up with different settings without you touching anything.

## Three quarters of the triage goes unread

A folder of Windows logs has hundreds of channels, and masstin can only read the ones that speak of lateral movement. PowerShell, TaskScheduler, Application, System: it has no parser for them, and they are most of the bytes. In a typical triage, three quarters.

Those files are left unread. But carefully, because getting this wrong would mean losing evidence silently.

A file is skipped only when **its name and its content agree** on it: the name is that of a channel masstin does not read, and the first record of the first chunk, of the last chunk in use, and of four chunks spread through the file all name that same channel.

If anything does not fit, it is read whole. That includes:

- A **renamed or archived** log (`Security-2024-01-02.evtx`).
- A log of **forwarded events** (`ForwardedEvents.evtx`), where each record keeps its original channel and those of many machines may be mixed.
- A file with **a damaged chunk**.
- A record that does not say which channel it belongs to.

For the same reason, the file name never decides how an event is read. Each record is routed by its own channel. A `Security.evtx` someone renamed to `copy.evtx` is read just the same, as I explain in [the archived EVTX article](/en/tools/masstin-archived-evtx-provider-dispatch/).

## When the evidence comes broken

The evidence of a real case comes broken more often than you would like: a log truncated because the machine went down halfway, a corrupt chunk, a ZIP that does not close.

masstin's rule is to carry on. I tested it by damaging a lab `Security.evtx` on purpose: I overwrote one whole 64 KiB chunk with garbage and cut the end of the file off in the middle of another.

```
original:  Security.evtx (1247)
damaged:   Security.evtx (1158)
```

1,158 events out of 1,247. Those of the two damaged chunks are lost and the rest is read normally. One broken file among two thousand does not bring the run down.

Now the part you need to know: **it does not warn you**. There is no line saying "this file had a corrupt chunk". All you see is a lower number in the breakdown by source. So that breakdown has to be read: if a domain controller gives forty events from `Security.evtx`, there is something to look at.

For E01 images with corrupt areas where carving gets stuck there is a specific option, `--skip-offsets`, which skips the areas you name.

## Identical with one thread or thirty-two

This is the most important part of the section. Running in parallel is easy. Running in parallel without changing the result is not.

Every parallel stage collects its results **in the order of its inputs**, and the final sort is stable. The consequence is that the CSV is the same, byte for byte, with one thread or with thirty-two.

It is not a promise: it is checked. On every change, continuous integration parses the public sample sets with one thread and with all the machine's, on three operating systems, and compares the files.

In forensics that is not a technical detail. If tomorrow someone repeats your analysis on another machine and gets a different timeline, you have a problem that has nothing to do with the case. And you can check it yourself on your own evidence: parse it once normally and once with `--threads 1`, and compare the two files.
