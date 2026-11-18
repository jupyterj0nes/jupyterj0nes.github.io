---
layout: post
title: "masstin's viewer: the lateral movement graph without a database"
short: "masstin's viewer: overview"
date: 2026-11-18 09:00:00 +0100
category: tools
section: masstin-viewer
order: 10
lang: en
ref: tool-masstin-viewer
tags: [masstin, viewer, graph, lateral-movement, dfir]
description: "masstin ships its own window: open the CSV and it draws who logged in where, with filters, the table of rows and a path search. No Neo4j, no Memgraph."
comments: true
---

For a long time, looking at a masstin timeline meant bringing up Neo4j or Memgraph, loading it and writing Cypher. That works, and it is still there for whoever wants it. But in the middle of an incident, on the field laptop and in a hurry, setting up a graph database is the step nearly everyone skips. And then nobody looks at the graph.

So masstin now has a window of its own. It reads the CSV as it is and draws it.

```bash
masstin -a view -f timeline.csv
```

Double-clicking the executable works too, and so does running `masstin` with no arguments: you get a welcome screen where you drop the evidence or a timeline you already have.

## What you see

[![masstin's viewer on the lab timeline: fourteen machines, the domain controllers in violet, servers as racks, and the accounts written on every connection](/assets/images/viewer/v-overview.webp){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}](/assets/images/viewer/v-overview.webp)

This is our lab's timeline: 28,672 rows from one week, fourteen machines, 23 accounts. It opens in half a second.

Each machine is drawn as what it is. A monitor is a workstation, a rack is a server, the rack with the key is a domain controller. The antenna is an IP address the timeline has no name for. A globe would be an address from outside the network.

The lines are connections, with the account written on them. They get thicker with more events, grey when the logon went through, red when it failed, and dotted purple when it is a connection without a logon (a 4648, a Kerberos ticket, an RDP that never authenticated).

Around the map there are three areas:

- **On the left, the filters.** Three views (the hunt's findings, one machine's neighbourhood, or everything), search by machine, account and logon type, and the time window.
- **On the right, the inspector.** Click a machine or a connection and it tells you what is behind it.
- **At the bottom, the time strip.** A histogram of the whole timeline with two handles. Move them and the map keeps that period.

## Click to find out

[![The inspector with a machine selected: its names, how many connections go in and out, and with which accounts](/assets/images/viewer/v-inspector.webp){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}](/assets/images/viewer/v-inspector.webp)

The inspector is where you end up spending the time. For a machine, it tells you who it talks to and with which accounts. For a connection, the exact rows that make it up and, if you have run the hunt, why it looked odd. From there, one click takes you to those rows in the table.

## And the rows are still underneath

A graph summarises, and a summary hides things. That is why the **Timeline** button at the top swaps the map for the table: the CSV's 19 columns as written, with their line numbers.

[![Timeline mode filtered by logon type 10: the rows of several RDP sessions of one account, with events 131, 1149, 4624, 21 and 22 one after another](/assets/images/viewer/v-timeline.webp){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}](/assets/images/viewer/v-timeline.webp)

Here I filtered on `logon_type` 10 and 54 rows of the 28,672 are left. You can see the full footprint of an RDP session: the 131 from RdpCoreTS when the connection arrives, the 1149 when it is accepted, the 4624 of the logon, the 21 and 22 from the session manager, and at the end the 4647 and the 24 of the logoff. Seven or eight rows from four different logs for one thing one person did. That is exactly what the graph folds into a single line.

Filters add up ("contains", "does not contain", per column), and the table handles a million rows without noticing, because it only draws the ones on screen.

## What else is in there

The window has kept growing and each part has its own article:

- [Find path: paths between two machines](/en/tools/masstin-viewer-find-path/)
- [Trees: everything that leaves an origin or reaches a destination](/en/tools/masstin-viewer-trees/)
- [Paths by session: when the machine wrote down who made the hop](/en/tools/masstin-viewer-session-paths/)
- [Hosts and addresses: joining a name to its IP](/en/tools/masstin-viewer-hosts-addresses/)

## What it does not do

It does not replace a graph database if what you want is to write your own queries: [Neo4j](/en/tools/neo4j-cypher-visualization/) and [Memgraph](/en/tools/memgraph-visualization/) are still there for that. And it makes nothing up. If a machine shows up by name in some rows and by IP in others, you will see two nodes until you decide to join them.

It does not need a graphics card either. On a server over remote desktop, which is where you often end up, it draws with the CPU and stays smooth.
