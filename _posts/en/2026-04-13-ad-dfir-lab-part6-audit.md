---
layout: post
title: "AD DFIR Lab — Part 6: Ravens and Whispers — Audit Configuration with Sysmon and auditd"
date: 2026-04-13 12:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part6
tags: [dfir, sysmon, auditd, audit-policy, powershell-logging, lab]
description: "Instrumenting the 7 domain machines with the auditing needed to capture forensic artifacts during attacks. Sysmon with sysmon-modular on Windows, auditd with 50 DFIR rules on Linux, full PowerShell logging, and conservative log sizing for a disk-limited server."
comments: true
---

*This is Part 6 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We configure all the auditing before running the attacks — if we don't do it now, the attacks won't leave a trace.*

## Why audit before attacking

A DFIR lab without auditing is like investigating a crime without security cameras. The attacks happen, but when you come to investigate **there's nothing left**. That's why Phase 8 comes before Phase 9 (attacks): instrument first, attack second, and then the artifacts are there to analyze.

What we'll capture:

**Windows:**
- **Sysmon** with olafhartong's `sysmon-modular` (2704 lines of rules)
- **Windows Advanced Audit Policy** via `auditpol` (not GPO)
- **PowerShell logging**: Script Block (4104), Module (4103), Transcription
- **Command line in 4688**
- **Operational logs**: WinRM, WMI-Activity, TaskScheduler

**Linux:**
- **auditd** with 50 DFIR rules (exec, auth, sudo, ssh, sssd, systemd, cron, priv esc)
- **persistent journald** in `/var/log/journal/`

## Windows: Sysmon with sysmon-modular

The Sysmon that ships with GOAD is from 2021 (v13) and uses the SwiftOnSecurity config. We use the **latest Sysmon** (v15+) with **olafhartong's sysmon-modular**, which has better coverage for modern MITRE ATT&CK techniques.

```bash
# On the Proxmox host
cd /root/lab/audit
wget https://download.sysinternals.com/files/Sysmon.zip
wget https://raw.githubusercontent.com/olafhartong/sysmon-modular/master/sysmonconfig.xml
# 2704 lines of rules with MITRE ATT&CK mapping
```

And the Ansible playbook installs Sysmon on all 6 Windows VMs:

```yaml
- name: Copy Sysmon.zip to Windows VM
  ansible.windows.win_copy:
    src: /root/lab/audit/Sysmon.zip
    dest: 'C:\sysmon\Sysmon.zip'

- name: Unzip Sysmon
  community.windows.win_unzip:
    src: 'C:\sysmon\Sysmon.zip'
    dest: 'C:\sysmon'

- name: Copy sysmon-modular config
  ansible.windows.win_copy:
    src: /root/lab/audit/sysmonconfig.xml
    dest: 'C:\sysmon\sysmonconfig.xml'

- name: Install Sysmon (first time)
  ansible.windows.win_command: 'C:\sysmon\Sysmon64.exe -accepteula -i C:\sysmon\sysmonconfig.xml'
  when: sysmon_svc.exists is not defined or not sysmon_svc.exists

- name: Update Sysmon config (if already installed)
  ansible.windows.win_command: 'C:\sysmon\Sysmon64.exe -c C:\sysmon\sysmonconfig.xml'
  when: sysmon_svc.exists is defined and sysmon_svc.exists
```

The logic is well thought out: on a fresh install use `-i`; if already installed use `-c` to update the config without reinstalling.

### Key Sysmon events captured by the modular config

| ID | Event | Why |
|----|-------|-----|
| 1 | ProcessCreate | **With command line** — the foundation of all analysis |
| 3 | NetworkConnect | Outbound connections |
| 7 | ImageLoaded | Loaded DLLs (DLL sideloading detection) |
| 8 | CreateRemoteThread | Process injection |
| 10 | ProcessAccess | Opening handles to other processes (mimikatz → lsass.exe) |
| 11 | FileCreate | File creation in suspicious paths |
| 13 | RegistryValueSet | Registry modification (persistence) |
| 22 | DnsQuery | DNS resolution — gold for C2 detection |

