---
layout: post
title: "The Iron Throne of DFIR — Construyendo un laboratorio de Active Directory para entrenamiento forense"
date: 2026-04-12 10:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-intro
tags: [dfir, active-directory, lab, proxmox, goad, hetzner, forense]
description: "Serie completa sobre cómo montar un laboratorio de Active Directory con dos forests, nueve máquinas virtuales, vulnerabilidades preconfiguradas y auditoría avanzada — todo automatizado sobre un servidor dedicado Hetzner por 38 EUR/mes."
comments: true
---

## Por qué necesitas un laboratorio de AD para DFIR

Si trabajas en respuesta ante incidentes o forense digital, sabes que el 90% de los ataques que investigas ocurren en entornos de Active Directory. Kerberoasting, lateral movement con PsExec, DCSync, abuso de ADCS — los ves constantemente en los casos reales. Pero ¿dónde practicas?

Las certificaciones te dan escenarios de laboratorio limitados. Las plataformas online tienen entornos compartidos y restricciones. Lo que necesitas es **tu propio laboratorio**, con tu propio dominio, tus propios usuarios, tu propio ruido de red — y la capacidad de atacarlo, exportar las imágenes forenses y analizarlas exactamente como harías en un caso real.

## Qué vamos a construir

Un entorno completo de Active Directory inspirado en [GOAD (Game of Active Directory)](https://github.com/Orange-Cyberdefense/GOAD) de Orange Cyberdefense, con temática de Juego de Tronos:

```
Hetzner AX41-NVMe (Ryzen 5 3600, 64 GB RAM, 2x512 GB NVMe) — 38 EUR/mes

VLAN 10 — Red corporativa (192.168.10.0/24)
  DC01  kingslanding   Win Server 2019   Root DC, ADCS, DNS, DHCP
  DC02  winterfell     Win Server 2019   Child domain: north.sevenkingdoms.local
  SRV02 castelblack    Win Server 2019   IIS, MSSQL, file shares, WinRM
  DC03  meereen        Win Server 2016   Segundo forest: essos.local
  SRV03 braavos        Win Server 2016   Cross-forest trust
  WS01  highgarden     Windows 10        Workstation del dominio
  LNX01 oldtown        Ubuntu 22.04      SSSD + autenticación contra AD

VLAN 20 — Red de ataque (192.168.20.0/24)
  KALI  nightking      Kali Linux        Impacket, BloodHound, Certipy, Rubeus...

pfSense como firewall entre VLANs — Kali tiene que pivotar, como en un pentest real.
```

Dos forests con trust bidireccional. Tres dominios. Nueve máquinas virtuales. Más de 2.500 usuarios generados con BadBlood. Vulnerabilidades preconfiguradas que incluyen AS-REP Roasting, Kerberoasting, delegación, ADCS ESC1-ESC8, abuso de ACLs y mucho más.

## El flujo DFIR completo

Lo que hace especial este laboratorio no es solo el entorno vulnerable — es el ciclo completo de investigación:

1. **Generar ruido de línea base** — 24 horas de actividad corporativa realista antes de cualquier ataque
2. **Snapshot** del estado limpio
3. **Ejecutar un escenario de ataque** desde Kali (automatizado o manual)
4. **Exportar imágenes forenses** (VMDK, raw) de las máquinas comprometidas
5. **Analizar con tus herramientas** — masstin, Volatility, plaso, lo que prefieras
6. **Revertir** al estado limpio y repetir con otro escenario

Cada escenario de ataque genera artefactos específicos que puedes buscar: eventos 4624, 4769, 4662, Sysmon event 1 con command lines completos, PowerShell script blocks en 4104...

## La serie

Todo el proceso está automatizado con scripts y documentado paso a paso:

| Parte | Título | Contenido |
|-------|--------|-----------|
| **Part 1** | [From Bare Metal to Proxmox]({% post_url es/2026-04-12-ad-dfir-lab-part1-proxmox %}) | Servidor Hetzner, rescue system, instalar Proxmox VE con ZFS |
| **Part 2** | [The Seven Kingdoms — Deploying Windows VMs]({% post_url es/2026-04-12-ad-dfir-lab-part2-windows-vms %}) | Crear VMs, autounattend, VirtIO drivers |
| **Part 3** | [Beyond the Wall — pfSense, VLANs and Network Segmentation]({% post_url es/2026-04-12-ad-dfir-lab-part3-pfsense %}) | pfSense, VLAN 10/20, NAT, WireGuard |
| **Part 4** | [Crowning the Domain Controllers — AD, Forests and Trusts]({% post_url es/2026-04-13-ad-dfir-lab-part4-goad %}) | GOAD, dominios, forests, cross-trust |
| **Part 5** | [The Smallfolk — Users, Groups and Vulnerabilities]({% post_url es/2026-04-13-ad-dfir-lab-part5-users-vulns %}) | Catálogo de usuarios, grupos, AS-REP, Kerberoast, ADCS, ACLs |
| **Part 6** | [Ravens and Whispers — Audit Configuration]({% post_url es/2026-04-13-ad-dfir-lab-part6-audit %}) | Sysmon, audit policy, PowerShell logging, auditd |
| **Part 7** | The Night King Rises — Kali as Attack Platform | Herramientas ofensivas, configuración |
| **Part 8** | A Day in the Realm — Generating Baseline Noise | Tráfico RDP, SMB, Kerberos, DNS realista |
| **Part 9** | Fire and Blood — Attack Scenarios and Forensic Analysis | Ataques, exportar imágenes, analizar con masstin |

## Coste

| Concepto | Coste/mes |
|----------|-----------|
| Hetzner AX41-NVMe (64 GB RAM, 2x512 GB NVMe) | 38 EUR |
| Licencias Windows (evaluación, reset con ZFS snapshot) | 0 |
| Proxmox VE (community edition) | 0 |
| GOAD + BadBlood + herramientas | 0 (open source) |
| **Total** | **38 EUR/mes** |

## Repositorio

Todo el código está disponible en GitHub: [ad-dfir-lab](https://github.com/jupyterj0nes/ad-dfir-lab)

---

*Siguiente: [Part 1 — From Bare Metal to Proxmox]({% post_url es/2026-04-12-ad-dfir-lab-part1-proxmox %})*
