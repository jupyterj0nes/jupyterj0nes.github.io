---
layout: post
title: "AD DFIR Lab — Part 8: A Day in the Realm — Generating Two Years of Historical Noise"
date: 2026-04-13 18:30:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part8
tags: [dfir, lab, active-directory, forensics, python, proxmox]
description: "Two years of synthetic corporate activity on top of a clean AD, using backward clock travel, a day-as-iteration planner, Spanish calendar profiles with vacations and narrative events, three brutal gotchas (wlms.exe shutdown, Linux hwclock drift, night-shift personas invisible), and a final regeneration covering 7 VMs across 3 domains."
comments: true
---

*This is Part 8 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We turn a sterile `clean-ad` snapshot into `noisy-ad-2years` — a dataset that looks like a real company has been using the domain for two years.*

## Why this is the hard part

A DFIR lab with only attacks and no baseline noise is a teaching toy, not a training environment. Real investigations are 95% normal user activity and 5% attack signal hidden inside it. The hunting skill is *seeing the signal through the noise*. If the only events on a DC are from the four domain admins that the lab author seeded and the one Kerberoast test they ran, everything stands out. Everything looks suspicious because nothing else is happening.

So Phase 10 exists to generate **two years of simulated corporate history** across the entire forest — DC logons from fifty users with realistic schedules, file creations on file shares, browser history, MSSQL sessions, scheduled tasks, prefetch, user shellbags, everything that a two-year-old domain should have. The end state: a `noisy-ad-2years` snapshot that sits alongside `clean-ad`.

The two snapshots serve different purposes:

- **`clean-ad`** → learn what each TTP looks like in isolation. Zero distraction, deterministic.
- **`noisy-ad-2years`** → realistic threat hunting. The same Kerberoast, but now hidden among 700+ days of legitimate 4769 events from dozens of users.

## The shape of the problem

Some constraints that drove the design:

- **Two years must look like two years, not like 730 copies of the same day.** Weekends, holidays, puentes, August vacation, Christmas week, quarter-end, new hires, people leaving, maternity leave, schedule changes from promotions — all of it visible in the resulting EVTX.
- **Idempotent and resumable.** The run takes many hours and will fail. Kerberos will timeout. Guest agents will hang. The host will hiccup. Every stage has to be crash-safe and every re-run has to pick up exactly where it left off.
- **No impact on eval licenses.** The lab runs on Windows evaluation ISOs. A 10-hour run that burns 10 hours of eval time is a disaster. Clock travel gets us this for free *in theory*.
- **Per-VM coherence.** When the simulation says "it's 2024-10-15 09:23" for round N, all VMs must agree on that clock, otherwise Kerberos tickets from the future will invalidate everything.

## Day as the unit, not "iterations"

My first sketch was a `step_days = 4` plan: 182 iterations, each one setting the clock to a fake date 4 days ahead of the previous one. Cheaper, yes, but painfully obvious to a forensic analyst:

```
Sysmon events by day:
2024-04-13 → 47
2024-04-17 → 52
2024-04-21 → 49
2024-04-25 → 51
(nothing in between)
```

The moment anyone does `Group-Object { $_.TimeCreated.Date }`, the periodic pattern screams "synthetic". Real companies don't burst work in 30-second chunks every four days.

So I threw that out and rebuilt the model around **one iteration per calendar day**. 729 days from 2024-04-13 to 2026-04-12, every single one executed, each with a *profile* derived from the calendar:

```yaml
workday_high:     4 rounds, 100% intensity    # quarter-end, deadlines
workday_normal:   3 rounds,  70% intensity    # regular Mon-Fri
workday_low:      2 rounds,  40% intensity    # Friday afternoon, puentes
weekend:          1 round,   10% intensity    # nightly backup + on-call
holiday:          1 round,    5% intensity    # automated jobs only
summer_reduced:   2 rounds,  25% intensity    # all of August
winter_holidays:  1 round,   10% intensity    # Dec 22 → Jan 2
```

Each round picks a random jittered timestamp within a target hour range, with ±45 minutes of noise, so two consecutive workday_normal days never land at the same clock. Inside a round, activity runs for 30-60 real seconds while the clock advances organically from the round's start time — so a burst of events gets timestamps T, T+1s, T+3s, T+42s that look like a real user session rather than everything fired at exactly the same second.

