---
layout: post
title: "Masstin triage detection: KAPE, Velociraptor, Cortex XDR — and a per-source breakdown that finally makes sense"
date: 2026-04-16 09:00:00 +0100
category: tools
lang: en
ref: tool-masstin-triage-detection
tags: [masstin, triage, kape, velociraptor, cortex-xdr, dfir, tools]
description: "Masstin v0.12 now detects KAPE, Velociraptor and Cortex XDR triage packages during the directory walk and groups every parsed artifact by its real source — forensic image, triage zip with hostname, plain archive, or full folder path. Console output that finally tells the analyst which events came from which evidence."
comments: true
---

## The problem with leaf-directory grouping

Until now, when masstin finished parsing a folder of evidence, the per-artifact breakdown was grouped by the **immediate parent directory name** of each EVTX file. That sounds reasonable until you realise what happens in real cases.

If you have three KAPE triage zips in `D:\evidence\`, all containing EVTX files inside the same internal subdirectory (`<host>\C\Windows\System32\winevt\Logs\`), masstin would render them all as a single group called `Logs`:

```
[+] Artifacts with lateral movement events:
      => Logs (12,847 events total)
         - Security.evtx (10,234)
         - Microsoft-Windows-WinRM%4Operational.evtx (1,453)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (1,160)