After the attacks, we'll have thousands of these events in `Microsoft-Windows-Sysmon/Operational.evtx`.

## Windows Advanced Audit Policy

Sysmon is great but doesn't catch everything. **Security.evtx** is where Kerberos events (4768, 4769), logons (4624, 4625), and DCSync (4662) live. You need to explicitly enable it with `auditpol`:

```yaml
- name: Enable Account Logon auditing (4768-4776 Kerberos)
  ansible.windows.win_shell: |
    auditpol /set /subcategory:"Credential Validation" /success:enable /failure:enable
    auditpol /set /subcategory:"Kerberos Authentication Service" /success:enable /failure:enable
    auditpol /set /subcategory:"Kerberos Service Ticket Operations" /success:enable /failure:enable

- name: Enable DS Access (4662 — DCSync detection)
  ansible.windows.win_shell: |
    auditpol /set /subcategory:"Directory Service Access" /success:enable /failure:enable
    auditpol /set /subcategory:"Directory Service Changes" /success:enable /failure:enable
    auditpol /set /subcategory:"Directory Service Replication" /success:enable /failure:enable
```

Enabled categories (Success + Failure):

| Category | Key events |
|----------|------------|
| Account Logon | 4768 (TGT request), 4769 (TGS request), 4771, 4776 |
| Logon/Logoff | 4624 (success), 4625 (failure), 4634, 4647, 4648, 4672 (special) |
| Object Access | 5140/5145 (file share), 4656 (handle), 4663 (access) |
| **DS Access** | **4662 (DCSync detection)** |
| Detailed Tracking | 4688 (process creation), 4689 (termination) |
| Privilege Use | 4673, 4674 |
| Account Management | 4720-4738 (user changes), 4726 (delete) |
| Policy Change | 4719, 4907 |

### Command line in 4688

By default Event 4688 only records the executable name, not the arguments. For DFIR this is **useless** — you need to see what parameters the attacker used. Enabled via a registry key:

```yaml
- name: Enable command line in 4688
  ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit
    name: ProcessCreationIncludeCmdLine_Enabled
    data: 1
    type: dword
```

Without this you'd see `powershell.exe` but not `powershell.exe -enc SQBFAHgA...`. With this, you capture the full payload.

## PowerShell logging

Attackers use PowerShell for everything. Without PowerShell logging you lose half the artifacts of a modern incident. Three levels:

```yaml
# Script Block Logging — Event 4104 (the most important)
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging
    name: EnableScriptBlockLogging
    data: 1
    type: dword

# Module Logging — Event 4103 (all modules)
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging
    name: EnableModuleLogging
    data: 1
    type: dword

- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging\ModuleNames
    name: '*'
    data: '*'
    type: string

# Transcription — text files with everything typed
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription
    name: EnableTranscripting
    data: 1
    type: dword

- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription
    name: OutputDirectory
    data: 'C:\PSTranscripts'
    type: string
```

