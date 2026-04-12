---
layout: post
title: "Masstin custom parsers: one YAML file per vendor, one timeline for everything"
date: 2026-04-15 07:00:00 +0100
category: tools
lang: en
ref: tool-masstin-custom-parsers
tags: [masstin, custom-parsers, yaml, vpn, firewall, proxy, dfir, tools]
description: "Masstin's new parse-custom action turns any VPN, firewall or proxy log into entries on the unified lateral movement timeline — just write a YAML rule file. Walkthrough of the schema, the library of pre-built rules, and a fully researched Palo Alto GlobalProtect parser as the first entry."
comments: true
---

## The problem with vendor-specific parsing

Every DFIR case reaches the same friction point. The Windows side is tractable — EVTX, UAL, prefetch, registry, all well-defined formats. The Linux side is a bit messier but still bounded — auth.log, secure, wtmp, audit. And then comes the rest: Palo Alto GlobalProtect, Cisco AnyConnect, Fortinet SSL-VPN, Checkpoint, OpenVPN, Squid, Cloudflare Access, ZScaler, every hardware firewall, every cloud VPN. Each one has its own log format, its own conventions, its own quirks, and writing a dedicated parser per vendor is a losing battle.

Masstin's answer is `parse-custom`: a new action that parses **any text log** using **YAML rule files**. One file per vendor format. A library of pre-built rules that grows over time. Inside each file, a list of sub-parsers handles the different line types the same product emits. The output is the same 14-column CSV timeline masstin uses everywhere else, so a carved EVTX chunk from a desktop, a Linux SSH brute-force, and a GlobalProtect VPN login appear side by side, ready for graph visualisation and temporal path reconstruction.

This post walks through the design, the schema, and the first rule that ships with the library: a fully researched Palo Alto GlobalProtect parser built from the official Palo Alto Networks documentation and validated against real sample log lines.

---

## Design decisions

The schema is intentionally **boring**: flat YAML, four blocks per parser, string substitution for the output mapping. We explicitly avoided:

- **Embedding a scripting language** (Lua, Python). Maximum flexibility, but breaks the premise of "easy for users". If you need code, probably the right move is contributing a native parser to masstin instead.
- **Grok / Logstash patterns.** Elegant but adds a learning curve on top of plain regex. Everyone who's touched a Sigma rule already understands YAML + substrings + regex.
- **A 1:1 column mapping like `column_3 = source_ip`.** Too limited — real logs have 4-6 different line types per product, each with its own shape. We need multiple sub-parsers per file.

What we kept:

- **One file per vendor+format combination.** `palo-alto-globalprotect.yaml` covers the legacy SYSTEM log format. A separate file will cover the PAN-OS 9.1+ dedicated `globalprotect` log type when it ships. Mixing two formats in one file is a trap.
- **First match wins.** Inside a file, parsers are tried in order. The first one that claims a line produces exactly one record and moves on. Cheap, predictable, easy to reason about.
- **Rejected lines are first-class citizens.** Any line nothing matches goes to a rejected log. `--dry-run` shows you the first few so you know what your rule is missing. `--debug` preserves a sample alongside the output CSV for post-mortem.
- **Four extractors cover the real world.** CSV for tabular logs (Palo Alto, many cloud exports). Keyvalue for `key=value` logs (Fortinet, CEF-lite formats). Regex for free-form prose (OpenVPN, legacy syslog). JSON is planned for v2.

---

## The schema in one glance

```yaml
meta:
  vendor: "Palo Alto Networks"
  product: "GlobalProtect (VPN)"
  reference_url: "https://docs.paloaltonetworks.com/..."

prefilter:           # optional fast path before per-parser matching
  contains_any: ["globalprotectgateway-", "globalprotectportal-"]

parsers:
  - name: "gp-gateway-auth-succ"
    match:
      contains: ["globalprotectgateway-auth-succ"]
    extract:
      type: csv
      delimiter: ","
      quote: '"'
      fields_by_index:
        6: generated_time
        9: gateway_name
        14: description
    sub_extract:
      field: description
      strip_before: ". "
      type: keyvalue
      pair_separator: ","
      kv_separator: ":"
      trim: true
    map:
      time_created:       "${generated_time}"
      computer:           "${gateway_name}"
      event_type:         "SUCCESSFUL_LOGON"
      event_id:           "GP-GW-AUTH-SUCC"
      subject_user_name:  "${User name}"
      workstation_name:   "${Login from}"
      ip_address:         "${Login from}"
      logon_type:         "VPN"
      filename:           "${__source_file}"
      detail:             "GlobalProtect gateway auth OK | user=${User name} from=${Login from} auth=${Auth type}"
```