```

Three different hosts, three different triages, all collapsed into "Logs". The analyst has no way to tell which events came from which collection. And it gets worse when you mix triages with forensic images and loose EVTX dumps in the same folder — every source flavour merged into anonymous leaf-directory buckets.

The same was true for the discovery phase: masstin would say `100 compressed packages found` when there were actually 100 EVTX **inside** 2 archives — the count was right but the noun was wrong, and there was no way to know what kind of archives they were.

This post documents the v0.12 fix: triage detection during the directory walk, and per-source grouping in the final breakdown.

## Three triage tools, three signatures

Most DFIR teams converge on a small set of triage collectors. From talking to analysts and looking at real case data, the three that come up over and over are:

- **KAPE** (Kroll Artifact Parser and Extractor) — the de facto standard for Windows targeted-collection
- **Velociraptor Offline Collector** — Velocidex's standalone collector, increasingly common for Linux+Windows mixed environments
- **Cortex XDR Offline Collector** — Palo Alto's collector for endpoints already running the XDR agent

Each one produces ZIP archives with a recognisable internal layout. Detection is just pattern matching against the top-level entry list of a ZIP, and the patterns are stable enough that we can detect each one reliably without false positives.

### Cortex XDR — the easy one

Cortex XDR's offline collector writes a file called `cortex-xdr-payload.log` to its output. This filename is **unique to the XDR collector** — no other DFIR tool uses it, no normal triage process produces it. A single match is conclusive.

```rust
// pseudocode of the actual detector
if entries.iter().any(|n| n.ends_with("cortex-xdr-payload.log")) {
    return Some(TriageType::CortexXdr);
}
```

The Cortex XDR collector also follows a strict filename convention:

```
offline_collector_output_<HOSTNAME>_<YYYY-MM-DD>_<HH-MM-SS>.zip
```

So we extract the hostname from the filename whenever it matches that shape. Example: `offline_collector_output_STFVEEAMPRXY01_2026-03-17_21-18-38.zip` → host `STFVEEAMPRXY01`.

Inside the package, Cortex XDR has a rich module layout: each forensic artifact category is in its own `<name>-parsing/` or `<name>-collection/` folder, and each folder contains a nested `script_output.zip` with the actual evidence. EVTX files end up in `output/event_log-parsing/script_output.zip` inside paths like `entry_159_0/Microsoft-Windows-Windows Firewall With Advanced Security%4FirewallDiagnostics.evtx`. UAL `.mdb` databases end up in `output/user_access_logging_db-collection/script_output.zip`. The XDR collector covers about 70+ artifact modules.

Masstin's existing nested-zip recursion (originally built for compressed triage packages) handles the double-zip layout transparently — once detection identifies the outer package as Cortex XDR, the recursive walker finds the EVTX inside the inner zips and feeds them through the normal pipeline.

### Velociraptor — combination signature

Velociraptor's offline collector doesn't have a single unique marker file, but the **combination** of root files is distinctive enough. An unencrypted Velociraptor collection always has these at the top level of its ZIP:

- `client_info.json`
- `collection_context.json`
- `uploads.json`
- `log.json`
- `requests.json`

The detection rule needs `client_info.json` plus at least one of `collection_context.json` or `uploads.json` — that combination doesn't occur in any other tool's output.

For encrypted collections (Velociraptor wraps the data zip in an outer container with a separate password file), the markers change to `metadata.json` + `data.zip`. The detector handles both variants.

Filename pattern: `Collection-<HOSTNAME>-<YYYY-MM-DD>T<HH_MM_SS>Z.zip`. Hostname extraction takes everything between the literal `Collection-` prefix and the first `-` followed by a digit (the start of the timestamp).

EVTX files inside Velociraptor collections sit in `uploads/auto/C%3A/Windows/System32/winevt/Logs/` (URL-encoded paths because the upload accessor stores them by literal source path). Linux artifacts go in similar `uploads/auto/` paths under the relevant POSIX directories.

### KAPE — heuristic with markers + layout fallback

KAPE is the trickiest of the three because it doesn't enforce any single canonical filename or marker. Operators use it in many different ways. The detector tries two layers:

1. **Direct markers**: presence of `_kape.cli` (the command-line file KAPE writes alongside its output) or `Console/KAPE.log` (the run log). Either is conclusive.
2. **Layout fallback**: if the direct markers aren't present, the detector counts entries matching the typical KAPE layout `<prefix>/C/Windows/System32/winevt/Logs/<name>.evtx`. Five or more matches triggers KAPE detection. This catches the common case where someone runs KAPE with `--zip <hostname>` and the resulting archive has the hostname as the top-level directory.

KAPE's lack of a strict filename pattern also makes hostname extraction unreliable. The detector is **deliberately conservative**: it only returns a hostname when the ZIP filename has a clear `<word>_<digits>...` shape, which is what you get from operators using `KAPE.exe ... --zip <hostname>_<timestamp>`. For ambiguous filenames like `kape-output.zip` the detector simply doesn't report a host — better to omit information than to invent it.

## Per-source grouping in the breakdown

The detection runs once per ZIP at discovery time and the result is stored in a `HashMap<zip_path, TriageInfo>`. Then, when each individual EVTX gets parsed and counted, masstin computes a **source label** for it:

```
[IMAGE]  HRServer_Disk0.e01
[TRIAGE: Cortex XDR]  offline_collector_output_TESTHOST01_2026-04-13_15-30-00.zip  [host: TESTHOST01]
[TRIAGE: Velociraptor]  Collection-WIN-DC01-2026-04-13T15_30_00Z.zip  [host: WIN-DC01]
[TRIAGE: KAPE]  workstation05_20260413.zip  [host: workstation05]
[ARCHIVE]  some-other-archive.zip
[FOLDER]  D:/evidence/loose/extracted_evtx
```

The labels are computed from the `EvtxLocation` enum that masstin already uses to track where each EVTX came from:

- `EvtxLocation::File(path)` where the path contains the `masstin_image_extract/` marker → forensic image extract → `[IMAGE]  <image-filename>`
- `EvtxLocation::File(path)` otherwise → loose file → `[FOLDER]  <full parent directory path>`
- `EvtxLocation::ZipEntry { zip_path, .. }` → look up the outer zip in the triage map → `[TRIAGE: <type>]` if detected, `[ARCHIVE]` otherwise

The phase-2 breakdown then groups by source label and renders each group with its event count plus the per-EVTX list:

```
[+] Lateral movement events grouped by source (4 sources):

      => [IMAGE]  HRServer_Disk0.e01  (45 events total)
         - Security.evtx (32)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (13)

      => [TRIAGE: Cortex XDR]  offline_collector_output_TESTHOST01_...zip  [host: TESTHOST01]  (834 events total)
         - Security.evtx (612)
         - Microsoft-Windows-WinRM%4Operational.evtx (89)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (133)

      => [TRIAGE: Velociraptor]  Collection-WIN-DC01-...zip  [host: WIN-DC01]  (4521 events total)
         - Security.evtx (4380)
         - Microsoft-Windows-WinRM%4Operational.evtx (141)

      => [FOLDER]  D:/evidence/loose/extracted_evtx  (131 events total)
         - Security.evtx (120)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (11)
