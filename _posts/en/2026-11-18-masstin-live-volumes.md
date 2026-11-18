---
layout: post
title: "Reading a mounted disk without imaging it"
short: "Mounted volumes and live systems"
date: 2026-11-18 20:30:00 +0100
category: tools
section: masstin-read
order: 30
lang: en
ref: tool-masstin-live-volumes
tags: [masstin, triage, vss, write-blocker, incident-response, dfir]
description: "masstin reads the raw volume of a mounted drive or a live system, shadow copies included, without making a forensic image first."
comments: true
---
Imaging a one-terabyte disk takes hours. There are cases where you do not have those hours: the client wants to know *now* whether the attacker moved from that server to the others, and the answer is in a few logs that take up a few hundred megabytes.

masstin can read them straight from the volume:

```bash
masstin -a parse-image -d D: -o timeline.csv
```

Give it the drive letter and it reads the raw volume. It does not go through Windows' file system, which is why it does not matter that the logs are open and locked by the event service.

## Two situations

**The disk is on a write blocker.** You took it out of the machine, you connect it to your analysis box through a blocker and it shows up as `E:`. Instead of waiting for the image, or while you make it in another window, you read the logs.

**The system is running.** You are on the server, or connected to it, and you read its own `C:` disk. That is live triage: in a couple of minutes you have that machine's timeline.

## With the shadow copies

This is what sets it apart from copying the `winevt\Logs` folder by hand. masstin also reads **every shadow copy (VSS)** on the volume.

The logs in a shadow copy from two weeks ago may hold what the attacker deleted yesterday. It is one of the cheapest ways of recovering events, and it comes by itself, without asking. I explain it in [the VSS article](/en/tools/masstin-vss-recovery/).

## Several volumes

```bash
# two drives
masstin -a parse-image -d D: -d E: -o timeline.csv

# every NTFS volume on the system
masstin -a parse-image --all-volumes -o timeline.csv
```

`--all-volumes` is for when you do not know which one Windows is on, or when you land on a server with six disks and would rather not go asking.

## What to know

**It needs privileges.** Reading a raw volume requires running as Administrator on Windows, or with `sudo` on Linux. Without that, the system will not let you open the device.

**Live, you change the machine.** Not much, but something: running any program on a live system leaves a trace (masstin's own prefetch, for one). If the case may end up in court, write it down in your notes and, when you can, make the image as well. masstin reads; it does not write to the volume. Put the output CSV on another drive.

**A PowerShell trap.** In Windows PowerShell 5.1, the one Windows ships with, a path **with spaces** that ends in `\` swallows the arguments after it: `-d 'D:\my case' -o out.csv` reaches the program as one odd path. It happens with single and with double quotes alike. masstin detects it and warns you, but the safest thing is to leave the trailing backslash out. In PowerShell 7.3 or later it no longer happens.

## When to image anyway

This does not replace the image. masstin's timeline answers "who logged in where", and a case has many more questions. What it gives you is an answer in minutes to the question that usually decides what you do next: which other machines to look at.
