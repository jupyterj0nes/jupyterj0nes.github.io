---
layout: post
title: "AD DFIR Lab — Part 4: Crowning the Domain Controllers — Active Directory con GOAD"
date: 2026-04-13 10:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part4
tags: [dfir, active-directory, goad, ansible, kerberos, lab]
description: "Desplegamos los dos forests del lab usando los playbooks de GOAD. DC01 promovido a sevenkingdoms.local, DC02 a north.sevenkingdoms.local (child), DC03 a essos.local (segundo forest) y un cross-forest trust bidireccional."
comments: true
---

*Esta es la Part 4 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Desplegamos toda la estructura de Active Directory: dos forests, un child domain, y el cross-forest trust.*

## Por qué GOAD

[GOAD (Game of Active Directory)](https://github.com/Orange-Cyberdefense/GOAD) de Orange Cyberdefense es **el** proyecto open source para entornos vulnerables de AD. Está testeado, mantenido y reproduce decenas de vulnerabilidades reales: AS-REP Roasting, Kerberoasting, ADCS ESC1-ESC8, abuso de ACLs, cross-forest trust attacks, MSSQL trusted links, etc.

¿Por qué no escribirlo nosotros desde cero? Porque ya está hecho y battle-tested por una empresa que vive de pentestear AD. Reinventar la rueda sería absurdo.

## El plan: usar los playbooks, ignorar el launcher

GOAD tiene un launcher Python (`goad.py`) que orquesta todo: provisiona VMs con Terraform/Vagrant para el provider que elijas (AWS, Azure, Proxmox, VMware...) y luego ejecuta los playbooks Ansible.

**Nosotros ya tenemos las VMs**, así que **saltamos el launcher** y usamos los playbooks directamente con un inventory custom apuntando a nuestras IPs. Más rápido y con más control.

## Adaptar las IPs

GOAD upstream usa IPs específicas:

| Host | IP GOAD | IP nuestra (antes) |
|------|---------|-------------------|
| dc01 (kingslanding) | 192.168.10.10 | 192.168.10.10 ✓ |
| dc02 (winterfell) | 192.168.10.11 | 192.168.10.11 ✓ |
| dc03 (meereen) | 192.168.10.12 | 192.168.10.13 ✗ |
| srv02 (castelblack) | 192.168.10.22 | 192.168.10.12 ✗ |
| srv03 (braavos) | 192.168.10.23 | 192.168.10.14 ✗ |
| ws01 (highgarden) | 192.168.10.31 | 192.168.10.20 ✗ |
| lx01 (oldtown) | 192.168.10.32 | DHCP ✗ |

Tres habíamos puesto mal y dos eran extras de las extensiones de GOAD que no conocíamos. Solución: **renumerar nuestras VMs para que coincidan con GOAD upstream**. Así no tocamos un solo archivo de GOAD.

```bash
# Reconfigurar IPs via guest agent (ejemplo)
qm guest exec 103 -- powershell -Command '
    $a = Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object -First 1
    Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 | Remove-NetIPAddress -Confirm:$false
    Remove-NetRoute -InterfaceIndex $a.ifIndex -Confirm:$false
    New-NetIPAddress -InterfaceIndex $a.ifIndex -IPAddress 192.168.10.22 -PrefixLength 24 -DefaultGateway 192.168.10.1
'
```

**Gotcha**: si el IP nuevo usa el mismo gateway que el viejo, `New-NetIPAddress` falla con "Instance DefaultGateway already exists". Hay que borrar la ruta antes con `Remove-NetRoute`.

## Inventory adaptado

GOAD's playbooks asumen muchos grupos específicos en el inventory: `parent_dc`, `child_dc`, `dc`, `iis`, `mssql`, `adcs`, `trust`, `defender_on/off`, `update`, `no_update`, `laps_*`, etc. Si te falta alguno, los playbooks "saltan" silenciosamente sin ejecutar lo que toca.

La solución limpia: copiar los grupos completos de `/root/GOAD/ad/GOAD/data/inventory` y solo override las connection vars con las nuestras:

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

# === Grupos GOAD (de ad/GOAD/data/inventory) ===
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

# ... y muchos más
```

## El problema del DNS antes de tener DNS

`build.yml` —el primer playbook— necesita instalar `NuGet` desde la PowerShell Gallery. Falla con:

```
Install-PackageProvider : No match was found for the specified search criteria
for the provider 'NuGet'. The package provider requires 'PackageManagement'
and 'Provider' tags.
```

¿Por qué? Las VMs tienen como DNS `192.168.10.10` (DC01), pero **DC01 todavía no es servidor DNS** — eso lo configura `ad-parent_domain.yml`. Sin DNS funcional, las VMs no pueden resolver `powershellgallery.com` ni descargar nada.

**Fix**: poner 8.8.8.8 como DNS temporal en todas las VMs Windows. GOAD ya cambiará el DNS más tarde cuando promueva los DCs:

```bash
for VMID in 101 102 103 104 105 106; do
    qm guest exec $VMID -- powershell -Command '
        Set-DnsClientServerAddress -InterfaceIndex (Get-NetAdapter |
            Where-Object { $_.Status -eq "Up" } | Select -First 1).ifIndex `
            -ServerAddresses 8.8.8.8,1.1.1.1
    '
done
```

Y en el inventory: `force_dns_server=no` para que GOAD no nos lo resetee.

## La cadena de playbooks

Para la lab "GOAD" (la completa con dos forests + child + trust), el orden es:

```
1.  build.yml          — common settings, keyboard, DNS
2.  ad-servers.yml     — hostname/timezone setup
3.  ad-parent_domain.yml — promueve DC01 + DC03 a Domain Controllers
4.  ad-child_domain.yml  — promueve DC02 como child de sevenkingdoms.local
5.  wait5m.yml         — espera replicación del child domain
6.  ad-members.yml     — une SRV02 y SRV03 a sus dominios
7.  ad-trusts.yml      — establece cross-forest trust
8.  ad-data.yml        — crea usuarios, grupos, OUs (los Stark, Targaryen, etc.)
9.  ad-gmsa.yml        — Group Managed Service Accounts
10. laps.yml           — LAPS
11. ad-relations.yml   — group memberships
12. adcs.yml           — Active Directory Certificate Services con templates vulnerables
13. ad-acl.yml         — ACLs abusables (DCSync paths, GenericAll, etc.)
14. servers.yml        — IIS, MSSQL, file shares
15. security.yml       — Defender configuration
16. vulnerabilities.yml — configuración vulnerable final
```

Cada uno se lanza con:
```bash
ansible-playbook -i /root/lab/goad/inventory build.yml
```

## Snapshots durante el deploy

Antes de cada playbook crítico, snapshot ZFS para poder revertir si algo se rompe:

```bash
for VMID in 100 101 102 103 104 105 106 107 108; do
    qm snapshot $VMID parent-domains-up \
        --description "After ad-parent_domain.yml: 2 forests created"
done
```

ZFS snapshots son instantáneos y prácticamente gratis en espacio (hasta que cambia mucho el contenido). Si el siguiente playbook rompe algo, `qm rollback` y vuelves al estado anterior en segundos.

## Resultado tras los primeros 6 playbooks

Después de `build.yml` → `ad-trusts.yml`:

```powershell
# En DC01 (kingslanding)
PS> (Get-WmiObject Win32_ComputerSystem).Domain
sevenkingdoms.local

# En DC03 (meereen)  
PS> (Get-WmiObject Win32_ComputerSystem).Domain
essos.local

# En DC02 (winterfell)
PS> (Get-WmiObject Win32_ComputerSystem).Domain
north.sevenkingdoms.local

# Trust verificado
PS> Get-ADTrust -Filter *
Name: essos.local
Direction: BiDirectional
Source: sevenkingdoms.local
Target: essos.local
TrustType: Forest
```

**Estructura completa de AD operativa**:

```
Forest 1: sevenkingdoms.local
├── sevenkingdoms.local
│   └── DC01 (kingslanding) — Root DC, ADCS pendiente
└── north.sevenkingdoms.local
    ├── DC02 (winterfell) — Child DC
    └── SRV02 (castelblack) — member server

Forest 2: essos.local
└── essos.local
    ├── DC03 (meereen) — Root DC
    └── SRV03 (braavos) — member server

         ↕ Cross-forest trust ↕
```

Quedan los playbooks de datos (`ad-data.yml`, `ad-relations.yml`, `ad-acl.yml`) que crean a Jon Snow, Sansa Stark, Daenerys, Brandon Stark y demás personajes con sus passwords débiles intencionales y ACLs abusables. Y luego `adcs.yml`, `servers.yml`, `vulnerabilities.yml` para terminar la configuración vulnerable.

---

*Siguiente: Part 5 — The Smallfolk: Users, Groups, Shares and Vulnerabilities (próximamente)*

*Anterior: [Part 3 — Beyond the Wall: pfSense, VLANs and Network Segmentation]({% post_url es/2026-04-12-ad-dfir-lab-part3-pfsense %})*
