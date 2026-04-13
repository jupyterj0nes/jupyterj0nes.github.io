---
layout: post
title: "AD DFIR Lab — Part 5: The Smallfolk — Users, Groups and Vulnerabilities in GOAD"
date: 2026-04-13 11:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part5
tags: [dfir, active-directory, goad, kerberoasting, asrep, adcs, acl, lab]
description: "Complete catalog of the lab: 46 users across 3 domains, hierarchical groups, and the intentional pre-built vulnerabilities — AS-REP Roasting, Kerberoasting, delegation, abusable ACLs, ADCS ESC1-ESC13, MSSQL linked servers and more."
comments: true
---

*This is Part 5 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We catalog everything GOAD creates inside the domains: users, groups, vulnerabilities, and how they fit together to form realistic attack chains.*

## The population of the Seven Kingdoms

After GOAD's 16 playbooks we have **46 users** spread across three domains. They're not random users — each has a specific role in the attack chains.

### sevenkingdoms.local (forest root — Lannisters, Baratheons, and advisors)

| User | Group | Attack role |
|------|-------|-------------|
| `tywin.lannister` | Lannister | Lannister patriarch |
| `jaime.lannister` | Lannister | Kingsguard |
| `cersei.lannister` | Lannister | Queen |
| `tyron.lannister` | Lannister | Hand |
| `robert.baratheon` | Baratheon | King |
| `joffrey.baratheon` | Baratheon | Prince |
| `renly.baratheon` | Baratheon | Brother |
| `stannis.baratheon` | Baratheon | Brother |
| `petyer.baelish` | Smallcouncil | Master of Coin |
| `lord.varys` | Smallcouncil | Master of Whispers |
| `maester.pycelle` | Smallcouncil | Grand Maester |

### north.sevenkingdoms.local (child domain — House Stark and Night's Watch)

| User | Group(s) | Notes |
|------|----------|-------|
| `eddard.stark` | Stark | Head of House. **LSA Secrets** on winterfell (`FightP3aceAndHonor!`) |
| `catelyn.stark` | Stark | |
| `robb.stark` | Stark | **LSA Secrets** on winterfell (`sexywolfy`) — scheduled task `responder_bot` |
| `sansa.stark` | Stark | **Kerberoastable** (SPN `HTTP/eyrie.north.sevenkingdoms.local`) |
| `arya.stark` | Stark | |
| `brandon.stark` | Stark | **AS-REP Roastable** (`DoesNotRequirePreAuth=True`) |
| `rickon.stark` | Stark | |
| `hodor` | Stark | "Brainless Giant" |
| `jon.snow` | Stark, Night Watch | **Kerberoastable** (SPN `CIFS/thewall`, `HTTP/thewall`). **Constrained delegation** to winterfell |
| `samwell.tarly` | Night Watch | Password in description: `Heartsbane`. Delegated permissions on GPO `StarkWallpaper` |
| `jeor.mormont` | Night Watch, Mormont | Local admin on castelblack. `_L0ngCl@w_` in SYSVOL script.ps1 |
| `sql_svc` | (service) | **Kerberoastable** (MSSQLSvc on castelblack) |

### essos.local (second forest — Targaryens and Dothraki)

| User | Role |
|------|------|
| `daenerys.targaryen` | Queen across the narrow sea |
| `viserys.targaryen` | Brother |
| `khal.drogo` | Khal |
| `jorah.mormont` | Exiled knight |
| `missandei` | Advisor. **AS-REP Roastable** |
| `drogon` | Dragon (service account) |
| `sql_svc` | **Kerberoastable** (MSSQLSvc on braavos) |

## Notable groups

**sevenkingdoms.local**:
- `Lannister` — tywin, jaime, cersei, tyron
- `Baratheon` — robert, joffrey, renly, stannis
- `Smallcouncil` — baelish, varys, pycelle

**north.sevenkingdoms.local**:
- `Stark` — all Starks + jon.snow
- `Night Watch` — jon.snow, samwell.tarly, jeor.mormont
- `Mormont` — jeor.mormont
- `AcrossTheSea` — (used in SID history attacks toward essos)