```

Every event is accounted for. The analyst can read this breakdown and immediately answer questions like *"how many WinRM events came from the DC vs from the Cortex XDR triage?"* without having to grep the CSV.

## Why ASCII tags instead of emoji

I considered using emoji for the source markers (💿 image, 🎯 triage, 📦 archive, 📁 folder) — they look great in modern terminals. But the realistic deployment scenarios for masstin include:

- **Windows Server 2016/2019 conhost** (default font: Consolas, no emoji glyphs) — emoji render as boxes or `?` characters
- **PowerShell 5.1 in conhost legacy** — same problem
- **PowerShell ISE** — broken emoji rendering
- **RDP sessions to old Windows hosts** — depends on remote font
- **SSH from Linux/Mac to Windows servers** — depends on local terminal capability

These are not edge cases. They are the **majority** of real DFIR engagements. An analyst on Windows Server 2019 RDP looking at a masstin run and seeing `□` boxes instead of `💿` is a UX failure.

ASCII tags work everywhere. Combined with the existing colour styling (cyan / yellow / white / dim), the visual differentiation is just as clear as emoji would be:

- `[IMAGE]` in cyan bold
- `[TRIAGE: <type>]` in yellow bold
- `[ARCHIVE]` in white bold
- `[FOLDER]` in dim white

And it stays consistent with the rest of masstin's existing visual style, which has always been ASCII-only with `=>`, `[+]`, `[1/3]`, and the same `style().cyan().bold()` colour helpers.

## Discovery phase improvements

The triage detection isn't the only fix in this commit. Four other console-output bugs from a previous verification report came along for the ride:

### "Compressed packages found" said the wrong thing

The old message was:

```
[1/3] Searching for artifacts...
        100 compressed packages found
        => 102 EVTX artifacts found
```

But there were only **2 archives** — the `100` was the number of EVTX **inside** them. The wording was misleading. Fixed to:

```
[1/3] Searching for artifacts...
        100 EVTX artifacts found inside 2 of 2 compressed archives
        => 102 EVTX artifacts found total
```

The "2 of 2" is also useful — it tells you that all 2 scanned archives contributed at least one EVTX. If one of the archives was a generic ZIP with no EVTX inside (e.g. the case6.zip in the WeAreVicon test set, which contains a forensic image rather than a triage), the message becomes:

```
[1/3] Searching for artifacts...
        100 EVTX artifacts found inside 1 of 2 compressed archives
        => 102 EVTX artifacts found total
```

So the analyst sees that one archive was scanned but contributed nothing — useful for spotting cases where you point masstin at a folder and want to know whether all your archives were processed.

### Silent archives are no longer silent

When a folder contained ZIPs but none of them had EVTX inside (because they were image archives, or password-protected with an unknown password, or empty), the old discovery phase showed nothing about them. The analyst was left wondering whether masstin had even seen the archives.

Now, when archives are present but contributed zero entries, the discovery phase prints:

```
[1/3] Searching for artifacts...
        2 compressed archives scanned, none contained EVTX artifacts
        => 98 EVTX artifacts found total
