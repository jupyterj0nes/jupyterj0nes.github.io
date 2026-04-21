---
layout: post
title: "Archived EVTX: why your masstin timeline was empty and how Provider.Name dispatch fixes it"
date: 2026-04-21 07:00:00 +0100
category: tools
lang: en
ref: tool-masstin-archived-evtx
tags: [masstin, evtx, provider, archived, dfir, parse-windows, tools]
description: "Windows rotates full Security.evtx into Security-YYYY-MM-DD-HH-MM-SS.evtx archives. Renamed EVTX, operator-extracted files, and third-party tooling break masstin's old filename-based dispatcher silently. Here's how masstin now dispatches by Provider.Name from the XML and accepts anything with a known provider — verified end-to-end against the upstream evtx crate's own test fixtures."
comments: true
---

## The silent failure

A colleague pointed me at `I:\forensic\act3\archive\`. Two zip files:

```
Security-2026-04-17-02-09-25.zip
Security-2026-04-17-02-47-33.zip
```

Both ~80 KB, each containing a single EVTX of exactly the same name inside. These are Windows doing its thing: when the Security event log fills up and the channel is configured for *"Archive the log when full, do not overwrite events"*, Windows rotates the active `Security.evtx` into `C:\Windows\System32\winevt\Logs\Archive\Security-<YYYY-MM-DD-HH-MM-SS>.evtx` and opens a fresh one. On any busy Domain Controller, Exchange server or terminal farm you will find dozens of these — they are the difference between a 2-hour forensic window and two months of history.

Point masstin at them:

```bash
masstin -a parse-windows -d I:/forensic/act3/archive/ -o timeline.csv
```

Output:

```
  [1/3] Searching for artifacts...
        2 EVTX artifacts found inside 2 of 2 compressed archives
        => 2 EVTX artifacts found total

  [2/3] Processing artifacts...

  [3/3] Generating output...

  ──────────────────────────────────────────────────
  Artifacts parsed: 0
  Skipped: 2 (no relevant events found in file)
  Events collected: 0
```

Zero events. No warnings about corrupt files, no error exit code — just silent discard with the unhelpful phrase *"no relevant events found in file"*.

This post is the story of that bug, why it had been there for a while, how I caught it on a real case, and the one-line fix that rescued the timeline.

---

## Where the events went

Masstin's EVTX parser did two things on every file it found:

1. **Walker**: recurse every directory, open every `.zip`, list every `.evtx` inside. Works transparently with nested ZIPs (triage packages, collector output, whatever). This part was fine — the `2 EVTX artifacts found` line is the walker reporting success.
2. **Dispatcher**: look at the filename, route to the right parser based on an exact string match.

The dispatcher looked like this:

```rust
match file_name.as_str() {
    "Security.evtx" => parse_security_log(...),
    "Microsoft-Windows-SMBServer%4Security.evtx" => parse_smb_server(...),
    "Microsoft-Windows-SmbClient%4Security.evtx" => parse_smb_client(...),
    "Microsoft-Windows-TerminalServices-RDPClient%4Operational.evtx" => parse_rdp_client(...),
    // ... ~10 more canonical names ...
    _ => Vec::new(),    // ← everything else silently discarded
}
```

`Security-2026-04-17-02-09-25.evtx` is not `Security.evtx`. The match falls through to the `_` arm, returns an empty vector, the file is marked as *"no relevant events found"* and skipped. Same story for any EVTX an operator renamed for any reason: timestamped copies, `hostname_Security.evtx`, `Security_DC01_2025-01-15.evtx`, extracts from third-party tooling that adds a prefix or a suffix.

The tests masstin had internally used canonical names, so nothing caught this. The first time I noticed was the case above — a real production incident where a rotation had happened hours before the memory capture, and the only record of the attacker's initial 4624 was inside one of those archive files.

---

## The fix: dispatch by Provider.Name, not by filename

An EVTX file is not just a blob. The first meaningful record of every file carries a complete XML `System` block with provider metadata:

```xml
<System>
  <Provider Name="Microsoft-Windows-Security-Auditing" Guid="..."/>
  <EventID>4624</EventID>
  <Computer>DC01.example.corp</Computer>
  ...
