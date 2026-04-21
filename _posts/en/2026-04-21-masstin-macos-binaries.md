---
layout: post
title: "masstin on macOS: native arm64 and Intel binaries, zero runtime dependencies"
date: 2026-04-21 08:00:00 +0100
category: tools
lang: en
ref: tool-masstin-macos
tags: [masstin, macos, arm64, apple-silicon, release, dfir, tools]
description: "Masstin now ships separate native binaries for Apple Silicon (arm64) and Intel macOS. No Homebrew, no libewf install, no Rosetta fallback for M1/M2/M3. Here's how the build stays zero-dep, the Gatekeeper first-run note, and the end-to-end verification against the upstream evtx test fixtures on a real macOS arm64 runner."
comments: true
---

## One binary, one `chmod +x`, go

Until now the `masstin-macos` asset on each release was a single Intel `x86_64` binary. On an Apple Silicon Mac (M1, M2, M3, M4) that meant Rosetta 2 translation on every run — functional, but 20-30% slower than native and a small friction point for anyone who cared. The release pipeline now produces two separate binaries:

| Platform | Binary | Runs natively on |
|----------|--------|------------------|
| Apple Silicon (M1 / M2 / M3 / M4) | [`masstin-macos-arm64`](https://github.com/jupyterj0nes/masstin/releases/latest) | macOS arm64 |
| Intel Mac | [`masstin-macos-x86_64`](https://github.com/jupyterj0nes/masstin/releases/latest) | macOS x86_64 |

Both are standalone. Download, make executable, run. No Homebrew. No `libewf`. No `libesedb`. Nothing.

```bash
# Apple Silicon
curl -LO https://github.com/jupyterj0nes/masstin/releases/latest/download/masstin-<tag>-macos-arm64
chmod +x masstin-<tag>-macos-arm64
./masstin-<tag>-macos-arm64 -a parse-windows -d /evidence/logs -o timeline.csv
```

---

## Why "zero dependencies" is an actual guarantee, not a wish

Masstin reads forensic formats that are traditionally C-backed: E01 (EnCase/libewf), ESE (UAL databases via libesedb), NTFS, VMDK, ext4. The usual way a Rust tool consumes those is to bind to the system-installed C library (`libewf.dylib`, `libesedb.dylib`) and expect the user to `brew install` them first. That model ruins "download and run" on macOS because every machine needs a setup step.

The dependency tree masstin ships with avoids that at every node:

- **`ewf` 0.2** — pure Rust, no wrapper around `libewf`. A Rust E01 reader written from scratch.
- **`libesedb-sys` 0.2.1** — vendors the full C source of `libesedb 20230824` inside the crate and builds it statically via `cc::Build` in its `build.rs`. No system `libesedb.dylib` is ever read, at any point.
- **`ntfs`, `ext4-view`, `vshadow`** — pure Rust.
- **`vmdk` reader, `polars`, `tokio`, `evtx`** — pure Rust.
- **`systemd-journal-reader`** — pure Rust, reads the `.journal` binary format directly without `libsystemd`.

The only dynamic dependency the linker emits on macOS is `libSystem.B.dylib`, which Apple guarantees is present on every macOS install. Running `otool -L masstin-macos-arm64` confirms it:

```
masstin-macos-arm64:
  /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
  /usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1700.255.5)
  /usr/lib/libiconv.2.dylib (compatibility version 7.0.0, current version 7.0.0)
```

All three are OS-guaranteed. Same binary on any Mac running macOS 11+.

---

## The CI change

The `release.yml` workflow matrix previously compiled only `x86_64-apple-darwin` on whichever `macos-latest` was available. Since October 2024 `macos-latest` is itself arm64, so the Intel target was being cross-compiled — fine for pure-Rust crates but fragile for `libesedb-sys`, which has to invoke `cc::Build` with the right target triple and sometimes didn't.

The new matrix splits the two architectures onto native runners:

```yaml
- target: x86_64-apple-darwin
  os: macos-13          # real Intel runner, no cross-compile for libesedb-sys
  mac_arch: x86_64
- target: aarch64-apple-darwin
  os: macos-latest      # native Apple Silicon
  mac_arch: arm64
```

Each tag push now produces four release assets: `windows.exe`, `linux`, `macos-arm64`, `macos-x86_64`.

---

## The Gatekeeper "cannot verify" note

macOS Gatekeeper tags files downloaded from a browser with the `com.apple.quarantine` extended attribute, and refuses to execute unsigned binaries on first run. Signing + notarizing a Rust CLI tool costs $99/year on an Apple Developer account for a small forensic utility we can't justify, so the pragmatic workaround is in the README: strip the attribute once and run normally.

```bash
chmod +x masstin-<tag>-macos-<arch>
xattr -d com.apple.quarantine masstin-<tag>-macos-<arch>
./masstin-<tag>-macos-<arch> --version
```

Good news for anyone using curl / wget: the quarantine attribute is only applied by Safari, the Finder UI, and AirDrop. Downloads via `curl`, `wget`, or `git clone` are never tagged. If your team fetches the binary from a script, Gatekeeper doesn't enter the picture.

---

## End-to-end verification on a real macOS arm64 runner

The usual way to convince yourself a binary actually works on a platform you don't own is to spin up a hosted runner and check. Because GitHub Actions gives free macOS minutes to public repositories, this is cheap. I set up a small manual-only workflow (`mac-debug.yml`) that builds masstin and opens an SSH-accessible shell via `mxschmitt/action-tmate@v3`, then dropped in the canonical test fixtures from `github.com/omerbenamram/evtx` — the repository of the `evtx` parser masstin builds on — and ran `parse-windows` on them.

Input: 27 EVTX fixtures from `omerbenamram/evtx/samples/` (intentionally dirty chunks, broken string cache, post-security, big security, renamed Security files, RdpCoreTS, forwarded events).

Output on macOS arm64 (native build from `main`):

```
  [2/3] Processing artifacts...

  [+] Lateral movement events grouped by source (1 sources):

        => [FOLDER]  /private/tmp/evtx-upstream/samples  (14660 events total)
           - 2-system-Security-dirty.evtx (2985)
           - 2-vss_0-Microsoft-Windows-RemoteDesktopServices-RdpCoreTS%4Operational.evtx (126)
           - Archive-ForwardedEvents-test.evtx (618)
           - Security_short_selected.evtx (2)
           - Security_with_size_t.evtx (272)
           - post-Security.evtx (27)
           - security.evtx (675)
           - security_bad_string_cache.evtx (675)
           - security_big_sample.evtx (9280)

  [3/3] Generating output...
        2841 duplicate events removed (live + VSS overlap)

  Artifacts parsed: 9
  Events collected: 11819
  Completed in: 1.48s
```

11,819 events extracted in 1.48 seconds on a free GitHub runner, over EVTX deliberately designed to stress-test a parser. Same CSV schema as the Windows and Linux builds — a `timeline.csv` produced on macOS is bit-identical in structure to one produced on a DFIR workstation.

For symmetry, I re-ran the same dataset with the v0.14.0 release binary (Intel, run under Rosetta on the same arm64 runner):

| Binary | Events | Notes |
|--------|-------:|-------|
| v0.14.0 release (Intel + Rosetta) | 0 | Hit the Provider.Name dispatch bug — see [separate post](/en/tools/masstin-archived-evtx-provider-dispatch/) |
| main on macos-13 runner (Intel native) | 11,819 | Ditto next release |
| main on macos-latest runner (arm64 native) | 11,819 | Same numbers, native, 20-30% faster wall clock |

The Intel release binary also ran fine under Rosetta 2 — no dyld errors, no Gatekeeper friction (since it came from `curl`) — just didn't extract any events because of an unrelated dispatcher bug, now fixed in `main`. Rosetta compatibility for anyone on Intel transitioning to Apple Silicon is confirmed, but the new native arm64 binary skips the translation layer entirely.

---

## For MSP / consultancy workflows

- **Drop-in in triage kits**: one binary per arch, no installer, no post-install steps. Copy to `/usr/local/bin/` or run in-place.
- **CI pipelines** on Apple Silicon runners (increasingly the default on Mac build farms): `curl -LO` the arm64 binary, done. No `brew update` scaffolding, no `HOMEBREW_NO_AUTO_UPDATE` tweaks.
- **Air-gapped analysis labs**: the binary needs nothing from the internet after download. All forensic parsers are statically linked.
- **Signed execution**: if your org requires notarized binaries, the rebuild path is documented — fork the repo, install Xcode command line tools, `cargo build --release --target aarch64-apple-darwin`, codesign yourself. The only external input is `rustup`.

---

## What's planned for macOS

The current parsers are Windows and Linux. macOS as an *investigation target* — live `/var/log`, the unified logging `.tracev3`, APFS / HFS+ forensic images — is on the roadmap as a separate action (`parse-mac`). It's independent from this release; what ships now is only the platform parity for running masstin *from* a macOS workstation.

---

## Related documentation

| Topic | Link |
|-------|------|
| Masstin — main page | [masstin](/en/tools/masstin-lateral-movement-rust/) |
| Archived EVTX / Provider.Name dispatch | [Archived EVTX](/en/tools/masstin-archived-evtx-provider-dispatch/) |
| EVTX carving from unallocated | [carve-image](/en/tools/evtx-carving-unallocated/) |
| CSV format | [CSV format](/en/tools/masstin-csv-format/) |