```

You always know whether masstin opened your archives or not.

### Long path normalization

Windows generates 8.3 short names for any directory whose long name is older than the system, and PowerShell's `tempdir` for the current user often shows up as `C:\Users\C00PR~1.DES\AppData\Local\Temp\` instead of the long form. The `Output:` line in masstin's summary used to print the raw 8.3 short path:

```
Output: C:/Users/C00PR~1.DES/AppData/Local/Temp/test-vicon.csv
```

Fixed to canonicalize the path via `std::fs::canonicalize` and strip Windows' `\\?\` verbatim prefix:

```
Output: C:/Users/c00pr.DESKTOP-VJ4PTJJ/AppData/Local/Temp/test-vicon.csv
```

### Cleaner Skipped wording

The old summary read:

```
Skipped: 100 (no relevant events or access denied)
```

That mixed two very different cases — files masstin successfully parsed but found no lateral-movement events in (normal, expected) and files that failed to open due to permissions or corruption (anomalous, requires attention). Until masstin's parser stack returns a richer error type that distinguishes these, the wording is now just:

```
Skipped: 100 (no relevant events found in file)
```

A full breakdown by cause (no_events / access_denied / parse_error) is on the roadmap for v0.12.1.

## What this means for parse-windows, parse-image, parse-massive and parse-linux

The triage detection and source grouping apply to **every action that walks directories looking for artifacts**:

- **`parse-windows`** — directly. Walks `-d` directories, finds loose EVTX + opens ZIPs, detects triages, groups by source.
- **`parse-image`** — inherits automatically. The action extracts EVTX from forensic images into a temp directory whose path contains the `masstin_image_extract/` marker. The source-label helper recognises this marker and labels every extracted EVTX as `[IMAGE]  <image-filename>`.
- **`parse-massive`** — inherits via parse-image. Mixed evidence folders with images + triages + loose EVTX all get correctly classified.
- **`parse-linux`** — same treatment. The detection helpers are reused via `crate::parse::detect_triage_type()` and the per-source breakdown uses the same `print_artifact_detail_grouped` helper. Linux artifacts inside Velociraptor or Cortex XDR collections (which both support Linux endpoints) are correctly attributed to their source triage.

The source labels are consistent across all actions, so a `parse-massive` run against a folder with one E01 image, two triage zips, and a directory of loose `auth.log` files produces a single coherent breakdown:

```
[+] Lateral movement events grouped by source (4 sources):

      => [IMAGE]  ubuntu-srv01.e01  (245 events total)
         - auth.log (180)
         - secure (45)
         - wtmp (20)

      => [TRIAGE: Velociraptor]  Collection-LINUX-DC01-2026-04-13T15_30_00Z.zip  [host: LINUX-DC01]  (1834 events total)
         - auth.log (1500)
         - audit.log (334)

      => [TRIAGE: Cortex XDR]  offline_collector_output_WIN-DB01_2026-04-13_16-15-22.zip  [host: WIN-DB01]  (612 events total)
         - Security.evtx (480)
         - Microsoft-Windows-WinRM%4Operational.evtx (132)

      => [FOLDER]  D:/evidence/standalone-syslog  (89 events total)
         - auth.log (89)
```

One command, four source classes, every event attributed.

## What's next

A few follow-ups are on the v0.12.1 backlog:

- **Skipped reason breakdown** — separate `no_events` / `access_denied` / `parse_error` counters in the summary line. Requires a small refactor to the `parselog()` return type.
- **Per-phase timing** — for very long runs (100+ images), it's useful to see how much time each of the 3 phases consumed. Cosmetic but valuable when debugging slow runs.
- **More triage tools** — Magnet RAM Capture, CyLR, Belkasoft Triage, IBM IRIS, and other less common collectors. PRs welcome with a real sample ZIP and the marker pattern.
- **Triage-aware Cortex XDR module enumeration** — when a Cortex XDR triage is detected, list which of its ~70 artifact modules are present so the analyst can see at a glance whether the collection was full or partial. Currently the detection just reports the hostname and entry count.

If you want to contribute a new triage detector, the patterns live as `pub(crate)` helpers in `src/parse.rs` (`detect_triage_type` + `extract_triage_hostname`). Adding a new tool is just a new branch in those two functions plus optional documentation in the README.

## Try it

The triage detection and per-source breakdown ship in **masstin v0.12.0**. Pre-built binaries are on the [Releases page](https://github.com/jupyterj0nes/masstin/releases) — no Rust toolchain required. Point masstin at any folder containing a mix of triage zips, forensic images, and loose EVTX, and the new breakdown will tell you exactly which events came from which source.

```bash
# Real-world example: parse a customer's evidence folder
masstin -a parse-massive -d D:/incidents/2026-04-customer-x/evidence/ -o timeline.csv
```

If you spot a triage layout the detector misses, or a hostname pattern that fails to extract correctly, open an issue on the [masstin repo](https://github.com/jupyterj0nes/masstin/issues) with a (sanitised) sample filename — adding new patterns is straightforward and we want the detector to handle the real variety of formats that show up in actual cases.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| README — Triage detection section | [`README.md#triage-detection-and-per-source-breakdown`](https://github.com/jupyterj0nes/masstin#triage-detection-and-per-source-breakdown) |
| Custom parsers post (related v0.12 feature) | [parse-custom + 8 YAML rules](/en/tools/masstin-custom-parsers/) |
| EVTX carving | [evtx-carving-unallocated](/en/tools/evtx-carving-unallocated/) |
| Forensic image parsing + VSS recovery | [masstin-vss-recovery](/en/tools/masstin-vss-recovery/) |
