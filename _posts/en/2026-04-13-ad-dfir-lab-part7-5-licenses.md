---
layout: post
title: "AD DFIR Lab — Part 7.5: Keeping the Kingdoms Alive — Eval Licenses and Lab Longevity"
date: 2026-04-13 14:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part7-5
tags: [dfir, lab, windows, licensing, proxmox, telegram]
description: "Windows evaluation editions tick on wall-clock, not runtime. An empirical test on a Win10 eval VM, rearm limits for Server 2019 and Win10, and a Telegram alert system for the lab."
comments: true
---

*This is an interlude in the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. A short operational post about keeping the lab running for years rather than months.*

## The question that didn't have an obvious answer

While planning Phase 10 (generating two years of synthetic historical activity), a practical question came up: *what happens in 6 months when the Windows evaluation periods expire?* The whole forest is built on eval ISOs. Server 2019 is good for 180 days. Win10 Enterprise for 90. And I plan to keep this lab alive for years.

The folk wisdom is: "just shut the VMs down when you're not using them, eval time is only consumed while they're running." I couldn't find a definitive answer one way or the other, so I ran the experiment.

## Empirical test: wall-clock vs runtime

VM 106 (`highgarden`, Win10 Enterprise Eval) was the guinea pig. The query is this little PowerShell:

```powershell
$p = Get-WmiObject -Class SoftwareLicensingProduct |
     Where-Object { $_.PartialProductKey -and $_.LicenseStatus -ne 0 } |
     Select-Object -First 1
[math]::Floor($p.GracePeriodRemaining / 1440)  # days
$p.GracePeriodRemaining                         # minutes (the raw value)
```

The protocol:

```
12:19:00  Baseline:     128506 minutes remaining
12:19:07  qm stop 106
          (VM completely off — not suspended, not hibernated)
12:29:25  qm start 106  (exactly 10 minutes later)
          Wait for guest agent...
          Read minutes again: 128496
```

**Delta: -10 minutes.** Exact match with the wall-clock elapsed. The VM being off didn't save a single minute.

**Conclusion**: Windows stores an absolute expiration date (`install_date + eval_period`) and compares against the current system time on every check. Whether the VM is running or stopped is irrelevant. The only ways to buy more time are `slmgr /rearm` and **clock travel backwards** — which is exactly what Phase 10 is going to do for unrelated reasons (generating two years of fake history).

This finding completely changed my view of the lab's expected lifetime.

## Rearm limits and real lifetime

```
Server 2019/2016   →  180 d initial + 6 × 180 d  ≈  3.4 years
Win10 Enterprise   →   90 d initial + 2 ×  90 d  ≈  9 months
```

Windows 10 is the bottleneck. And "9 months" actually overstates it — that assumes you stay on top of the rearms.

There's a nuance worth knowing: **Win10 eval degrades more gracefully than Server eval**. Server 2019 enters "Notification Mode" when it expires and starts shutting itself down once an hour — effectively unusable. Win10 eval just turns the desktop black, puts a "not genuine" watermark on it, and nags every hour. RDP, WinRM, Sysmon, services, domain membership — everything keeps working. For a DFIR lab that gets attacked from Kali and analyzed from EVTX, a black wallpaper is not a problem.

So the real strategy splits in two:

- **Server VMs** → keep rearming on schedule, never let them expire
- **WS01 (Win10)** → rearm while we can, replace with a fresh VM when we can't

## The monitoring scripts

Two small Bash scripts live on the Proxmox host, talking to the guests via the QEMU guest agent. Guest agent is the right transport for this: no network, no clock dependency, no SSH, works regardless of the state of the AD.

`scripts/lab-license-status.sh` — daily-safe read-only check:

```
VMID  NAME                   STATE      DAYS REMAINING  EXPIRES ON   STATUS
------------------------------------------------------------------------------------
101   kingslanding           running    178 days        2026-10-08   OK
102   winterfell             running    178 days        2026-10-08   OK
103   meereen                running    178 days        2026-10-08   OK
104   castelblack            running    178 days        2026-10-08   OK
105   braavos                running    178 days        2026-10-08   OK
106   highgarden             running     89 days        2026-07-11   OK
```

`scripts/lab-license-rearm.sh` — rearm one, all, or just check:

