---
layout: post
title: "AD DFIR Lab — Part 5: The Smallfolk — Usuarios, grupos y vulnerabilidades en GOAD"
date: 2026-04-13 11:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part5
tags: [dfir, active-directory, goad, kerberoasting, asrep, adcs, acl, lab]
description: "Catálogo completo del lab: 46 usuarios repartidos en 3 dominios, grupos jerárquicos, y las vulnerabilidades intencionales preconfiguradas — AS-REP Roasting, Kerberoasting, delegación, ACLs abusables, ADCS ESC1-ESC13, MSSQL linked servers y más."
comments: true
---

*Esta es la Part 5 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Catalogamos todo lo que GOAD crea dentro de los dominios: usuarios, grupos, vulnerabilidades, y cómo encajan unos con otros para formar cadenas de ataque realistas.*

## La población de los Siete Reinos

Tras los 16 playbooks de GOAD tenemos **46 usuarios** repartidos en tres dominios. No son usuarios aleatorios — cada uno tiene un rol específico en las cadenas de ataque.

### sevenkingdoms.local (forest root — Lannisters, Baratheons y consejeros)

| Usuario | Grupo | Rol en ataques |
|---------|-------|----------------|
| `tywin.lannister` | Lannister | Patriarca de los Lannister |
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

### north.sevenkingdoms.local (child domain — House Stark y Night's Watch)

| Usuario | Grupo(s) | Observaciones |
|---------|----------|---------------|
| `eddard.stark` | Stark | Cabeza de familia. **LSA Secrets** en winterfell (`FightP3aceAndHonor!`) |
| `catelyn.stark` | Stark | |
| `robb.stark` | Stark | **LSA Secrets** en winterfell (`sexywolfy`) — scheduled task `responder_bot` |
| `sansa.stark` | Stark | **Kerberoastable** (SPN `HTTP/eyrie.north.sevenkingdoms.local`) |
| `arya.stark` | Stark | |
| `brandon.stark` | Stark | **AS-REP Roastable** (`DoesNotRequirePreAuth=True`) |
| `rickon.stark` | Stark | |
| `hodor` | Stark | "Brainless Giant" |
| `jon.snow` | Stark, Night Watch | **Kerberoastable** (SPN `CIFS/thewall`, `HTTP/thewall`). **Constrained delegation** a winterfell |
| `samwell.tarly` | Night Watch | Password en su description: `Heartsbane`. Permisos delegados en GPO `StarkWallpaper` |
| `jeor.mormont` | Night Watch, Mormont | Local admin en castelblack. `_L0ngCl@w_` en SYSVOL script.ps1 |
| `sql_svc` | (service) | **Kerberoastable** (MSSQLSvc en castelblack) |

### essos.local (segundo forest — Targaryens y Dothraki)

| Usuario | Rol |
|---------|-----|
| `daenerys.targaryen` | Queen across the narrow sea |
| `viserys.targaryen` | Brother |
| `khal.drogo` | Khal |
| `jorah.mormont` | Exiled knight |
| `missandei` | Advisor. **AS-REP Roastable** |
| `drogon` | Dragon (service account) |
| `sql_svc` | **Kerberoastable** (MSSQLSvc en braavos) |

## Grupos destacados

**sevenkingdoms.local**:
- `Lannister` — tywin, jaime, cersei, tyron
- `Baratheon` — robert, joffrey, renly, stannis
- `Smallcouncil` — baelish, varys, pycelle

**north.sevenkingdoms.local**:
- `Stark` — todos los Stark + jon.snow
- `Night Watch` — jon.snow, samwell.tarly, jeor.mormont
- `Mormont` — jeor.mormont
- `AcrossTheSea` — (usado en ataques de SID history hacia essos)

**essos.local**:
- `Targaryen` — daenerys, viserys
- `Dothraki` — khal.drogo
- `Unsullied` — (ejército de Daenerys)

## Vulnerabilidades catalogadas

### 1. Kerberos: AS-REP Roasting

Usuarios con `DoesNotRequirePreAuth=True` permiten a un atacante no autenticado solicitar un AS-REP ticket que contiene material cifrado con el hash NTLM del usuario. Ese material es crackeable offline con hashcat.

| Domain | Usuario |
|--------|---------|
| north.sevenkingdoms.local | **brandon.stark** |
| essos.local | **missandei** |

