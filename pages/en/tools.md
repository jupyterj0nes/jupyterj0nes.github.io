---
layout: hub
title: "Tools"
description: "Our own DFIR tools: one question per tool, the same timeline format in all of them."
lang: en
ref: tools
permalink: /en/tools/
groups:
  - title: "Start here"
    section: family
    anchor: start
    text: "What happens when the four tools are put on the same evidence."
  - title: "masstin — who logged in where"
    section: masstin
    anchor: masstin
    text: "Every login of a network (Windows, Linux, macOS, EDR) in one timeline, a statistical hunt on top and a window of its own to look at it. [Everything about masstin →](/en/tools/masstin/)"
  - title: "Reading the evidence"
    section: masstin-read
    anchor: read
    sub: true
  - title: "Recovering what was deleted"
    section: masstin-recover
    anchor: recover
    sub: true
  - title: "The viewer"
    section: masstin-viewer
    anchor: viewer
    sub: true
  - title: "Hunting"
    section: masstin-hunt
    anchor: hunt
    sub: true
  - title: "Graph databases"
    section: masstin-graph
    anchor: graph
    sub: true
  - title: "Reference"
    section: masstin-ref
    anchor: ref
    sub: true
  - title: "caarea — what ran"
    section: caarea
    anchor: caarea
    text: "Every program execution on Windows and Linux, from more than 60 sources, with the process tree rebuilt."
    links:
      - title: "Code and documentation, on GitHub"
        url: "https://github.com/jupyterj0nes/caarea"
  - title: "faramir — what persists"
    section: faramir
    anchor: faramir
    text: "Every autostart, hijack and backdoor, live or deleted: 52 techniques on Windows plus the Linux ones."
    links:
      - title: "Code and documentation, on GitHub"
        url: "https://github.com/jupyterj0nes/faramir"
  - title: "allymacb — what the file system did"
    section: allymacb
    anchor: allymacb
    text: "The MACB timeline of NTFS, ext4 and XFS, with timestomping detection and recovery of deleted records."
    links:
      - title: "Code and documentation, on GitHub"
        url: "https://github.com/jupyterj0nes/allymacb"
  - title: "etcdump — how a Linux box was configured"
    section: etcdump
    anchor: etcdump
    text: "The configuration of every Linux root in an image or a triage, as text and as a timeline, with 51 rules."
    links:
      - title: "Code and documentation, on GitHub"
        url: "https://github.com/jupyterj0nes/etcdump"
  - title: "The shared pieces"
    section: common
    anchor: common
    text: "The libraries every tool is built on."
    links:
      - title: "evidencefs"
        url: "https://github.com/jupyterj0nes/evidencefs"
        text: "One reader for images, volumes, shadow copies, triage packages and archives."
      - title: "blockcarve"
        url: "https://github.com/jupyterj0nes/blockcarve"
        text: "The block-wise carving they all use, with structural validators."
      - title: "dirtyhive"
        url: "https://github.com/jupyterj0nes/dirtyhive"
        text: "Dirty registry hives: transaction logs applied and deleted keys recovered."
  - title: "In the works"
    anchor: soon
    text: "Tools that are finished or nearly so, not published yet."
    soon:
      - title: "agentc00pr — the case workbench"
      - title: "opentrail — what was opened"
      - title: "exfilter — what left the machine"
      - title: "webfoot — what happened in the browser"
      - title: "hivedump — the whole registry as a timeline"
      - title: "hostsweep — YARA, IOC and Sigma over the evidence"
      - title: "lunarrust — Unix triage by CVE"
  - title: "Earlier and contributed"
    section: legacy
    anchor: legacy
---

Each tool here answers one question of an investigation, and they all write the same kind of timeline: a 19-column CSV in UTC, with the same five closing columns for what the hunt finds and what the analyst notes. That is why they read side by side.

| Question | Tool |
|---|---|
| Who logged in where? | **masstin** |
| What ran? | **caarea** |
| What persists? | **faramir** |
| What did the file system do? | **allymacb** |
| How was that Linux box configured? | **etcdump** |