```bash
./lab-license-rearm.sh check     # read-only, shows rearms left per VM
./lab-license-rearm.sh 101       # rearm DC01 (prompts, reboots)
./lab-license-rearm.sh all       # rearm every Windows VM
```

Rearm requires a reboot to take effect, so the script reboots the guest and waits for the agent to come back before reading the new state.

## Telegram alerts

The third piece is a tiered alert wrapper, `scripts/lab-license-alert.sh`, that runs from cron and sends a Telegram message when any VM crosses one of these thresholds:

```
30  15  10  5  4  3  2  1   days remaining
```

Two design details worth mentioning:

1. **Anti-spam state file**. Each VM has a line in `/root/lab/state/license-alert-state` with `(vmid, last_threshold, last_days, last_rearms)`. An alert only fires when the VM crosses a *lower* threshold than last time. If a VM is rearmed and days go up, the state resets — so the next time it slides into 30 days you get notified again.

2. **Rearms-exhausted alert**. Independent of the days threshold, the first time a VM reaches `RemainingAppReArmCount == 0`, it fires a separate message. That's the signal to either schedule the VM for replacement or accept degraded eval mode.

Cron entry:

```cron
0 9 * * * root /root/lab/scripts/lab-license-alert.sh >> /var/log/lab-license.log 2>&1
```

Config is kept in `/root/lab/config/telegram.conf` (gitignored):

```bash
TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIjKlMnOpQrStUvWxYz"
TELEGRAM_CHAT_ID="123456789"
```

And a bot created through `@BotFather` on Telegram. The curl call is plain JSON:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    -d chat_id="${CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="$MESSAGE"
```

### Running this in your own lab

If you're following the series and want the same alerts, **you need your own bot** — a Telegram bot can only send to `chat_id`s that have personally messaged it, so my bot token is useless to anyone else (and sharing it would be a credential leak anyway). The setup takes five minutes:

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → choose a display name and a `...bot` username → copy the token it returns.
2. Open the chat with your brand-new bot and send any message (`/start`, `hi`, whatever). Telegram will not give you a `chat_id` for a user that never talked to the bot.
3. From Proxmox, query the updates endpoint once to read your own chat id:
   ```bash
   TOKEN="<your-bot-token>"
   curl -sS "https://api.telegram.org/bot${TOKEN}/getUpdates" | jq '.result[].message.chat.id'
   ```
4. Drop `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` into `/root/lab/config/telegram.conf`, `chmod 600` it, and install the cron line from the previous section.

If you want alerts to reach a whole team, create a Telegram group, add your bot to it, and use the group's (negative) chat id in the config — the same script sends to groups without any code change.

What you will **not** be able to do is subscribe to *my* lab's bot to receive alerts about *my* lab. That's intentional: a shared bot would require publishing the token, letting anyone rate-limit it or spam the channel, and mixing unrelated labs into one alert stream. One bot per lab is the simplest secure model.

## WS01 replacement, prepared in advance

When Win10 eventually runs out of rearms, we don't want to rebuild it by hand. `scripts/replace-ws01.sh` is a one-shot: you give it a fresh Win10 ISO filename, it destroys VM 106, recreates it with the same VMID/RAM/disk/VLAN, boots into an unattended install with the pre-built autounattend ISO, waits for the desktop, prompts once for the manual `virtio-win-guest-tools.exe` install through VNC (which still cannot be automated — see Part 2), and then sets hostname + static IP + DNS. The last two steps (`ansible-playbook 07.5-join-extras.yml --limit ws01` and the audit reapply) are manual because they use the same playbooks already documented in the earlier parts — no need to duplicate them.

The result is a ~25-minute "rebuild WS01" operation rather than an afternoon of clicking through Windows setup.

## Takeaway

Three things from this detour:

- **Eval time is wall-clock**, empirically verified. Do not rely on shutting VMs down to save it.
- **Win10 is the bottleneck** (~9 months) but degrades gracefully — you can live with an expired eval.
- **Instrument early**: alerts from day one mean you never find out something expired by trying to log in.

With that out of the way, Phase 10 (historical noise generation with backwards clock travel) is up next.

---

*Next: [Part 8 — A Day in the Realm: Generating Two Years of Historical Noise]({% post_url en/2026-04-13-ad-dfir-lab-part8-historical-noise %})*

*Previous: [Part 7 — The Night King Rises: Kali as the Attack Platform]({% post_url en/2026-04-13-ad-dfir-lab-part7-kali %})*
