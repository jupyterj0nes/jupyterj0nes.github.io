---
layout: post
title: "AD DFIR Lab — Part 4: Crowning the Domain Controllers — Active Directory with GOAD"
date: 2026-04-13 10:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part4
tags: [dfir, active-directory, goad, ansible, kerberos, lab]
description: "Deploying the lab's two forests using GOAD's Ansible playbooks. DC01 promoted to sevenkingdoms.local, DC02 to north.sevenkingdoms.local (child), DC03 to essos.local (second forest), and a bidirectional cross-forest trust."
comments: true
---

*This is Part 4 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We deploy the entire Active Directory structure: two forests, a child domain, and the cross-forest trust.*

## Why GOAD

[GOAD (Game of Active Directory)](https://github.com/Orange-Cyberdefense/GOAD) by Orange Cyberdefense is **the** open source project for vulnerable AD environments. It's tested, maintained, and reproduces dozens of real-world vulnerabilities: AS-REP Roasting, Kerberoasting, ADCS ESC1-ESC8, ACL abuse, cross-forest trust attacks, MSSQL trusted links, etc.

Why not write it ourselves from scratch? Because it's already done and battle-tested by a company that lives off pentesting AD. Reinventing the wheel would be silly.

## The plan: use the playbooks, ignore the launcher

GOAD has a Python launcher (`goad.py`) that orchestrates everything: it provisions VMs with Terraform/Vagrant for whichever provider you choose (AWS, Azure, Proxmox, VMware...) and then runs the Ansible playbooks.

**We already have the VMs**, so we **skip the launcher** and use the playbooks directly with a custom inventory pointing at our IPs. Faster and with more control.

## Adapting IPs

GOAD upstream uses specific IPs:

| Host | GOAD IP | Our IP (before) |
|------|---------|-----------------|
| dc01 (kingslanding) | 192.168.10.10 | 192.168.10.10 ✓ |
| dc02 (winterfell) | 192.168.10.11 | 192.168.10.11 ✓ |
| dc03 (meereen) | 192.168.10.12 | 192.168.10.13 ✗ |
| srv02 (castelblack) | 192.168.10.22 | 192.168.10.12 ✗ |
| srv03 (braavos) | 192.168.10.23 | 192.168.10.14 ✗ |
| ws01 (highgarden) | 192.168.10.31 | 192.168.10.20 ✗ |
| lx01 (oldtown) | 192.168.10.32 | DHCP ✗ |

We had three wrong and two were extras from GOAD extensions we didn't know about. Solution: **renumber our VMs to match GOAD upstream**. That way we don't touch a single GOAD file.

```bash
# Reconfigure IPs via guest agent (example)
qm guest exec 103 -- powershell -Command '
    $a = Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
    Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 | Remove-NetIPAddress -Confirm:$false
    Remove-NetRoute -InterfaceIndex $a.ifIndex -Confirm:$false
    New-NetIPAddress -InterfaceIndex $a.ifIndex -IPAddress 192.168.10.22 -PrefixLength 24 -DefaultGateway 192.168.10.1
'
```

**Gotcha**: if the new IP uses the same gateway as the old one, `New-NetIPAddress` fails with "Instance DefaultGateway already exists". You need to delete the route first with `Remove-NetRoute`.

## Adapted inventory

GOAD's playbooks assume many specific groups in the inventory: `parent_dc`, `child_dc`, `dc`, `iis`, `mssql`, `adcs`, `trust`, `defender_on/off`, `update`, `no_update`, `laps_*`, etc. If you're missing one, the playbooks silently "skip" without doing what they should.

Clean fix: copy the full group set from `/root/GOAD/ad/GOAD/data/inventory` and only override the connection vars with ours:

```ini
[default]
dc01 ansible_host=192.168.10.10 dns_domain=dc01 dict_key=dc01
dc02 ansible_host=192.168.10.11 dns_domain=dc01 dict_key=dc02
srv02 ansible_host=192.168.10.22 dns_domain=dc02 dict_key=srv02
dc03 ansible_host=192.168.10.12 dns_domain=dc03 dict_key=dc03
srv03 ansible_host=192.168.10.23 dns_domain=dc03 dict_key=srv03
ws01 ansible_host=192.168.10.31 dns_domain=dc01 dict_key=ws01 ansible_winrm_transport=ntlm
lx01 ansible_host=192.168.10.32 dict_key=lx01

[windows]
dc01
dc02
srv02
dc03
srv03
ws01

[windows:vars]
ansible_user=vagrant
ansible_password=vagrant
ansible_connection=winrm
ansible_winrm_transport=basic
ansible_port=5985
ansible_winrm_scheme=http

[linux]
lx01

[linux:vars]
ansible_connection=ssh
ansible_user=ubuntu
ansible_python_interpreter=/usr/bin/python3

# === GOAD groups (from ad/GOAD/data/inventory) ===
[domain]
dc01
dc02
dc03
srv02
srv03

[parent_dc]
dc01
dc03

[child_dc]
dc02

[trust]
dc01
dc03

[adcs]
dc01
srv03

[iis]
srv02

[mssql]
srv02
srv03

# ... and many more
```

## The DNS-before-DNS problem

`build.yml` —the first playbook— needs to install `NuGet` from the PowerShell Gallery. It fails with:

```
Install-PackageProvider : No match was found for the specified search criteria
for the provider 'NuGet'. The package provider requires 'PackageManagement'
and 'Provider' tags.
```

Why? The VMs have `192.168.10.10` (DC01) as DNS, but **DC01 isn't a DNS server yet** — that's configured by `ad-parent_domain.yml`. Without working DNS, the VMs can't resolve `powershellgallery.com` or download anything.

**Fix**: set 8.8.8.8 as temporary DNS on all Windows VMs. GOAD will change the DNS later when it promotes the DCs:

```bash
for VMID in 101 102 103 104 105 106; do
    qm guest exec $VMID -- powershell -Command '
        Set-DnsClientServerAddress -InterfaceIndex (Get-NetAdapter |
            Where-Object { $_.Status -eq "Up" } | Select -First 1).ifIndex `
            -ServerAddresses 8.8.8.8,1.1.1.1
    '
done
```

And in the inventory: `force_dns_server=no` so GOAD doesn't reset it.

## The playbook chain

For the "GOAD" lab (the full one with two forests + child + trust), the order is:

```
1.  build.yml          — common settings, keyboard, DNS
2.  ad-servers.yml     — hostname/timezone setup
3.  ad-parent_domain.yml — promote DC01 + DC03 to Domain Controllers
4.  ad-child_domain.yml  — promote DC02 as child of sevenkingdoms.local
5.  wait5m.yml         — wait for child domain replication
6.  ad-members.yml     — join SRV02 and SRV03 to their domains
7.  ad-trusts.yml      — establish cross-forest trust
8.  ad-data.yml        — create users, groups, OUs (the Stark, Targaryen, etc.)
9.  ad-gmsa.yml        — Group Managed Service Accounts
10. laps.yml           — LAPS
11. ad-relations.yml   — group memberships
12. adcs.yml           — Active Directory Certificate Services with vulnerable templates
13. ad-acl.yml         — abusable ACLs (DCSync paths, GenericAll, etc.)
14. servers.yml        — IIS, MSSQL, file shares
15. security.yml       — Defender configuration
16. vulnerabilities.yml — final vulnerable configuration
```

Each one runs with:
```bash
ansible-playbook -i /root/lab/goad/inventory build.yml
```

## Snapshots during deploy

Before each critical playbook, ZFS snapshot to allow rollback if something breaks:

```bash
for VMID in 100 101 102 103 104 105 106 107 108; do
    qm snapshot $VMID parent-domains-up \
        --description "After ad-parent_domain.yml: 2 forests created"
done
```

ZFS snapshots are instant and practically free in disk space (until the content changes a lot). If the next playbook breaks something, `qm rollback` brings you back in seconds.

## Result after the first 6 playbooks

After `build.yml` → `ad-trusts.yml`:

```powershell
# On DC01 (kingslanding)
PS> (Get-WmiObject Win32_ComputerSystem).Domain
sevenkingdoms.local

# On DC03 (meereen)  
PS> (Get-WmiObject Win32_ComputerSystem).Domain
essos.local

# On DC02 (winterfell)
PS> (Get-WmiObject Win32_ComputerSystem).Domain
north.sevenkingdoms.local

# Trust verified
PS> Get-ADTrust -Filter *
Name: essos.local
Direction: BiDirectional
Source: sevenkingdoms.local
Target: essos.local
TrustType: Forest
```

**Full AD structure operational**:

```
Forest 1: sevenkingdoms.local
├── sevenkingdoms.local
│   └── DC01 (kingslanding) — Root DC, ADCS pending
└── north.sevenkingdoms.local
    ├── DC02 (winterfell) — Child DC
    └── SRV02 (castelblack) — member server

Forest 2: essos.local
└── essos.local
    ├── DC03 (meereen) — Root DC
    └── SRV03 (braavos) — member server

         ↕ Cross-forest trust ↕
```

Remaining playbooks: `ad-data.yml`, `ad-relations.yml`, `ad-acl.yml` create Jon Snow, Sansa Stark, Daenerys, Brandon Stark and the rest of the cast with their intentional weak passwords and abusable ACLs. Then `adcs.yml`, `servers.yml`, `vulnerabilities.yml` to finish the vulnerable configuration.

---

*Next: Part 5 — The Smallfolk: Users, Groups, Shares and Vulnerabilities (coming soon)*

*Previous: [Part 3 — Beyond the Wall: pfSense, VLANs and Network Segmentation]({% post_url en/2026-04-12-ad-dfir-lab-part3-pfsense %})*