With this:
- **Event 4104**: any script block PowerShell executes (even Base64-obfuscated, it's decoded before being logged)
- **Event 4103**: every individual command from every module
- **Transcription**: text files in `C:\PSTranscripts` with the entire session

## Log sizing (important for limited disk)

The Hetzner server has 2×512 GB NVMe in RAID1, with ~310 GB free in the ZFS pool after creating all VMs. Logs can grow fast if we don't cap them.

**Conservative calculation (per-VM and total)**:

| Log | Per VM | Total 6 Windows |
|-----|--------|-----------------|
| Security | 512 MB | 3 GB |
| Sysmon | 512 MB | 3 GB |
| PowerShell Operational | 256 MB | 1.5 GB |
| WinRM Operational | 128 MB | 768 MB |
| WMI-Activity | 128 MB | 768 MB |
| TaskScheduler | 128 MB | 768 MB |
| **Windows subtotal** | **~1.6 GB** | **~10 GB** |
| Linux auditd | - | 600 MB |
| journald | - | 500 MB |
| **TOTAL** | | **~11 GB** |

With 310 GB free in ZFS, the safety ratio is ~28x. Comfortable.

```yaml
# Sizes applied with wevtutil
- ansible.windows.win_shell: wevtutil sl Security /ms:536870912
- ansible.windows.win_shell: wevtutil sl Microsoft-Windows-Sysmon/Operational /ms:536870912
- ansible.windows.win_shell: wevtutil sl Microsoft-Windows-PowerShell/Operational /ms:268435456
```

**Gotcha**: the initial sizes I set (1GB each) were excessive for a lab on a shared server. The first iteration could have reached ~24 GB of potential logs. Checking disk ratios before launching the attacks made me realize this and I reduced the values. **Always calculate the worst case before enabling full auditing in a disk-limited environment.**

## Linux: auditd with DFIR rules

For Ubuntu (LNX01), we use `auditd` with DFIR-focused rules, not compliance:

```
## ======= AUTHENTICATION =======
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k identity
-w /etc/sudoers.d/ -p wa -k identity

## ======= PROCESS EXECUTION =======
-a always,exit -F arch=b64 -S execve -k exec
-a always,exit -F arch=b32 -S execve -k exec

## ======= SUDO (uid != euid = escalated) =======
-a always,exit -F arch=b64 -S execve -C uid!=euid -F euid=0 -k sudo_exec

## ======= SSH =======
-w /etc/ssh/sshd_config -p wa -k sshd
-w /root/.ssh/ -p wa -k root_ssh

## ======= PRIVILEGE ESCALATION =======
-w /bin/su -p x -k priv_esc
-w /usr/bin/sudo -p x -k priv_esc
-w /usr/bin/pkexec -p x -k priv_esc

## ======= KERNEL MODULES =======
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules

## ======= SSSD / KERBEROS =======
-w /etc/sssd/ -p wa -k sssd
-w /etc/krb5.conf -p wa -k kerberos
-w /etc/krb5.keytab -p wa -k kerberos

## ======= CRON / SYSTEMD =======
-w /etc/cron.d/ -p wa -k cron
-w /etc/crontab -p wa -k cron
-w /var/spool/cron/ -p wa -k cron
-w /etc/systemd/ -p wa -k systemd
```

50 rules total, with keys for quick filtering:

```bash
# Search privileged executions
sudo ausearch -k sudo_exec --start recent

# Search /etc/passwd modifications
sudo ausearch -k identity

# Search SSSD authentication attempts
sudo ausearch -k sssd
```

### auditd size

Configured for 600MB total (200MB × 3 files) with automatic rotation:

```
max_log_file = 200
num_logs = 3
max_log_file_action = ROTATE
```

And **persistent journald** (survives reboots), capped at 500 MB:

```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
Storage=persistent
```

## Post-deployment verification

```bash
# Sysmon running on Windows
ansible -i goad/inventory dc01 -m win_shell -a '(Get-Service sysmon64).Status'
# Running

# Sysmon events already captured
ansible -i goad/inventory dc01 -m win_shell -a '(Get-WinEvent -ListLog Microsoft-Windows-Sysmon/Operational).RecordCount'
# 1660

# Audit policy active
ansible -i goad/inventory dc01 -m win_shell -a 'auditpol /get /category:* | Select-String "Success and Failure"'
# System Integrity         Success and Failure
# Logon                    Success and Failure
# Process Creation         Success and Failure
# ...

# auditd on Linux
ssh ubuntu@192.168.10.32 'sudo auditctl -l | wc -l'
# 50
```

All 7 domain machines are instrumented. When we launch the attacks in Phase 9, each technique will leave traces in the EVTX/logs that we can analyze later with tools like [masstin](https://github.com/jupyterj0nes/masstin).

---

*Next: Part 7 — Fire and Blood: Attack Scenarios and Forensic Analysis (coming soon)*

*Previous: [Part 5 — The Smallfolk: Users, Groups and Vulnerabilities]({% post_url en/2026-04-13-ad-dfir-lab-part5-users-vulns %})*