Crucially, **vacations are presence, not absence**. Christmas Day is not skipped — it fires a round at 04:11 UTC with a single automated backup job participant, producing one event in the EVTX. The forensic analyst scrolls through the timeline and sees a valley on Dec 25, not a gap. A gap is a red flag; a valley is realistic.

Same for individual personas. Catelyn Stark (the HR user) has maternity leave from 2025-04-20 to 2025-10-15 in her persona YAML. During that six-month window, her `active_on(date)` returns False and the planner emits zero participants with her name on any VM. Her last logon event is visible in the DC Security log. Her return shows up six months later. The analyst running `last-login-per-user.ps1` sees the exact story.

## The Spanish calendar

Because the narrative is "a Spanish company", the holiday set is nacionales España:

```yaml
- 2024-05-01 Día del Trabajador
- 2024-08-15 Asunción
- 2024-10-12 Fiesta Nacional
- 2024-11-01 Todos los Santos
- 2024-12-06 Constitución
- 2024-12-08 Inmaculada
- 2024-12-25 Navidad
- 2025-01-01 Año Nuevo
- 2025-01-06 Reyes
- 2025-04-18 Viernes Santo
... etc
```

Plus two seasonal blocks (all of August reduced; Dec 22 → Jan 2 reduced), plus an auto-detection of "puentes" — Mondays preceded by a holiday weekend, Fridays followed by one. A day that's a puente gets degraded to `workday_low` with 40% intensity.

The resulting histogram for a two-year run:

```
workday_normal       432
weekend              181
summer_reduced        60
holiday               20
winter_holidays       20
workday_low           11
workday_high           6
```

## Personas with narrative

The validation roster is six users (the full 46-user GOAD set gets plugged in after the mechanics are proven). Each persona has a base schedule, optional vacations, optional schedule changes on a specific date, and start/end employment dates:

```yaml
- id: jon.snow
  role: SysAdmin
  workstation: 106
  schedule: {start: 9, end: 18}
  workdays: [mon, tue, wed, thu, fri]
  vacations:
    - {start: "2024-08-05", end: "2024-08-23"}     # summer off
    - {start: "2025-12-22", end: "2026-01-05"}     # christmas off

- id: samwell.tarly
  role: Developer
  linux_host: 107
  active_from: "2024-09-01"                         # hired mid-window
  ...

- id: stannis.baratheon
  role: Compliance
  active_to: "2025-09-15"                           # left the company

- id: catelyn.stark
  role: HR
  vacations:
    - {start: "2025-04-20", end: "2025-10-15"}      # maternity leave

- id: arya.stark
  role: Developer
  schedule: {start: 22, end: 26}                    # night shift (22→02)
  schedule_changes:
    - from: "2025-10-16"
      schedule: {start: 10, end: 19}                # promoted → day shift
```

This is the *narrative layer*. Every one of these patterns produces a detectable forensic fingerprint:

- **New hires**: samwell's first 4624 on DC01 is at 2024-09-02 10:14, and nothing of him exists before that. Run a "first seen" query and he shows up in the right month.
- **Departures**: stannis's last Security event is on 2025-09-15 around 17:00. After that date, his user account is still in AD but never authenticates. `(Get-ADUser stannis -Properties LastLogonDate).LastLogonDate` gives you the exact leaving date.
- **Maternity leave**: catelyn generates events from 2024-04-13 to 2025-04-20, then nothing, then events again from 2025-10-15 onwards. Six-month silence.
- **Promotion**: arya generates 22:00-02:00 events on LNX01 from 2024-04 to 2025-10-16, then 10:00-19:00 events after. A single day where her schedule shifts permanently.

## The orchestrator

`phase10.py` runs on the Proxmox host. Every VM is reached via `qm guest exec` (virtio-serial), which is clock-independent — SSH and WinRM would break the moment the clock crosses a certificate validity window, but virtio-serial doesn't care what the wall clock says.

The state model is three levels deep:

```
run
└── days[]                 # 729 entries, one per calendar day
    └── rounds[]           # 1-4 per day, depending on profile
        └── participants[] # (vm, persona) work units
```

Each level has `status ∈ {pending, in_progress, done, failed}`. The checkpoint is a single JSON file that gets rewritten (atomically, via `tmp + os.replace + fsync`) after every transition. A crash leaves the previous valid checkpoint intact. A resume reads the checkpoint, finds the first `!done` day, finds the first `!done` round inside it, and for that round starts at the first `!done` participant — picking up exactly where it died.

