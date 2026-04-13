---
layout: post
title: "AD DFIR Lab — Part 8: A Day in the Realm — Generating Two Years of Historical Noise"
date: 2026-04-13 18:30:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part8
tags: [dfir, lab, active-directory, forensics, python, proxmox]
description: "Two years of synthetic corporate activity on top of a clean AD, using backward clock travel, a day-as-iteration planner, Spanish calendar profiles with vacations and narrative events, and a brutal gotcha with Windows wlms.exe that crashed three VMs mid-run."
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

## What's next

The full run is in progress while I write this. When it finishes, the `noisy-ad-2years` snapshot will be taken, NTP will be restored across every VM, and a final ✅ message will hit Telegram.

**Important caveat**: this first pass uses stub activities. Each (persona, round) tuple writes a single marker file and a heartbeat log line. That's enough to prove the scaffolding works end-to-end with the calendar/personas/planner/checkpoint/parallelism, but it's NOT yet realistic persona-driven activity — jon.snow doesn't actually open Word documents, samwell.tarly doesn't actually push git commits, and there's no Chrome history being populated. Those hooks are what Part 9 will cover. The architecture is what Part 8 is about.

The good news: the infrastructure we just built means adding real persona activity is *only* an `lib/activities.py` rewrite. The day loop, parallelism, checkpoint, clock travel, Spanish calendar, wlms workaround, and Telegram alerts are done and reusable.

---

*Next: Part 9 — Fire and Blood: Attack Scenarios and Forensic Analysis (coming soon)*

*Previous: [Part 7.5 — Keeping the Kingdoms Alive: Eval Licenses and Lab Longevity]({% post_url en/2026-04-13-ad-dfir-lab-part7-5-licenses %})*
