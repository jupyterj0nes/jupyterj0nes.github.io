---
layout: hub
title: "Artifacts"
description: "Forensic artifacts, ordered by the question they answer."
lang: en
ref: artifacts
permalink: /en/artifacts/
groups:
  - title: "Logons and lateral movement"
    anchor: lateral
    text: "Who got into which machine, from where and with which account. This is what [masstin](/en/tools/masstin/) reads."
  - title: "Windows"
    section: lateral-windows
    sub: true
  - title: "Linux"
    section: lateral-linux
    sub: true
  - title: "macOS"
    section: lateral-macos
    sub: true
  - title: "EDR, SIEM and network"
    section: lateral-feeds
    sub: true
  - title: "Execution"
    section: execution
    anchor: execution
    text: "Which programs ran, when, and started by whom."
  - title: "Recovering what was deleted (carving)"
    section: recovery
    anchor: recovery
    text: "What is left when someone cleared the logs."
    links:
      - title: "Deleted EVTX: carving unallocated space"
        url: "/tools/evtx-carving-unallocated/"
      - title: "Volume Shadow Copies: the logs from before the wipe"
        url: "/tools/masstin-vss-recovery/"
      - title: "UAL: three years of access records that survive log clearing"
        url: "/tools/masstin-ual/"
---

What each system writes down, where, and what you can state from it. They are ordered by the question they answer, which is how you look for them in the middle of a case.