The main loop wraps every `qm guest exec` in a retry with exponential backoff. SIGINT and SIGTERM route through a signal handler that calls `emergency_restore()` — re-enabling NTP and forcing a sync on every VM before the process exits. *We never leave VMs stranded in 2024.*

## Parallelism where it matters

First version of the loop iterated VMs sequentially inside each round. For a workday_normal with 3 rounds × 5 participants each, 15 sequential `qm guest exec` calls = ~60 seconds per day. Extrapolated: 729 days × 60s = **12+ hours for the full run**.

The fix: within a round, participants on different VMs are independent (different clocks, different activity payloads, no shared state). Participants on the SAME VM must still run sequentially (shared clock). So the refactor groups pending participants by VM and fans out one worker thread per VM:

```python
with ThreadPoolExecutor(max_workers=len(by_vm)) as executor:
    futures = [executor.submit(_run_vm_in_round, vmid, parts)
               for vmid, parts in by_vm.items()]
    for future in as_completed(futures):
        status, _vm, detail = future.result()
```

Plus a bonus optimization: all participants in a given round on a given VM share the same timestamp, so we only do ONE `disarm + set_clock` per VM per round instead of one per participant. That cut another ~30% off the round time.

Checkpoint writes are wrapped in a `threading.RLock` to keep mutations coherent under concurrent access. The RLock is reentrant because some methods (e.g. `mark_day_failed`) call other locked methods, which would deadlock on a plain Lock.

Final ETA on a fresh run: **~9-10 hours**, not 4-5 as I naively hoped — the floor per round is set by the slowest VM's sequential clock-set work, and that's ~10 seconds no matter how many threads you throw at it. But 10 hours is overnight-territory, and the run is resumable, so a hiccup halfway through is not fatal.

## Telegram alerts — reuse the bot from Part 7.5

Since [Part 7.5]({% post_url en/2026-04-13-ad-dfir-lab-part7-5-licenses %}) already set up a Telegram bot for license maintenance, Phase 10 reuses it. A tiny `lib/notifier.py` reads `/root/lab/config/telegram.conf` and fires messages at:

- run start: "🚀 Phase 10 starting, N days total, resume point..."
- every 25 days done: progress + failure count
- error: "❌ error on day X"
- abort: "🛑 phase 10 aborted, reason..."
- complete: "✅ phase 10 complete, snapshot `noisy-ad-2years` taken"

All calls are non-blocking best-effort — a failed Telegram send logs a warning but never raises. The run must not depend on network connectivity to the outside world. `curl` with a 10-second max timeout, wrapped in a try/except, end of story.

## The validation that blew up — and why

Before committing to 10 hours of generation, I ran 5 validation days to prove the loop works. They came out clean: 5/5 days, 11 rounds, 53 participants, zero failures. [Part 7.5]({% post_url en/2026-04-13-ad-dfir-lab-part7-5-licenses %}) ends saying "the empirical test proved Windows eval is wall-clock based and backward travel never consumes eval time". I launched the full run.

At 3 hours in, I got a Telegram ping showing **361 failures** and current_day = 102. Every round was failing with `wait_agent` timeouts on the same three VMs: DC01 (101), SRV02 (103), WS01 (106). When I SSH'd in and ran `qm status`, those three were `stopped`. The other four (DC02, DC03, SRV03, LNX01) were `running` — the common factor was *those three receive tr traffic every single round* because they host the `system.replication` / `system.backup` personas and all the human workstations.

The three VMs had not been stopped by me, by a `qmstop`, or by a host OOM — `/var/log/pve/tasks` showed no external shutdowns, dmesg was clean. I rebooted them and pulled the System log:

```
TimeCreated  : 5/31/2024 2:18:36 PM          # fake-past timestamp
Id           : 1074
ProviderName : User32
Msg          : wlms.exe has initiated the shutdown of KINGSLANDING
                on behalf of NT AUTHORITY\SYSTEM for the following
                reason: Other (Planned)
                Comment: The license period for this installation
                of Windows has expired. The operating system is
                shutting down.
```