</System>
```

The `Provider.Name` field is **canonical and immutable**. Microsoft generates it from the channel's own manifest. A `Security-2026-04-17-02-09-25.evtx` archived by the retention policy still carries `Microsoft-Windows-Security-Auditing` inside. An operator who renames the file to `Customer-ABC_Security.evtx` cannot change it. Extracted by Velociraptor, KAPE, or a forensic triage script — still the same provider.

So the dispatcher stops caring about the filename. It reads the second record, extracts `Provider.Name`, and routes accordingly:

```rust
match provider.as_str() {
    "Microsoft-Windows-Security-Auditing"      => parse_security_log(...),
    "Microsoft-Windows-SMBServer"              => parse_smb_server(...),
    "Microsoft-Windows-SMBClient"              => parse_smb_client(...),
    "Microsoft-Windows-TerminalServices-ClientActiveXCore" => parse_rdp_client(...),
    "Microsoft-Windows-RemoteDesktopServices-RdpCoreTS"    => parse_rdpkore(...),
    "Microsoft-Windows-WinRM"                  => parse_winrm(...),
    "Microsoft-Windows-WMI-Activity"           => parse_wmi(...),
    // ...
    _ => Vec::new(),    // genuine unknown provider, we have no parser
}
```

The `parse_unknown()` function had actually existed in the codebase for a while, gated behind a `MASSIVE_MODE` atomic so only `parse-massive` used it. The reasoning was caution: keep `parse-windows` strict and predictable, let the aggressive fallback live behind the *"off-the-leash"* flag. In practice that meant `parse-windows` silently dropped archived logs while `parse-massive` picked them up — a distinction no user could reasonably be expected to guess without reading the source.

Re-running the same case now, unchanged command:

```bash
masstin -a parse-windows -d I:/forensic/act3/archive/ -o timeline.csv
```

```
  [1/3] Searching for artifacts...
        2 EVTX artifacts found inside 2 of 2 compressed archives
        => 2 EVTX artifacts found total

  [2/3] Processing artifacts...

  [+] Lateral movement events grouped by source (2 sources):
        => [ARCHIVE]  archive/Security-2026-04-17-02-09-25.zip  (76 events total)
        => [ARCHIVE]  archive/Security-2026-04-17-02-47-33.zip  (169 events total)

  [3/3] Generating output...
  Artifacts parsed: 2
  Events collected: 245