**Comando de ataque (desde Kali)**:
```bash
impacket-GetNPUsers north.sevenkingdoms.local/ -usersfile users.txt -no-pass -dc-ip 192.168.10.11
hashcat -m 18200 hashes.txt rockyou.txt
```

### 2. Kerberos: Kerberoasting

Cuentas de usuario con SPNs permiten solicitar Service Tickets cifrados con el hash del password del usuario (no de la máquina). Crackeable offline.

| Domain | Usuario | SPN |
|--------|---------|-----|
| north | **sansa.stark** | `HTTP/eyrie.north.sevenkingdoms.local` |
| north | **jon.snow** | `CIFS/thewall.north...`, `HTTP/thewall.north...` |
| north | **sql_svc** | `MSSQLSvc/castelblack.north...` (x2) |
| essos | **sql_svc** | `MSSQLSvc/braavos.essos.local` (x2) |

**Comando de ataque**:
```bash
impacket-GetUserSPNs -request -dc-ip 192.168.10.11 north.sevenkingdoms.local/brandon.stark:Password
hashcat -m 13100 hashes.txt rockyou.txt
```

### 3. Delegación

**Unconstrained delegation**: `WINTERFELL$` (la propia cuenta de computer del DC02) tiene `TrustedForDelegation=True`. Cualquier ticket de servicio enviado a este DC es almacenable y reutilizable.

**Constrained delegation**:
- `jon.snow` → `CIFS/winterfell` (puede impersonar cualquier usuario hacia el share CIFS del DC)
- `CASTELBLACK$` → `HTTP/winterfell` (el computer castelblack puede impersonar hacia HTTP del DC)

### 4. ACLs abusables (GenericAll / WriteDacl / DCSync paths)

GOAD crea varias cadenas de abuso de ACLs. Para verificarlas con BloodHound:

```bash
bloodhound-python -d sevenkingdoms.local -u brandon.stark -p Password \
    -ns 192.168.10.11 -c all --zip
```

Y en BloodHound, marcar los usuarios como "Owned" y ejecutar el query **"Shortest Path from Owned"** hacia **"Domain Admins"**.

### 5. ADCS ESC1-ESC13

GOAD instala Active Directory Certificate Services en DC01 y SRV03, y añade **templates vulnerables** en DC03 (`essos.local`):

| Template | Vulnerabilidad |
|----------|----------------|
| **ESC1** | Subject Alternative Name spoofing — cualquier usuario autenticado puede pedir un cert "suplantando" a otro usuario |
| **ESC2** | Any Purpose EKU — cert usable para cualquier fin, incluyendo autenticación |
| **ESC3** | Certificate Request Agent — permite pedir certs en nombre de otros usuarios |
| **ESC3-CRA** | ESC3 + Certificate Request Agent |
| **ESC4** | Template ACL vulnerable — permite modificar la plantilla |
| **ESC9** | No Security Extension — el cert no incluye el SID del usuario, permite spoofing |
| **ESC13** | Issuance Policies vinculadas a grupos AD |

**Enumeración con Certipy**:
```bash
certipy find -u brandon.stark@north.sevenkingdoms.local -p Password \
    -dc-ip 192.168.10.12 -vulnerable -stdout
```

### 6. MSSQL linked servers (cross-forest)

`SRV02` (castelblack, forest 1) tiene un **linked server** hacia `BRAAVOS` (forest 2). Permite pivotar via MSSQL desde un forest al otro sin necesitar un trust explícito a nivel de computer.

**Cadena de ataque**:
```sql
-- Desde SQL Server en castelblack
EXEC ('SELECT @@VERSION') AT [BRAAVOS]

-- Habilitar xp_cmdshell en braavos a través del linked server
EXEC ('EXEC sp_configure ''show advanced options'', 1; RECONFIGURE;
       EXEC sp_configure ''xp_cmdshell'', 1; RECONFIGURE;') AT [BRAAVOS]

-- Ejecutar comandos en braavos
EXEC ('EXEC xp_cmdshell ''whoami''') AT [BRAAVOS]
```

### 7. Credentials en SYSVOL

GOAD crea dos scripts en el share SYSVOL de `north.sevenkingdoms.local` con credenciales hardcoded:

**`\\winterfell\SYSVOL\north.sevenkingdoms.local\scripts\script.ps1`**:
```powershell
# fake script in netlogon with creds
$task = '/c TODO'
$taskName = "fake task"
$user = "NORTH\jeor.mormont"
$password = "_L0ngCl@w_"
# passwords in sysvol still ...
```