Same message on all three VMs. WS01 died at fake 2024-05-17, DC01 and SRV02 at fake 2024-05-31 — between ~day 30 and ~day 50 of fake clock travel. The three untouched VMs were alive because they had not been sent enough clock manipulations to trigger the threshold.

## What Part 7.5 got wrong — and the real rule

The Part 7.5 empirical test went like this:

```
12:19:00  baseline   → 128506 minutes remaining
12:19:07  qm stop    → vm off for exactly 10 real minutes
12:29:25  qm start   → 128496 minutes remaining   (delta -10 = real-time)
```

I concluded "Windows eval is wall-clock based, ergo backward travel is free". That conclusion is *partially true* — but I only tested the case where the clock moved FORWARD, and tested it on a stopped VM. I never tested the case where I actively set the clock BACKWARD past the install date while the VM was running. That's exactly what Phase 10 does, thousands of times, and the behavior is different.

What's actually happening inside Windows: the **Windows Licensing Monitoring Service** (`wlms.exe`, shipped on all Server 2019/2016 and Win10 Enterprise eval installs) runs a periodic check. When it fires, it computes the eval grace period *based on the current system clock*. Moving the clock forward and back rapidly doesn't crash it — wlms just recomputes on its next tick. But if `current_time < install_date`, the computation is negative, and the service interprets that as "license expired" and calls `InitiateSystemShutdown`.

It doesn't do this instantly. Based on the empirical failure dates — 30 to 50 days of fake-past clock manipulation before the first shutdown — wlms seems to accumulate some internal confidence counter before pulling the trigger. Hence the silent, lagged, per-VM-intensity-dependent failure mode.

Once you see the mechanism, the fix writes itself.

## The fix: disable wlms at the SCM level

`wlms` is a standard Windows service. You can disable it like any other:

```powershell
Stop-Service -Name wlms -Force
Set-Service -Name wlms -StartupType Disabled
```

Once the StartType is `Disabled`, the Windows Service Control Manager **refuses** to start it — from anything. Scheduled tasks, service triggers, dependent services, manual `net start`, nothing. This is not "the service might not run"; it's architecturally locked. No `wlms.exe` process means no `InitiateSystemShutdown` call.

I added this to `lib/clock_control.py`'s `disarm_time_sync()` function — so it runs on EVERY clock set, idempotently. And I took a fresh `pre-noise` snapshot on all six Windows VMs after disabling wlms, so any future `qm rollback pre-noise` keeps the fix.

```
$ qm guest exec 106 -- powershell -Command "(Get-Service wlms).Status"
Stopped

$ qm guest exec 106 -- powershell -Command "(Get-Service wlms).StartType"
Disabled
```

I also disabled `sppsvc` (Software Protection Service) as belt-and-braces, although it was already stopped on our eval installs by default.

## Restart, validation, full run

With wlms killed on all 6 Windows VMs and the `pre-noise` snapshot re-taken, I reset the checkpoint and re-ran the validation: 4 days clean, 0 failures, all VMs alive, wlms still `Stopped` after every round. Then I launched the full run again in tmux:

```bash
tmux new-session -d -s phase10 -c /root/lab/phase10 \
     "python3 phase10.py 2>&1 | tee -a state/phase10-fullrun.log"
```

Monitoring happens via the Telegram bot and an occasional `phase10.py --status`. The run is independent of my SSH session or Claude or anything else — tmux owns it, systemd will keep it running through logouts, and the checkpoint + signal handler means the worst any interruption can do is leave the state exactly recoverable.

## What I actually verified on the first 5 days of the stub run

Before even the wlms crash, I had pulled exhaustive artifact proof that the backward-clock mechanism was correctly writing to Windows logs. On just 5 days of stub activity (no real persona actions yet, just heartbeat files):

| Artifact layer | What I found |
|---|---|
| NTFS `$STANDARD_INFORMATION` | heartbeat.log CreationTime 4/15/2024 9:35, markers with per-round 2024 timestamps |
| Sysmon EVTX | 672 events in 5 days on WS01 (File Create, Process Create, Image Load, Registry, Pipe, DNS), all TimeCreated in 2024 |
| Security EVTX | 1088 events (4688, 4689, 4624, 4672...) in 2024 |
| System log | Clock-change events logged, Kernel-General time change entries |
| PowerShell Operational | 84 × 4104 Script Block Logging entries capturing every `Set-Date` we ran, backdated |
| Prefetch `.pf` | 6 prefetch files with LastWriteTime in 2024-04 window — generated naturally by Windows while the clock was set |
| Persona schedule realism | On SRV02, round at 17:14 had tyron + system.backup but NOT catelyn or stannis (both end work at 17:00); round at 16:59 had all four (all still within the 17:00 cutoff) — schedules respected to the minute |