Four building blocks per parser:

- **`match`** — which lines this parser claims. Combine `contains`, `contains_any` and `regex`.
- **`extract`** — how to pull fields out of the matched line. Pick one of `csv`, `regex`, `keyvalue`.
- **`sub_extract`** — optional second-pass extraction on a field extracted above. Essential for nested formats like Palo Alto, where the outer shape is CSV but the interesting user/IP data lives inside one of the outer fields as a narrative sentence followed by `Key: value, Key: value`.
- **`map`** — fill the 14 columns of masstin's `LogData` using `${variable}` substitution. Anything unknown becomes empty. Any text can be embedded in any field.

That's it. Everything else (prefilter, strip_before, the special `${__source_file}` / `${__line_number}` variables) is convenience sugar on top of those four blocks.

The full schema reference is in [`docs/custom-parsers.md`](https://github.com/jupyterj0nes/masstin/blob/main/docs/custom-parsers.md) in the repo.

---

## A walk through the Palo Alto GlobalProtect rule

Palo Alto's GlobalProtect VPN is a natural first target: it's widely deployed, the log format is documented, and there are public sample logs I could validate against. There are actually two formats: the **legacy** SYSTEM log (used by most deployments with classic syslog forwarding) and a **new** dedicated `globalprotect` log type introduced in PAN-OS 9.1 with 49+ separate CSV columns. The v1 rule covers the legacy format, because that's what 90% of real deployments still produce. The dedicated log type rule will ship as a separate file when I have confirmed sample lines to test against.

### The legacy format

A GlobalProtect login event in the SYSTEM log looks like this (real sample from the Palo Alto Splunk data generator):

```
1,2016/02/24 21:45:08,007200001165,SYSTEM,globalprotect,0,2016/02/24 21:40:52,,globalprotectgateway-auth-succ,VPN-GW-N,0,0,general,informational,"GlobalProtect gateway user authentication succeeded. Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise",641953,0x8000000000000000,0,0,0,0,,PA-VM
```

The outer shape is CSV with field 14 double-quoted. The index-to-field mapping, from the official syslog field description page:

| Index | Field |
|---|---|
| 0 | FUTURE_USE (usually "1") |
| 1 | Receive Time |
| 2 | Serial Number |
| 3 | Type (`SYSTEM`) |
| 4 | Subtype (`globalprotect`) |
| 6 | Generated Time (canonical timestamp) |
| 8 | Event ID (`globalprotectgateway-auth-succ`, `-auth-fail`, `-logout-succ`, `-regist-succ`, `portal-auth-*`) |
| 9 | Object name (gateway or portal) |
| 14 | Description (quoted, contains user/IP data as inner key-value) |

Notice field 14. It's a CSV field in its own right, but the user, IP, auth type and OS live **inside it**, as an English sentence followed by `Key: value, Key: value`:

```
GlobalProtect gateway user authentication succeeded. Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise
```

This is exactly the kind of nested format `sub_extract` was designed for.

### Handling the nested description

First we run a CSV extract that pulls the description out as a single string. Then we run a keyvalue sub-extract on that string — but not before **stripping the leading prose**. Without the strip, the keyvalue splitter would see the first comma and treat the entire sentence up to that comma as one giant "key":

```
KEY: "GlobalProtect gateway user authentication succeeded. Login from"
VAL: "216.113.183.230"
```

...and `${Login from}` substitution would silently return nothing.

The fix is `strip_before: ". "` — drop everything up to and including the first ". " in the field. After stripping, the keyvalue input is clean:

```
Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise
```

and the keyvalue extractor produces `Login from`, `User name`, `Auth type`, `Client OS version` as context variables, ready for `${Login from}` and friends in the map.

### The five sub-parsers

The v1 rule has five parsers covering the events relevant to lateral movement tracking:

1. `gp-gateway-auth-succ` — successful gateway authentication → `SUCCESSFUL_LOGON`
2. `gp-gateway-regist-succ` — session fully established → `SUCCESSFUL_LOGON` (a variant flagged with its own `event_id`)
3. `gp-auth-fail` — gateway or portal authentication failure → `FAILED_LOGON`
4. `gp-gateway-logout` — gateway logout → `LOGOFF`
5. `gp-portal-auth-succ` — portal auth OK (pre-gateway, informational) → `SUCCESSFUL_LOGON` with `event_id=GP-PORTAL-AUTH-SUCC`

Events that are NOT logons (configuration push, agent messages, config release) intentionally fall through to the rejected log. Masstin is a lateral movement tracker, not a generic log aggregator.

### Validation against real samples

The rule was validated with `--dry-run` against 7 sample lines taken verbatim from the [Palo Alto Splunk data generator](https://github.com/PaloAltoNetworks/Splunk-App-Data-Generator/blob/master/bin/data/pan_globalprotect.txt) — 4 matched (the logon events), 3 were correctly rejected (config push / agent message / config release):

```
[2/3] Processing 1 log file(s)...
    lines=7 matched=4 rejected=3

Custom parser summary:
  Lines read:    7
  Matched:       4 (57.1%)
  Rejected:      3
  Hits per parser:
         1 gp-gateway-regist-succ
         1 gp-gateway-logout
         1 gp-gateway-auth-succ
         1 gp-auth-fail

First matched records:
  2016/02/24 22:01:41 | LOGOFF            | user=user3         | src=              | dst=VPN-GW-N    | detail=GlobalProtect gateway logout | user=user3 reason=client logout.
  2016/02/24 21:40:52 | SUCCESSFUL_LOGON  | user=user3         | src=216.113.183.230 | dst=VPN-GW-N  | detail=GlobalProtect gateway auth OK | user=user3 from=216.113.183.230 auth=profile
  2016/02/24 21:40:28 | FAILED_LOGON      | user=Administrator | src=60.28.233.48  | dst=GP-Portal-1 | detail=GlobalProtect auth FAIL | user=Administrator from=60.28.233.48 reason=Authentication failed: Invalid username or password
  2016/02/24 22:41:24 | SUCCESSFUL_LOGON  | user=user1         | src=64.147.162.160 | dst=VPN-GW-N  | detail=GlobalProtect gateway register (session up) | user=user1 from=64.147.162.160 os=Microsoft Windows Server 2008 R2 Enterprise Edition Service Pack 1
```

Source IP, username, authentication type, OS version — all populated correctly for every logon event. The four matched records land in the same 14-column CSV and are ready for `load-memgraph` or `load-neo4j` like any other masstin source.

---

## The rule library

The initial rule library ships with **8 complete rules and 31 sub-parsers** covering the most common VPN, firewall and proxy products. Every rule was researched against the vendor's official log format documentation and validated against realistic sample log lines committed alongside each rule in `<category>/samples/`.

| Category | Rule | Parsers | Format |
|---|---|---|---|
| VPN | [`vpn/palo-alto-globalprotect.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/palo-alto-globalprotect.yaml) | 5 | SYSTEM log subtype=globalprotect (legacy CSV syslog) |
| VPN | [`vpn/cisco-anyconnect.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/cisco-anyconnect.yaml) | 4 | `%ASA-6-113039` / `722022` / `722023` / `%ASA-4-113019` |
| VPN | [`vpn/fortinet-ssl-vpn.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/fortinet-ssl-vpn.yaml) | 3 | `type=event subtype=vpn action=tunnel-up/down/ssl-login-fail` |
| VPN | [`vpn/openvpn.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/openvpn.yaml) | 4 | Free-form syslog (`Peer Connection Initiated`, `AUTH_FAILED`, `SIGTERM`) |
| Firewall | [`firewall/palo-alto-traffic.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/palo-alto-traffic.yaml) | 2 | PAN-OS TRAFFIC CSV — authenticated sessions via User-ID |
| Firewall | [`firewall/cisco-asa.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/cisco-asa.yaml) | 6 | AAA auth (`113004/5`), login permit/deny (`605004/5`), WebVPN (`716001/2`) |
| Firewall | [`firewall/fortinet-fortigate.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/fortinet-fortigate.yaml) | 4 | `type=event subtype=system\|user` admin login, user auth |
| Proxy | [`proxy/squid.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/proxy/squid.yaml) | 3 | `access.log` native — CONNECT tunnel, HTTP, TCP_DENIED |

Running the entire library against all sample files in one shot produces:

```
Loaded 8 rule file(s), 31 parsers total
Lines read:    46
Matched:       38 (82.6%)
Rejected:      8   ← all intentionally rejected (config-release, TLS handshake packets,
                     system health logs, unauthenticated DNS, anonymous proxy requests)
```

A few design highlights from the stub-to-rule process:

- **Cisco split into two files** — `cisco-anyconnect.yaml` covers the VPN session lifecycle (parent session start, SVC connect/disconnect, session disconnect with duration). `cisco-asa.yaml` covers the generic firewall path: AAA authentication, management login permit/deny, WebVPN portal session. Same syslog stream, different purpose.
- **Palo Alto TRAFFIC filters on User-ID** — TRAFFIC logs are extremely high-volume, but the lateral movement signal is only in sessions where the firewall could resolve a domain user via User-ID. The rule uses a positional regex (`[^,]+` at comma index 12) to require a non-empty `srcuser` before the parser even touches the line, so raw internet traffic and DNS/NTP sessions are dropped cheaply at the match stage.
- **Squid uses positive-match regexes instead of negative look-ahead** — Rust's `regex` crate is linear-time and doesn't support `(?!...)`, so instead of "user is not `-`", the rules say "user starts with an alphanumeric character" (`[A-Za-z0-9][^\s]*`) — functionally equivalent for the real log format.
- **FortiGate admin events don't have `action=login`** — they have `logdesc="Admin login successful"`. Discovered during validation: the first version of the rule matched zero lines because it assumed a naming convention that only holds for the VPN subtype. The fix highlights the value of the dry-run validation loop.

The contribution model is the same as Sigma rules: collect sample lines, write the YAML, validate with `--dry-run`, open a PR adding a new file plus a row in the references table. Full guide in [`rules/README.md`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md).

---

## Using it

```bash
# Single rule file
masstin -a parse-custom --rules rules/vpn/palo-alto-globalprotect.yaml -f vpn.log -o timeline.csv

# Whole library — all rules tried against all log files
masstin -a parse-custom --rules rules/ -f vpn.log -f fw.log -o timeline.csv

# Dry-run: show first matches + rejected samples, no CSV
masstin -a parse-custom --rules rules/vpn/palo-alto-globalprotect.yaml -f vpn.log --dry-run

# Debug: preserve a rejected-lines sample alongside the output
masstin -a parse-custom --rules rules/ -f vpn.log -o timeline.csv --debug
```

Point it at any masstin-compatible output (Neo4j, Memgraph, the CSV merge pipeline) and your VPN events now flow through the same graph as your Windows RDP, Linux SSH and carved EVTX data.

---

## What's next

- **v2 extractors.** JSON with jq-style selectors. Already planned.
- **Conditional map.** `when: ${action} == "fail"` style predicates so a single parser can handle both success and failure line variants of the same event when the format makes that cleaner than two parsers.
- **More rules.** Cisco ASA AnyConnect, Fortinet FortiGate, OpenVPN and Squid are the next priorities. Checkpoint, ZScaler, Cloudflare Access are in the backlog.
- **PAN-OS 9.1+ dedicated `globalprotect` log type.** A second Palo Alto rule covering the 49+ column dedicated format, once I can validate it against real samples.
- **Per-rule validation command.** `masstin -a parse-custom --validate rule.yaml` to catch schema errors without running against a log file.

If you'd like to contribute a rule or a sample of your vendor's logs, see the guide at [`rules/README.md`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md) in the masstin repo.

---

## References — vendor official documentation used per rule

Every rule in the library was written from the vendor's primary log format documentation and validated against real sample log lines. These are the sources used during the research pass:

### Palo Alto GlobalProtect (`vpn/palo-alto-globalprotect.yaml`)

- [GlobalProtect Log Fields (Palo Alto Networks official)](https://docs.paloaltonetworks.com/ngfw/administration/monitoring/use-syslog-for-monitoring/syslog-field-descriptions/globalprotect-log-fields)
- [Event Descriptions for the GlobalProtect Logs in PAN-OS](https://docs.paloaltonetworks.com/globalprotect/10-1/globalprotect-admin/logging-for-globalprotect-in-pan-os/event-descriptions-for-the-globalprotect-logs-in-pan-os)
- [Sample log lines — Palo Alto Splunk App Data Generator](https://github.com/PaloAltoNetworks/Splunk-App-Data-Generator/blob/master/bin/data/pan_globalprotect.txt) (used verbatim for validation)

### Palo Alto TRAFFIC (`firewall/palo-alto-traffic.yaml`)

- [Traffic Log Fields — PAN-OS 11.0 (Palo Alto Networks official)](https://docs.paloaltonetworks.com/pan-os/11-0/pan-os-admin/monitoring/use-syslog-for-monitoring/syslog-field-descriptions/traffic-log-fields)
- [Syslog Field Descriptions index](https://docs.paloaltonetworks.com/ngfw/administration/monitoring/use-syslog-for-monitoring/syslog-field-descriptions)

### Cisco AnyConnect (`vpn/cisco-anyconnect.yaml`)

- [Cisco Secure Firewall ASA Series Syslog Messages (official, all versions)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog.html)
- [ASA Event 113039 — AnyConnect Parent Session Started (ManageEngine reference)](https://www.manageengine.com/products/eventlog/cisco-asa-events-auditing/cisco-anyconnect-parent-session-started-113039.html)

### Cisco ASA (`firewall/cisco-asa.yaml`)

- [ASA Syslog Messages 101001–199021 (official)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog/syslogs1.html)
- [ASA Syslog Messages 715001–721019 (WebVPN events)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/asa-syslog/syslog-messages-715001-to-721019.html)
- [Messages by Severity Level](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog/syslogs-sev-level.html)

### Fortinet SSL VPN (`vpn/fortinet-ssl-vpn.yaml`)

- [FortiOS Log Message Reference (Fortinet official, latest)](https://docs.fortinet.com/document/fortigate/latest/fortios-log-message-reference)
- [Understanding VPN-related logs — FortiGate cookbook](https://docs.fortinet.com/document/fortigate/6.2.0/cookbook/834425/understanding-vpn-related-logs)
- [`LOG_ID_EVENT_SSL_VPN_USER_SSL_LOGIN_FAIL` (39426)](https://docs.fortinet.com/document/fortigate/7.6.6/fortios-log-message-reference/39426/39426-log-id-event-ssl-vpn-user-ssl-login-fail)

### Fortinet FortiGate (`firewall/fortinet-fortigate.yaml`)

- [FortiOS Log Message Reference (Fortinet official, latest)](https://docs.fortinet.com/document/fortigate/latest/fortios-log-message-reference)

### OpenVPN (`vpn/openvpn.yaml`)

- [OpenVPN 2.6 Reference Manual](https://openvpn.net/community-resources/reference-manual-for-openvpn-2-6/)
- [OpenVPN Access Server logging documentation](https://openvpn.net/as-docs/logging.html)

### Squid proxy (`proxy/squid.yaml`)

- [Squid wiki — LogFormat feature reference](https://wiki.squid-cache.org/Features/LogFormat)
- [Squid FAQ — Log Files](https://wiki.squid-cache.org/SquidFaq/SquidLogs)
- [`logformat` configuration directive](https://www.squid-cache.org/Doc/config/logformat/)

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Custom parser schema | [`docs/custom-parsers.md`](https://github.com/jupyterj0nes/masstin/blob/main/docs/custom-parsers.md) |
| Rules library | [`rules/`](https://github.com/jupyterj0nes/masstin/tree/main/rules) |
| Rules library references table | [`rules/README.md#references`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md#references) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Graph visualisation | [Memgraph](/en/tools/memgraph-visualization/) / [Neo4j](/en/tools/neo4j-cypher-visualization/) |