**`\\winterfell\SYSVOL\north.sevenkingdoms.local\scripts\secret.ps1`**: contiene un secreto cifrado con una clave de cifrado al lado (fallo clásico de "guardar la llave junto al candado").

### 8. GPP passwords (MS14-025) — bonus

Añadimos manualmente (ya que GOAD no lo incluye) una GPO "Corporate Local Admins" con Groups.xml conteniendo un `cpassword` clásico. Decodificable con `gpp-decrypt` a `Password123!`.

**Ruta**: `\\kingslanding\SYSVOL\sevenkingdoms.local\Policies\{GUID}\Machine\Preferences\Groups\Groups.xml`

### 9. Scheduled tasks con credenciales cacheadas (LSA Secrets)

Dos scheduled tasks en winterfell almacenan credenciales en LSA Secrets, extraíbles con mimikatz (`privilege::debug; lsadump::secrets`):

| Task | Usuario | Password |
|------|---------|----------|
| `responder_bot` | north\robb.stark | `sexywolfy` |
| `ntlm_bot` | north\eddard.stark | `FightP3aceAndHonor!` |

### 10. Cross-forest trust abuse

Trust bidireccional entre `sevenkingdoms.local` ↔ `essos.local`. Permite:
- Enumerar objetos del otro forest
- Kerberos service ticket cross-realm
- SID History injection (si se consigue admin de un lado)

### 11. IIS + WebDAV + ASP upload

`SRV02` tiene IIS instalado con un website vulnerable que permite upload de archivos ASP. Útil para pruebas de web shell.

### 12. GPO abuse

La GPO `StarkWallpaper` existe en `north.sevenkingdoms.local` y **`samwell.tarly` tiene permisos de modificación** sobre ella. Un atacante con acceso a samwell puede añadir tareas a la GPO que se ejecuten en todos los equipos del dominio.

## Cuentas con passwords conocidos

Para facilitar los ataques didácticos, GOAD establece passwords predecibles. Los usuarios listados tienen passwords que aparecen en `rockyou.txt` o son derivados obvios:

| Usuario | Password conocido |
|---------|-------------------|
| `robb.stark` | `sexywolfy` |
| `eddard.stark` | `FightP3aceAndHonor!` |
| `samwell.tarly` | `Heartsbane` (en description) |
| `jeor.mormont` | `_L0ngCl@w_` |
| Domain admin sevenkingdoms | `8dCT-DJjgScp` |
| Domain admin north | `NgtI75cKV+Pu` |
| Domain admin essos | `Ufe-bVXSx9rk` |

El resto tienen passwords random fuertes y están diseñados para ser encontrados mediante los ataques (Kerberoasting, AS-REP, etc.).

## Cadenas de ataque típicas

**Escenario 1 — Unauth → Domain Admin (solo Kerberos)**:
1. AS-REP roast `brandon.stark` (sin credenciales) → password
2. Con brandon.stark, Kerberoast `jon.snow` → password
3. Con jon.snow, abusar constrained delegation S4U2Self+S4U2Proxy → TGS como Administrator hacia CIFS/winterfell
4. Acceso como admin al DC2 → DCSync → dominio entero

**Escenario 2 — Cross-forest MSSQL pivot**:
1. Comprometer web shell en SRV02 (IIS + ASP upload)
2. Pivotar a MSSQL local en castelblack (jon.snow es sysadmin)
3. Usar linked server a BRAAVOS (essos.local)
4. Ejecutar xp_cmdshell en braavos → acceso al segundo forest

**Escenario 3 — ADCS ESC1**:
1. Cualquier usuario autenticado en essos.local
2. Enumerar con Certipy → detectar template ESC1
3. Pedir cert con `-upn administrator@essos.local`
4. Autenticar con el cert → ticket de administrator
5. DCSync essos.local

## Verificación en el lab

Todo esto se ha verificado con comandos reales en el lab. Por ejemplo, el grupo Stark:

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

*Siguiente: Part 6 — The Watchers on the Wall: audit configuration with Sysmon (próximamente)*

*Anterior: [Part 4 — Crowning the Domain Controllers: AD with GOAD]({% post_url es/2026-04-13-ad-dfir-lab-part4-goad %})*