And the control negative check: DC02, DC03, SRV03, and LNX01 (which had no personas assigned in those 5 days) had **zero** events in the 2024 window. The orchestrator is surgical — it touches exactly what the plan says and nothing else.

## The first full run

With wlms disabled, the `pre-noise` snapshot re-taken, and the 6 initial personas on 4 touched VMs, I launched the full run again in tmux. It completed cleanly in **7h 34m** across 730 days:

```
progress:           730/730 days done, 0 in-progress, 0 pending
failures logged:    0
rounds:             1683 / 1683
participants:       8024 / 8024
```

Per-VM marker breakdown after the first full run:

| VM | Markers | Personas |
|---|---:|---|
| 101 DC01 | 1,683 | system.replication |
| 103 SRV02 | 4,126 | system.backup + tyron + catelyn + stannis |
| 106 WS01 | 1,167 | jon.snow (workdays only) |
| 107 LNX01 | 1,048 | samwell.tarly + arya.stark |
| 102 DC02 | 0 | *(untouched)* |
| 104 DC03 | 0 | *(untouched)* |
| 105 SRV03 | 0 | *(untouched)* |

That "0" in the bottom three rows is where my own review of my own lab caught a real flaw. Let me explain.

## The second problem: three silent DCs

Looking at the finished dataset, I noticed something that any reasonable DFIR instructor would catch in five minutes:

> "Wait — DC02 is the domain controller of `north.sevenkingdoms.local`, the child domain. In real AD, child-domain DCs replicate with their parent every 15 minutes by default, and any user authenticating against that child domain generates Kerberos traffic on that DC. An entire child DC with zero events for two years is forensically impossible."

Same story for DC03 (the `essos.local` second-forest DC) and SRV03 (the ADCS Certificate Authority — CA certs renew themselves on background jobs, at minimum you see a CRL publication daily). A dataset where those three servers are completely dead is a dataset a trained investigator would flag as synthetic the moment they opened it.

The root cause wasn't a bug — it was my persona roster. I had built the initial validation set around "one representative of each role category": a root DC, a file server, a workstation, a Linux host. That's a solid **mechanical** validation (does the orchestrator work end-to-end?) but it leaves the GOAD forest topology half-populated. The other three VMs weren't touched because no persona had been defined to touch them.

Fixing this required three things.

**First, the persona model had to support explicit multi-VM targeting.** The old model had one `workstation` field per human persona plus a hardcoded fallback to SRV02. That's fine for a centralised workstation-based user but wrong for a persona who "authenticates against the north DC" — which has no workstation at all, just a DC. I added a new `touches_vms` list field:

```yaml
- id: brandon.stark
  role: Junior Developer (north)
  touches_vms: [102]             # authenticates against DC02
  schedule: {start: 9, end: 17}
  workdays: [mon, tue, wed, thu, fri]
```

And changed `day_planner.py` to iterate `persona.target_vm_set()` (a union of `workstation` + `linux_host` + `touches_vms`) instead of the old field-by-field logic.

**Second, the persona roster had to grow to cover all three domains.** The final set is 11 humans (up from 6) plus 5 system personas (up from 2), spread across the three domains:

| Domain | DC | New personas |
|--------|----|--------------|
| sevenkingdoms.local (root) | 101 | (existing 6) |
| north.sevenkingdoms.local (child) | 102 | brandon.stark, robb.stark |
| essos.local (second forest) | 104 | daenerys.targaryen, viserys.targaryen, khal.drogo |

Plus three new system personas to guarantee no DC ever goes silent:

```yaml
- id: system.replication.north
  target_vm: 102
  always: true

- id: system.replication.essos
  target_vm: 104
  always: true

- id: system.adcs
  target_vm: 105                       # SRV03 CA, nightly CRL
  always: true
```

**Third, narrative events had to get assigned to the new personas too.** Otherwise the new rows would be just flat noise, not stories. I added:

- **viserys.targaryen** (essos board member) — part-time Mon/Wed/Fri, `active_to: 2025-06-30`. The analyst should be able to pinpoint "when viserys retired".
- **khal.drogo** (essos sales) — `active_from: 2024-06-01`. A mid-window hire like samwell, but on the essos side.
- **robb.stark** and **brandon.stark** (north) — regular sevenkingdoms-style schedules with vacations.

## The third problem: night-shift personas invisible

While I had the persona model open, I also fixed a limitation I'd noted earlier. arya.stark was supposed to be a night-shift junior dev (22:00–02:00) until her promotion on 2025-10-16, after which she moves to day shift 10:00–19:00. In the first full run, her pre-promotion era had **zero events** in the dataset. Why? Because the `workday_normal` profile's round hours were `[9, 13, 17]`, and none of those fall in the 22–02 night-shift window. The planner correctly never selected her.

Forensically this meant arya showed up as "a user who appeared out of nowhere on 2025-10-16", not "a night-shift worker who got promoted". That's a broken narrative.

Fix: add a fourth round at 23:xx to every `workday_*` profile:

```yaml
workday_normal:
  rounds: 4                          # was 3
  round_hours: [9, 13, 17, 23]       # added night round
```

Now arya's pre-promotion rounds land inside her night-shift window. The rest of the personas are unaffected because they're not active at 23:xx. Cost: one extra round per workday = ~432 extra rounds across the full run, a modest ~30% increase in workday runtime.

## The fourth problem: Linux stuck at fake time after restore

The first full run finished with all Windows VMs correctly back to real time — `w32tm /resync` worked. But LNX01 was showing `2026-04-13 07:46` when real UTC was `23:57` — stuck 16 hours behind real. That's alarming: did the restore fail?

Running `timedatectl` inside the guest revealed the root cause immediately:

```
Local time:            Mon 2026-04-13 07:46:13 UTC
Universal time:        Mon 2026-04-13 07:46:13 UTC
RTC time:              Mon 2026-04-13 23:57:31      ← hardware clock CORRECT
System clock synchronized: no
```

The **RTC** was fine — it had been real time the whole run, because KVM passes the host's clock through the emulated hardware RTC regardless of what we do with `date -s`. But the **Linux kernel system clock** was stuck at whatever fake date we last set it to, because `systemd-timesyncd` hadn't contacted its upstream NTP server yet (network came up slowly, maybe a firewall window, maybe the default pool was unreachable).

The fix is trivially one line: force-sync the system clock from the RTC before touching the NTP daemon:

```bash
hwclock --hctosys 2>/dev/null || true
# ... then start systemd-timesyncd / chrony
```

Added to `LNX_RESTORE_SH` in `clock_control.py`. Idempotent, network-independent, always correct because the RTC is always correct.

## Regenerating the dataset — seven VMs, three domains

With all three fixes committed (touches_vms model + night round + hwclock restore), I deleted the old `noisy-ad-2years` snapshot, rolled all seven VMs back to `pre-noise`, reset the checkpoint, and launched the full run again.

The new plan:

```
days:              730
rounds:            2132          (was 1683, +27% from night round)
participants:      21521         (was 8024, +168% from 7 VMs + 5 extra personas)
VMs touched:       7 / 7
domains covered:   sevenkingdoms + north + essos
```

Total runtime: **8h 32m** (vs 7h 34m for the first run). The extra 58 minutes is the cost of covering three more VMs — less than expected because parallelism scales well: within each round, all touched VMs run in parallel worker threads, so adding more VMs doesn't linearly multiply wall time.

## Forensic verification — the per-VM battery

Once the second run finished, I wrote a `phase10-verify.py` script that queries native forensic artefacts on each VM and checks them against expectations. Not heartbeat self-checks — actual Windows Event Log, NTFS metadata, Prefetch file scan. The kind of thing an investigator would do on day one.

Key results per VM:

**VM 101 DC01-kingslanding** (sevenkingdoms root DC, `system.replication` + jon.snow admin access):
- 3,333 markers (2,132 system + 1,201 jon.snow)
- Sysmon: **216,188** events
- Event 4616 (System time changed): **4,280** ← the clock-travel signature
- First marker: 2024-04-13, last: 2026-04-12 ✓

