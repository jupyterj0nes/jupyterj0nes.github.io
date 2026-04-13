---
layout: post
title: "The Iron Throne of DFIR — Building an Active Directory Lab for Forensic Training"
date: 2026-04-12 10:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-intro
tags: [dfir, active-directory, lab, proxmox, goad, hetzner, forensics]
description: "Complete series on building an Active Directory lab with two forests, nine VMs, pre-built vulnerabilities and advanced auditing — fully automated on a Hetzner dedicated server for 38 EUR/month."
comments: true
---

## Why you need an AD lab for DFIR

If you work in incident response or digital forensics, you know that 90% of the attacks you investigate happen in Active Directory environments. Kerberoasting, lateral movement with PsExec, DCSync, ADCS abuse — you see them constantly in real cases. But where do you practice?

Certifications give you limited lab scenarios. Online platforms have shared environments and restrictions. What you need is **your own lab**, with your own domain, your own users, your own network noise — and the ability to attack it, export forensic images, and analyze them exactly as you would in a real case.

## What we're building

A complete Active Directory environment inspired by [GOAD (Game of Active Directory)](https://github.com/Orange-Cyberdefense/GOAD) by Orange Cyberdefense, with a Game of Thrones theme:

```
Hetzner AX41-NVMe (Ryzen 5 3600, 64 GB RAM, 2x512 GB NVMe) — 38 EUR/month

VLAN 10 — Corporate Network (192.168.10.0/24)
  DC01  kingslanding   Win Server 2019   Root DC, ADCS, DNS, DHCP
  DC02  winterfell     Win Server 2019   Child domain: north.sevenkingdoms.local
  SRV02 castelblack    Win Server 2019   IIS, MSSQL, file shares, WinRM
  DC03  meereen        Win Server 2016   Second forest: essos.local
  SRV03 braavos        Win Server 2016   Cross-forest trust
  WS01  highgarden     Windows 10        Domain workstation
  LNX01 oldtown        Ubuntu 22.04      SSSD + AD authentication

VLAN 20 — Attack Network (192.168.20.0/24)
  KALI  nightking      Kali Linux        Impacket, BloodHound, Certipy, Rubeus...

pfSense firewall between VLANs — Kali must pivot, just like a real engagement.
```

Two forests with bidirectional trust. Three domains. Nine virtual machines. Over 2,500 users generated with BadBlood. Pre-built vulnerabilities including AS-REP Roasting, Kerberoasting, delegation, ADCS ESC1-ESC8, ACL abuse and much more.

## The full DFIR workflow

What makes this lab special isn't just the vulnerable environment — it's the complete investigation cycle:

1. **Generate baseline noise** — 24 hours of realistic corporate activity before any attack
2. **Snapshot** the clean state
3. **Run an attack scenario** from Kali (automated or manual)
4. **Export forensic images** (VMDK, raw) of compromised machines
5. **Analyze with your tools** — masstin, Volatility, plaso, whatever you prefer
6. **Revert** to clean state and repeat with a different scenario

Each attack scenario generates specific artifacts you can hunt for: events 4624, 4769, 4662, Sysmon event 1 with full command lines, PowerShell script blocks in 4104...

## The series

The entire process is automated with scripts and documented step by step:

| Part | Title | Content |
|------|-------|---------|
| **Part 1** | [From Bare Metal to Proxmox]({% post_url en/2026-04-12-ad-dfir-lab-part1-proxmox %}) | Hetzner server, rescue system, installing Proxmox VE with ZFS |
| **Part 2** | [The Seven Kingdoms — Deploying Windows VMs]({% post_url en/2026-04-12-ad-dfir-lab-part2-windows-vms %}) | Creating VMs, autounattend, VirtIO drivers |
| **Part 3** | [Beyond the Wall — pfSense, VLANs and Network Segmentation]({% post_url en/2026-04-12-ad-dfir-lab-part3-pfsense %}) | pfSense, VLAN 10/20, NAT, WireGuard |
| **Part 4** | [Crowning the Domain Controllers — AD, Forests and Trusts]({% post_url en/2026-04-13-ad-dfir-lab-part4-goad %}) | GOAD, domains, forests, cross-trust |
| **Part 5** | [The Smallfolk — Users, Groups and Vulnerabilities]({% post_url en/2026-04-13-ad-dfir-lab-part5-users-vulns %}) | Catalog of users, groups, AS-REP, Kerberoast, ADCS, ACLs |
| **Part 6** | [Ravens and Whispers — Audit Configuration]({% post_url en/2026-04-13-ad-dfir-lab-part6-audit %}) | Sysmon, audit policy, PowerShell logging, auditd |
| **Part 7** | [The Night King Rises — Kali as Attack Platform]({% post_url en/2026-04-13-ad-dfir-lab-part7-kali %}) | Offensive tools, configuration, AS-REP roast test |
| **Part 8** | A Day in the Realm — Generating Baseline Noise | Realistic RDP, SMB, Kerberos, DNS traffic |
| **Part 9** | Fire and Blood — Attack Scenarios and Forensic Analysis | Attacks, image export, analysis with masstin |

## Cost

| Item | Cost/month |
|------|-----------|
| Hetzner AX41-NVMe (64 GB RAM, 2x512 GB NVMe) | 38 EUR |
| Windows licenses (evaluation, reset via ZFS snapshot) | 0 |
| Proxmox VE (community edition) | 0 |
| GOAD + BadBlood + tools | 0 (open source) |
| **Total** | **38 EUR/month** |

## Repository

All code is available on GitHub: [ad-dfir-lab](https://github.com/jupyterj0nes/ad-dfir-lab)

---

*Next: [Part 1 — From Bare Metal to Proxmox]({% post_url en/2026-04-12-ad-dfir-lab-part1-proxmox %})*