```

Same bytes on disk, same command, 245 events recovered instead of 0.

---

## How much does this actually matter? Let's test against upstream

The best-case validation for a parser is running it against the test fixtures the *underlying parser's own authors* use. Masstin depends on the `evtx` crate by [omerbenamram](https://github.com/omerbenamram/evtx), and that crate ships a `samples/` directory with real and intentionally malformed EVTX files for its own test suite. Many of them have non-canonical names — `security_big_sample.evtx`, `2-system-Security-dirty.evtx`, `post-Security.evtx`, `Security_short_selected.evtx`, `Security_with_size_t.evtx`, `security_bad_string_cache.evtx` and so on. Exactly the class of filenames the old dispatcher would drop.

A quick test on the public release binary `masstin-v0.14.0-macos` (pre-fix) and on a build of `main` after the fix, both pointed at the exact same directory of `omerbenamram/evtx` samples:

| Build | Artifacts parsed | Events collected | CSV size |
|-------|-----------------:|-----------------:|---------:|
| v0.14.0 release (filename-strict) | 0 | **0** | 180 B (header only) |
| main after fix (Provider.Name) | 9 | **11,819** | 2.3 MB |

The release binary silently discards every one of those fixtures. The new binary parses nine of them (the ones with providers masstin knows — the remaining eighteen are genuine non-LM logs: CAPI2, HelloForBusiness, Shell-Core, etc. where the dispatcher correctly returns an empty vec).

Note the dirty/broken fixtures — `2-system-Security-dirty.evtx` (intentional chunk corruption), `security_bad_string_cache.evtx` (intentional broken string cache), `sample-with-irregular-bool-values.evtx` (intentional bad bool encoding): the Provider.Name dispatcher extracts events from them cleanly, because the same hardening that protects carve-image from malformed chunks protects this path too.

---

## What gets parsed, what doesn't

The dispatcher now accepts any EVTX whose `Provider.Name` matches one of the channels masstin knows:

| Provider.Name | Parser | Typical channel / filename |
|---------------|--------|----------------------------|
| `Microsoft-Windows-Security-Auditing` | `parse_security_log` | `Security.evtx`, `Security-<ts>.evtx` (archived) |
| `Microsoft-Windows-SMBServer` | `parse_smb_server` | `Microsoft-Windows-SMBServer%4Security.evtx` |
| `Microsoft-Windows-SMBClient` | `parse_smb_client` | `Microsoft-Windows-SmbClient%4Security.evtx` |
| `Microsoft-Windows-TerminalServices-ClientActiveXCore` | `parse_rdp_client` | `...TerminalServices-RDPClient%4Operational.evtx` |
| `Microsoft-Windows-TerminalServices-RemoteConnectionManager` | `parse_rdp_connmanager` | `...RemoteConnectionManager%4Operational.evtx` |
| `Microsoft-Windows-TerminalServices-LocalSessionManager` | `parse_rdp_localsession` | `...LocalSessionManager%4Operational.evtx` |
| `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS` | `parse_rdpkore` | `...RdpCoreTS%4Operational.evtx` |
| `Microsoft-Windows-WinRM` | `parse_winrm` | `Microsoft-Windows-WinRM%4Operational.evtx` |
| `Microsoft-Windows-WMI-Activity` | `parse_wmi` | `Microsoft-Windows-WMI-Activity%4Operational.evtx` |

EVTX whose provider is none of the above — `Application.evtx`, `System.evtx`, Sysmon, every third-party ETW channel — still returns an empty vec. Those are genuinely out of scope for a lateral movement tracker; their providers just don't match.

This means:

- **Archived logs** (`Security-<YYYY-MM-DD-HH-MM-SS>.evtx` in `winevt/Logs/Archive/`) → parse correctly.
- **Operator-renamed copies** (`Security_DC01_2025-01-15.evtx`, `Customer-ABC_Security.evtx`) → parse correctly.
- **Third-party extraction output** (Velociraptor re-zipped dumps, KAPE `hostname_Security.evtx` per-machine layouts, custom triage collectors) → parse correctly.
- **Sysmon and other non-LM providers** → still skipped (not masstin's job).

---

## When to worry about the extra work

The fallback is **cheap**: it reads the second record of each unknown-name file to learn the provider, then routes. If the provider is unknown too, the file is skipped immediately without parsing the rest of the records. For a massive directory tree full of unrelated EVTX (an Application.evtx per machine, for example), the overhead is in microseconds per file.

If you specifically want the old strict behavior — for speed on a huge tree where you already know the canonical files are in a specific place — point `-d` straight at `winevt/Logs`. The walker only opens files with `.evtx` or `.zip` extensions to begin with, so a targeted path makes the whole pipeline proportional to the target's size.

```bash
# Scope to the canonical folder only, equivalent to the old strict behavior
masstin -a parse-windows -d /evidence/C/Windows/System32/winevt/Logs -o timeline.csv

# Include archived logs as well
masstin -a parse-windows -d /evidence/C/Windows/System32/winevt/Logs \
                          -d /evidence/C/Windows/System32/winevt/Logs/Archive \
                          -o timeline.csv
```

---

## Practical takeaways

1. If you ever pointed masstin at a rotated-log archive, a KAPE extract per hostname, or a Velociraptor offline collector dump and saw `Events collected: 0` — that was this bug, not an empty timeline.
2. The fix is in `main` (commit [`9419c95`](https://github.com/jupyterj0nes/masstin/commit/9419c95)) and will be in the next release. The commit is a one-liner: remove the `MASSIVE_MODE` gate, call `parse_unknown` unconditionally.
3. The three actions now share the same EVTX dispatch and differ only in **what they feed into it**:
   - `parse-windows` → files and directories (+ recursive zips).
   - `parse-image` → forensic disk images, extracting from NTFS `winevt/Logs` + VSS.
   - `parse-massive` → everything above, plus triage detection, plus loose-artifact promotion.
4. The canonical test for any EVTX parser's robustness is a run against `github.com/omerbenamram/evtx/samples/`. Worth keeping in your pocket.

If you're investigating a case right now and masstin seemed to see nothing, re-run against `main` — the bytes on disk are the same, the timeline probably isn't.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| EVTX carving from unallocated | [carve-image](/en/tools/evtx-carving-unallocated/) |
| CSV format and event classification | [CSV format](/en/tools/masstin-csv-format/) |
| Security.evtx artifacts | [Security.evtx](/en/artifacts/security-evtx-lateral-movement/) |
| Triage detection | [triage detection](/en/tools/masstin-triage-detection/) |