**VM 102 DC02-winterfell** (north child DC, previously 0 markers):
- 4,243 markers (2,132 system + 929 brandon + 1,182 robb)
- Sysmon: **254,684** events
- 4616 signature: **4,277** (was 23 before, pure NTP baseline)

**VM 103 SRV02-castelblack** (heaviest, 4 humans + system.backup):
- 4,636 markers
- Sysmon: **268,903**
- Narrative checks all exact:
  - stannis.baratheon last event: **2025-09-15** (his exact leaving date)
  - catelyn.stark markers during maternity 2025-04-20 → 2025-10-14: **0**
  - catelyn last pre-maternity: 2025-04-17 ✓
  - catelyn first post-maternity: 2025-10-16 ✓

**VM 104 DC03-meereen** (essos forest DC, previously 0 markers):
- 4,573 markers (2,132 system + 1,313 daenerys + 174 viserys + 954 khal)
- Sysmon: **231,066**
- Narrative checks exact:
  - khal.drogo first event: **2024-06-03** (first Monday after his 2024-06-01 Saturday hire date)
  - viserys.targaryen last event: **2025-06-30** (his exact retirement date)

**VM 105 SRV03-braavos** (ADCS, previously 0 markers):
- 2,132 markers (= total rounds, exactly — system.adcs fires every round)
- Sysmon: **139,098**
- Security: **264,086**
- 4616: **4,282**