**essos.local**:
- `Targaryen` — daenerys, viserys
- `Dothraki` — khal.drogo
- `Unsullied` — (Daenerys's army)

## Catalog of vulnerabilities

### 1. Kerberos: AS-REP Roasting

Users with `DoesNotRequirePreAuth=True` allow an unauthenticated attacker to request an AS-REP ticket containing material encrypted with the user's NTLM hash. That material is crackable offline with hashcat.

| Domain | User |
|--------|------|
| north.sevenkingdoms.local | **brandon.stark** |
| essos.local | **missandei** |

**Attack (from Kali)**:
```bash
impacket-GetNPUsers north.sevenkingdoms.local/ -usersfile users.txt -no-pass -dc-ip 192.168.10.11
hashcat -m 18200 hashes.txt rockyou.txt
```

### 2. Kerberos: Kerberoasting

User accounts with SPNs allow requesting Service Tickets encrypted with the user's password hash (not the machine account). Crackable offline.

| Domain | User | SPN |
|--------|------|-----|
| north | **sansa.stark** | `HTTP/eyrie.north.sevenkingdoms.local` |
| north | **jon.snow** | `CIFS/thewall.north...`, `HTTP/thewall.north...` |
| north | **sql_svc** | `MSSQLSvc/castelblack.north...` (x2) |
| essos | **sql_svc** | `MSSQLSvc/braavos.essos.local` (x2) |

**Attack**:
```bash
impacket-GetUserSPNs -request -dc-ip 192.168.10.11 north.sevenkingdoms.local/brandon.stark:Password
hashcat -m 13100 hashes.txt rockyou.txt
```

### 3. Delegation

**Unconstrained delegation**: `WINTERFELL$` (the DC02 computer account) has `TrustedForDelegation=True`. Any service ticket sent to this DC is storable and reusable.

**Constrained delegation**:
- `jon.snow` → `CIFS/winterfell` (can impersonate any user to the DC's CIFS share)
- `CASTELBLACK$` → `HTTP/winterfell` (the castelblack computer can impersonate toward the DC's HTTP)

### 4. Abusable ACLs (GenericAll / WriteDacl / DCSync paths)

GOAD creates several ACL abuse chains. To verify with BloodHound:

```bash
bloodhound-python -d sevenkingdoms.local -u brandon.stark -p Password \
    -ns 192.168.10.11 -c all --zip
```

Then in BloodHound, mark the users as "Owned" and run the **"Shortest Path from Owned"** query to **"Domain Admins"**.

### 5. ADCS ESC1-ESC13

GOAD installs Active Directory Certificate Services on DC01 and SRV03, and adds **vulnerable templates** on DC03 (`essos.local`):

| Template | Vulnerability |
|----------|---------------|
| **ESC1** | Subject Alternative Name spoofing — any authenticated user can request a cert "impersonating" another user |
| **ESC2** | Any Purpose EKU — cert usable for any purpose, including authentication |
| **ESC3** | Certificate Request Agent — allows requesting certs on behalf of other users |
| **ESC3-CRA** | ESC3 + Certificate Request Agent |
| **ESC4** | Vulnerable template ACL — allows modifying the template |
| **ESC9** | No Security Extension — cert doesn't include the user's SID, allows spoofing |
| **ESC13** | Issuance Policies linked to AD groups |

**Enumeration with Certipy**:
```bash
certipy find -u brandon.stark@north.sevenkingdoms.local -p Password \
    -dc-ip 192.168.10.12 -vulnerable -stdout
```

### 6. MSSQL linked servers (cross-forest)

`SRV02` (castelblack, forest 1) has a **linked server** to `BRAAVOS` (forest 2). Allows pivoting via MSSQL from one forest to the other without needing an explicit computer-level trust.

**Attack chain**:
```sql
-- From SQL Server on castelblack
EXEC ('SELECT @@VERSION') AT [BRAAVOS]

-- Enable xp_cmdshell on braavos through the linked server
EXEC ('EXEC sp_configure ''show advanced options'', 1; RECONFIGURE;
       EXEC sp_configure ''xp_cmdshell'', 1; RECONFIGURE;') AT [BRAAVOS]

-- Execute commands on braavos
EXEC ('EXEC xp_cmdshell ''whoami''') AT [BRAAVOS]
```

### 7. Credentials in SYSVOL

GOAD creates two scripts in the `north.sevenkingdoms.local` SYSVOL share with hardcoded credentials:

**`\\winterfell\SYSVOL\north.sevenkingdoms.local\scripts\script.ps1`**:
```powershell
# fake script in netlogon with creds
$task = '/c TODO'
$taskName = "fake task"
$user = "NORTH\jeor.mormont"
$password = "_L0ngCl@w_"
# passwords in sysvol still ...
```

**`\\winterfell\SYSVOL\north.sevenkingdoms.local\scripts\secret.ps1`**: contains an encrypted secret with the encryption key right next to it (classic "keep the key next to the lock" mistake).

### 8. GPP passwords (MS14-025) — bonus

We manually added (since GOAD doesn't include it) a "Corporate Local Admins" GPO with a Groups.xml containing a classic `cpassword`. Decodable with `gpp-decrypt` to `Password123!`.

**Path**: `\\kingslanding\SYSVOL\sevenkingdoms.local\Policies\{GUID}\Machine\Preferences\Groups\Groups.xml`

### 9. Scheduled tasks with cached credentials (LSA Secrets)

Two scheduled tasks on winterfell store credentials in LSA Secrets, extractable with mimikatz (`privilege::debug; lsadump::secrets`):

| Task | User | Password |
|------|------|----------|
| `responder_bot` | north\robb.stark | `sexywolfy` |
| `ntlm_bot` | north\eddard.stark | `FightP3aceAndHonor!` |

### 10. Cross-forest trust abuse

Bidirectional trust between `sevenkingdoms.local` ↔ `essos.local`. Allows:
- Enumerating objects in the other forest
- Cross-realm Kerberos service ticket
- SID History injection (if you get admin on one side)

### 11. IIS + WebDAV + ASP upload

`SRV02` has IIS installed with a vulnerable website that allows ASP file upload. Useful for web shell testing.

### 12. GPO abuse

The `StarkWallpaper` GPO exists on `north.sevenkingdoms.local` and **`samwell.tarly` has modify permissions** on it. An attacker with access to samwell can add tasks to the GPO that execute on all domain computers.

## Accounts with known passwords

To ease teaching attacks, GOAD sets predictable passwords. The listed users have passwords that appear in `rockyou.txt` or are obvious derivatives:

| User | Known password |
|------|----------------|
| `robb.stark` | `sexywolfy` |
| `eddard.stark` | `FightP3aceAndHonor!` |
| `samwell.tarly` | `Heartsbane` (in description) |
| `jeor.mormont` | `_L0ngCl@w_` |
| sevenkingdoms domain admin | `8dCT-DJjgScp` |
| north domain admin | `NgtI75cKV+Pu` |
| essos domain admin | `Ufe-bVXSx9rk` |

Others have strong random passwords and are designed to be found via the attacks (Kerberoasting, AS-REP, etc.).

## Typical attack chains

**Scenario 1 — Unauth → Domain Admin (Kerberos only)**:
1. AS-REP roast `brandon.stark` (no credentials needed) → password
2. With brandon.stark, Kerberoast `jon.snow` → password
3. With jon.snow, abuse constrained delegation S4U2Self+S4U2Proxy → TGS as Administrator to CIFS/winterfell
4. Access as admin to DC02 → DCSync → entire domain

**Scenario 2 — Cross-forest MSSQL pivot**:
1. Compromise web shell on SRV02 (IIS + ASP upload)
2. Pivot to local MSSQL on castelblack (jon.snow is sysadmin)
3. Use linked server to BRAAVOS (essos.local)
4. Execute xp_cmdshell on braavos → access to the second forest

**Scenario 3 — ADCS ESC1**:
1. Any authenticated user on essos.local
2. Enumerate with Certipy → detect ESC1 template
3. Request cert with `-upn administrator@essos.local`
4. Authenticate with the cert → administrator ticket
5. DCSync essos.local

## Lab verification

All of this has been verified with real commands in the lab. For example, the Stark group:

```powershell
PS C:\> Get-ADGroupMember -Identity Stark
Name          objectClass
----          -----------
arya.stark    user
eddard.stark  user
catelyn.stark user
robb.stark    user
sansa.stark   user
brandon.stark user
rickon.stark  user
hodor         user
jon.snow      user
```

---

*Next: Part 6 — The Watchers on the Wall: audit configuration with Sysmon (coming soon)*

*Previous: [Part 4 — Crowning the Domain Controllers: AD with GOAD]({% post_url en/2026-04-13-ad-dfir-lab-part4-goad %})*
