---
layout: post
title: "The Iron Throne of DFIR — Construyendo un laboratorio de Active Directory para entrenamiento forense"
date: 2026-04-12 10:00:00 +0100
category: laboratorio
redirect_from:
  - /es/cases/ad-dfir-lab-intro/
lang: es
ref: case-ad-dfir-lab-intro
tags: [dfir, active-directory, lab, proxmox, goad, hetzner, forense]
description: "Serie completa sobre cómo montar un laboratorio de Active Directory con dos forests, nueve máquinas virtuales, vulnerabilidades preconfiguradas y auditoría avanzada — todo automatizado sobre un servidor dedicado Hetzner por 38 EUR/mes."
comments: true
---

## Por qué necesitas un laboratorio de AD para DFIR

Si trabajas en respuesta ante incidentes o forense digital, sabes que el 90% de los ataques que investigas ocurren en entornos de Active Directory. Kerberoasting, lateral movement con PsExec, DCSync, abuso de ADCS — los ves constantemente en los casos reales. Pero ¿dónde practicas?

Por si alguno de esos nombres te suena a chino: **Kerberoasting** es pedir tickets de servicio de Kerberos para crackear offline la contraseña de la cuenta de servicio. **PsExec** es una herramienta que ejecuta comandos en otro equipo Windows por la red. **DCSync** es hacerse pasar por un controlador de dominio para que otro te entregue los hashes de las contraseñas. **ADCS** es el servicio de certificados de Active Directory, que mal configurado permite obtener certificados a nombre de otros usuarios. Los veremos uno a uno a lo largo de la serie.

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

Dos forests con trust bidireccional. Tres dominios. Nueve máquinas virtuales: las ocho de la lista más pfSense, el firewall. ~46 usuarios en los tres dominios — el conjunto que crea GOAD (no se ejecutó generación masiva con BadBlood). Vulnerabilidades preconfiguradas que incluyen AS-REP Roasting, Kerberoasting, delegación, ADCS ESC1-ESC13 (en essos.local), abuso de ACLs y mucho más.

## El flujo DFIR completo

Lo que hace especial este laboratorio no es solo el entorno vulnerable — es el ciclo completo de investigación:

1. **Generar ruido de línea base** — dos años de actividad corporativa simulada antes de cualquier ataque (Part 8)
2. **Snapshot** del estado limpio
3. **Ejecutar un escenario de ataque** desde Kali (automatizado o manual)
4. **Exportar imágenes forenses** (raw comprimido con zstd, Part 9) de las máquinas comprometidas
5. **Analizar con tus herramientas** — masstin, Volatility, plaso, lo que prefieras
6. **Revertir** al estado limpio y repetir con otro escenario

Cada escenario de ataque genera artefactos específicos que puedes buscar: eventos 4624, 4769, 4662, Sysmon event 1 con command lines completos, PowerShell script blocks en 4104...

Qué registra cada uno:

- **4624** (Security): un inicio de sesión correcto.
- **4769** (Security): se pidió un ticket de servicio de Kerberos.
- **4662** (Security): se hizo una operación sobre un objeto de Active Directory.
- **Sysmon 1**: se creó un proceso, con su línea de comandos.
- **4104** (PowerShell): el texto del script que se ejecutó.

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
| **Part 7** | [The Night King Rises — Kali as Attack Platform]({% post_url es/2026-04-13-ad-dfir-lab-part7-kali %}) | Herramientas ofensivas, configuración, AS-REP roast test |
| **Part 7.5** | [Mantener vivos los Siete Reinos — Licencias Eval y Longevidad del Laboratorio]({% post_url es/2026-04-13-ad-dfir-lab-part7-5-licenses %}) | Test empírico de eval wall-clock, límites de rearm, alertas Telegram |
| **Part 8** | [Un Día en el Reino — Generando Dos Años de Ruido Histórico]({% post_url es/2026-04-13-ad-dfir-lab-part8-historical-noise %}) | Día-como-iteración, calendario español, personas, viaje en reloj paralelo, traspié con wlms |
| **Part 9** | [Recolectando la Evidencia — Pipeline de Imagen Forense]({% post_url es/2026-04-15-ad-dfir-lab-part9-forensic-imaging %}) | Clones ZFS, dd + zstd streaming por SSH, benchmark real 52m 42GB |
| **Part 10** | Fire and Blood — Attack Scenarios and Forensic Analysis | Ataques, exportar imágenes, analizar con masstin |

## Coste

| Concepto | Coste/mes |
|----------|-----------|
| Hetzner AX41-NVMe (64 GB RAM, 2x512 GB NVMe) | 38 EUR |
| Licencias Windows (evaluación, reset con ZFS snapshot) | 0 |
| Proxmox VE (community edition) | 0 |
| GOAD + herramientas | 0 (open source) |
| **Total** | **38 EUR/mes** |

## Repositorio

Todo el código está disponible en GitHub: [ad-dfir-lab](https://github.com/jupyterj0nes/ad-dfir-lab)

---

*Siguiente: [Part 1 — From Bare Metal to Proxmox]({% post_url es/2026-04-12-ad-dfir-lab-part1-proxmox %})*