**VM 106 WS01-highgarden** (jon.snow's workstation):
- 1,201 markers, all jon.snow
- Day-of-week histogram: Mon 238, Tue 250, Wed 237, Thu 242, Fri 234, **Sat 0, Sun 0** ← perfect workday-only pattern
- Sysmon: 88,957 | Security: 150,596
- Prefetch .pf files with LastWrite in the fake window: **120** (Win10 has Prefetch enabled, natural NTFS forensic artefact)

**VM 107 LNX01** (samwell + arya):
- 1,403 markers (823 samwell + 580 arya)
- samwell first event: **2024-09-02** (first Monday after his 2024-09-01 Sunday hire date)
- **arya pre-promotion markers: 330** ← the night-round fix working
- arya post-promotion markers: 250
- **arya pre-promotion hours: `['00', '22', '23']`** ← night shift hours only
- arya post-promotion hours: `['10', '11', '12', '13', '14', '16', '17', '18']` ← day shift hours only

The ten narrative assertions that prove the story holds:

1. ✅ samwell.tarly hired 2024-09-01 → first event **2024-09-02** (first Monday)
2. ✅ khal.drogo hired 2024-06-01 → first event **2024-06-03** (first Monday)
3. ✅ viserys.targaryen retired 2025-06-30 → last event **2025-06-30** exact
4. ✅ catelyn.stark maternity 2025-04-20 → 0 events in the window → first post-event **2025-10-16**
5. ✅ stannis.baratheon left 2025-09-15 → last event **2025-09-15** exact
6. ✅ arya.stark promoted 2025-10-16 → shift changes from 22-00 to 10-18 on that exact date
7. ✅ jon.snow workdays only → 0 events Sat/Sun in 730 days
8. ✅ All three DCs (101/102/104) have 4k+ of 4616 (clock-travel signature)
9. ✅ All three DCs have 2,132 system.replication markers = total rounds
10. ✅ SRV03 ADCS has exactly 2,132 system.adcs markers (one per round, nightly CRL)

## What the dataset looks like now

After the regeneration, the complete forensic corpus sits on seven VMs spanning 2024-04-13 through 2026-04-12:

- **~1.3 million EVTX events** backdated across Sysmon, Security, PowerShell, System logs on the six Windows VMs
- **~120 natural Prefetch `.pf` files** on WS01 with LastWrite in the fake window
- **21,521 sentinel marker files** with NTFS CreationTimeUtc in the fake window, per-persona parseable
- **Every DC in the forest replicating every single day** — no suspicious silences
- **Every narrative event** (hire, fire, promotion, maternity, retirement) reflected in the event log with day-level accuracy

## The gap problem and the rolling catchup

A static 2-year snapshot ends on day X. Real time keeps moving. If you come back to run an attack two weeks later, the forensic timeline shows two weeks of silence between the last narrative event and the first attack event. That's ugly — and the longer you wait, the uglier it gets. At six months, the gap dwarfs anything the attack itself produces.

The fix is a rolling catchup: whenever real time advances, extend the narrative forward by those extra days so the dataset's "last day" is always "yesterday". Two design decisions mattered here.

**First: don't touch the pristine snapshot.** `noisy-ad-2years` stays frozen forever as the reference baseline. A second snapshot `noisy-ad-current` sits on top of it and gets replaced by the catchup each run. If `noisy-ad-current` ever gets corrupted, the next cron run recreates it from the pristine state. If you ever want to reset the whole lab to "factory new 2-year snapshot", you roll back to `noisy-ad-2years` and the cron rebuilds `noisy-ad-current` on its next tick.

```
clean-ad → pre-noise → noisy-ad-2years → noisy-ad-current
                       ↑ never touched   ↑ updated daily
```

**Second: phase10 refuses to run with a partial override.** The first test run of the catchup script died with a date-parsing bug that left one of the override flags empty. Without a safety net, phase10 would have silently fallen back to the default `start_date: 2024-04-13`, rebuilding the full 2-year plan from scratch and iterating 8 hours of already-done rounds (writing fresh 4616 clock-change events along the way, polluting the dataset). That actually happened for a few minutes before I killed it, and it took a rollback + snapshot rebuild to recover. After that incident I made `phase10.py` explicitly refuse to run if `--extend-from` and `--extend-to` aren't provided together, or if `--state-dir` is missing when they are.

Trust is expensive; hard-fail is cheap.

The catchup script itself is a ~100-line bash wrapper that:

1. Queries the newest marker on SRV02 to figure out the last narrated day
2. Computes "yesterday UTC" as the target
3. If there's a gap, calls `phase10.py` in ephemeral mode (`--state-dir /tmp/...`) with the exact date range
4. Replaces the `noisy-ad-current` snapshot with the new state
5. Logs everything to `/var/log/lab-catchup.log`

Scheduling is **once a day at 03:00 UTC** via `/etc/cron.d/lab-catchup`. Off-hours for the operator (05:00 CEST), and past UTC midnight so "yesterday" is a complete day. Runs most days generate exactly 1 day of noise in about 90 seconds. If the cron has been down for a week, the next run generates 7 days in a single invocation — idempotent and resumable, same machinery as the original full run.

**Telegram behaviour**: silent on success. Pings only when something fails. That keeps the notification inbox clean and guarantees that any message means "something needs attention now". To verify the cron is alive day-to-day:

```bash
tail -20 /var/log/lab-catchup.log
/root/lab/scripts/lab-catchup-status.sh    # gap summary, recent runs
```

**Manual trigger** for when you're about to run an attack session and want a zero-day gap:

```bash
ssh root@hetzner
/root/lab/scripts/lab-catchup.sh    # idempotent, ~3s if nothing to catch up
```

Wait for it to finish (silent success, or Telegram error if it failed), then roll back the VMs to `noisy-ad-current` to discard any live-state drift before launching Kali at them. Attack events land one day after the last narrative entry: a continuous forensic timeline with no visible collection gap.

## What's next

The scaffolding is complete, the dataset is validated, and the `noisy-ad-2years` + `noisy-ad-current` snapshot pair is ready for use.

**Important caveat**: this is still stub activity. Each (persona, round) tuple writes a single marker file and a heartbeat log line. That's enough to prove the scaffolding works end-to-end AND to generate the background Sysmon/Security noise that Windows itself produces when a process runs under a persona's name. But it's not yet realistic *application-level* activity — jon.snow doesn't actually open Word documents, samwell.tarly doesn't actually push git commits, and there's no Chrome history being populated. Those hooks are what Part 9 will cover. The architecture is what Part 8 is about.

The good news: the infrastructure we just built means adding real persona activity is *only* an `lib/activities.py` rewrite. The day loop, parallelism, checkpoint, clock travel, Spanish calendar, three-domain persona model, wlms workaround, hwclock restore, night-shift support, Telegram alerts, and per-VM forensic verification are all done and reusable.

---

*Next: [Part 9 — Collecting the Evidence: Forensic Imaging Pipeline]({% post_url en/2026-04-15-ad-dfir-lab-part9-forensic-imaging %})*

*Previous: [Part 7.5 — Keeping the Kingdoms Alive: Eval Licenses and Lab Longevity]({% post_url en/2026-04-13-ad-dfir-lab-part7-5-licenses %})*
