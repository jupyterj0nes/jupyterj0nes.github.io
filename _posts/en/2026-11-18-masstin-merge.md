---
layout: post
title: "merge: joining timelines without losing your notes"
short: "merge and carry-marks"
date: 2026-11-18 22:00:00 +0100
category: tools
section: masstin-read
order: 90
lang: en
ref: tool-masstin-merge
tags: [masstin, merge, timeline, notes, dfir]
description: "masstin's merge action joins several timelines into one, sorted and without duplicates, and with --carry-marks keeps the verdicts and notes when you parse the evidence again."
comments: true
---
A case rarely arrives whole. On Monday you have the logs of two servers. On Wednesday three disk images come in. On Friday someone finds the VPN logs. Each delivery is a timeline, and what you want is one.

```bash
masstin -a merge -f monday.csv -f wednesday.csv -f vpn.csv -o case.csv
```

The result is sorted by instant and has no duplicates. If the same event is in two timelines, because on Wednesday they collected a Monday server again, it comes out once.

## Layouts from any era

masstin has added columns over the years: it started with 12, went to 14 and today writes 19. `merge` reads all three layouts and always writes the 19. A two-year-old timeline mixes with today's without converting anything.

The columns at the end (`hunt`, `hunt_score`, `hunt_why`, `verdict`, `notes`) travel with their row. And if the same event comes once with them and once without, they are kept.

## The problem --carry-marks solves

This is the reason the article exists.

You are three days into a case. You have marked connections as suspicious, written notes, dismissed others as benign. All of that is in the `verdict` and `notes` columns of your timeline.

Then more evidence arrives, or a masstin version comes out that reads a new event, and you have to parse again. The new timeline comes out clean, without a single mark. Three days of work, in the old file.

```bash
masstin -a merge -f new1.csv -f new2.csv -o case-v2.csv --carry-marks case-v1.csv
```

`--carry-marks` copies the verdicts and notes from the earlier timeline onto the matching rows of the new one. The console says how many:

```
Merge: 23 row(s) took their verdict / notes from the earlier timeline (23 marked rows there)
```

Twenty-three marked rows in the old one and twenty-three recovered in the new one. That "23 of 23" is what to look at. If it said "19 of 23", four marks did not find their row, nearly always because that evidence is not in the new parse.

In the example, the earlier timeline is the lab's with one connection marked suspicious from the [viewer](/en/tools/masstin-viewer-marks-case/). The new one is the same evidence plus the rows of another evening. The marks carry over, and the new rows arrive unmarked, as they should.

The same option exists in the hunt (`graph-hunt-csv --carry-marks`), for the same purpose.

## With a single timeline

`merge` asks for two files, except when you ask it to change something. With a filter or with `--carry-marks`, one is enough:

```bash
# re-filter a timeline already made
masstin -a merge -f case.csv --ignore-local -o case-filtered.csv

# carry the marks over from the earlier version
masstin -a merge -f case-new.csv --carry-marks case-old.csv -o case-new-marked.csv
```

The first is explained in [filtering the noise](/en/tools/masstin-noise-filtering/).

## What it tells you at the end

```
Merge: 11065 rows written; skipped 0 malformed (wrong column count),
       0 unparseable time, 0 outside window, 19666 filtered, 0 duplicate
```

Every row that does not reach the result has a reason and a counter. *Malformed* is a row whose column count does not fit, nearly always a CSV someone opened and saved with a spreadsheet. If that number is not zero, find out why before going on.

## Bounding it in time

`merge` takes `--start-time` and `--end-time`. It is for pulling just the two weeks of the incident out of a six-month timeline, to share it or to work with something lighter.

## The file that goes with it

When it writes the timeline, masstin leaves a `<name>.masstin` beside it with what it knows about it: what evidence it came from and whose each address is. On a merge, that information is kept. It is the same file the viewer uses [as the case file](/en/tools/masstin-viewer-marks-case/).
