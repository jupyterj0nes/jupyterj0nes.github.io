---
layout: post
title: "AD DFIR Lab — Part 1: From Bare Metal to Proxmox"
date: 2026-04-12 11:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part1
tags: [dfir, proxmox, hetzner, zfs, lab, instalacion]
description: "Desde un servidor dedicado Hetzner en blanco hasta Proxmox VE funcionando con ZFS, bridge VLAN-aware y almacenamiento listo para las VMs — todo automatizado vía SSH."
comments: true
---

*Esta es la Part 1 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Partimos de un servidor dedicado Hetzner recién contratado y terminamos con Proxmox VE instalado y listo para crear máquinas virtuales.*

## El servidor

Para este laboratorio usamos un **Hetzner AX41-NVMe** del [Server Auction](https://www.hetzner.com/sb) (servidores de segunda mano):

| Componente | Especificación |
|------------|----------------|
| CPU | AMD Ryzen 5 3600 (6 cores, 12 threads) |
| RAM | 64 GB DDR4 (Non-ECC) |
| Disco | 2x 512 GB NVMe |
| Red | 1 Gbps, 20 TB/mes incluidos |
| Ubicación | Helsinki, Finlandia |
| Coste | 38.40 EUR/mes (IVA incluido) |

64 GB de RAM son suficientes para correr las 9 VMs del laboratorio (35 GB asignados a VMs + 4 GB para Proxmox/ZFS), y los dos NVMe nos permiten configurar RAID1 para redundancia.

## Paso 1: Rescue System

Cuando Hetzner te entrega el servidor, lo primero es arrancar en el **Rescue System** — un Linux minimal que se carga en RAM y te permite instalar el sistema operativo en los discos.

Desde el panel de Hetzner Robot:
1. **Rescue** → Activar Linux 64-bit → Anotar la contraseña root
2. **Reset** → Hardware Reset

En 2-3 minutos el servidor arranca en rescue y puedes conectar por SSH:

```bash
ssh root@95.217.226.229
```

Lo primero que vemos al conectar:

```
CPU1: AMD Ryzen 5 3600 6-Core Processor (Cores 12)
Memory:  64244 MB (Non-ECC)
Disk /dev/nvme0n1: 512 GB (=> 476 GiB)
Disk /dev/nvme1n1: 512 GB (=> 476 GiB)
```

Dos discos NVMe vírgenes, sin tabla de particiones.

## Paso 2: Instalar Debian con installimage

Hetzner proporciona `installimage`, una herramienta propia que instala el sistema operativo de forma desatendida. Nuestro script [`01-install-proxmox.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/01-install-proxmox.sh) automatiza todo el proceso.

### Detección de discos

Lo primero es detectar los discos NVMe correctamente. En el rescue system hay un loop device que puede confundir la detección:

```bash
DISKS=($(lsblk -dnpo NAME,TYPE | grep disk | grep -E "nvme|sd" | cut -d" " -f1 | head -2))
# Resultado: /dev/nvme0n1 /dev/nvme1n1
```

### Configuración de installimage

Generamos la configuración para `installimage`:

```
DRIVE1 /dev/nvme0n1
DRIVE2 /dev/nvme1n1
SWRAID 1
SWRAIDLEVEL 1
BOOTLOADER grub
HOSTNAME proxmox-lab
PART /boot ext3 1024M
PART lvm vg0 all

LV vg0 root / ext4 50G
LV vg0 swap swap swap 8G

IMAGE /root/.oldroot/nfs/images/Debian-1213-bookworm-amd64-base.tar.gz
```

Puntos clave:
- **RAID1 por software** entre los dos NVMe — si falla un disco, no pierdes el lab
- **LVM** con un volumen de 50 GB para root y 8 GB de swap
- El resto del espacio en vg0 queda libre para ZFS (lo usaremos después)
- **Debian 12 Bookworm** como base — es lo que Proxmox 8 requiere

```bash
/root/.oldroot/nfs/install/installimage -a -c /tmp/installimage-config
```

La instalación tarda unos 70 segundos. Después, reboot.

## Paso 3: Instalar Proxmox VE

Tras reiniciar, estamos en Debian 12 limpio. El script [`02-configure-proxmox.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/02-configure-proxmox.sh) instala Proxmox y configura todo lo necesario.

### Repositorio y paquetes

```bash
# Añadir repo de Proxmox (community, sin suscripción)
echo "deb [arch=amd64] http://download.proxmox.com/debian/pve bookworm pve-no-subscription" \
    > /etc/apt/sources.list.d/pve.list

# Instalar Proxmox VE
apt-get install -y proxmox-ve postfix open-iscsi chrony
```

La instalación de Proxmox tarda unos 3 minutos e incluye el kernel propio de Proxmox (6.8.12-20-pve), la interfaz web, y todas las herramientas de virtualización.

### Bridge VLAN-aware

Para que las VMs tengan red, necesitamos un bridge. Proxmox usa `vmbr0` como bridge principal. Lo configuramos como **VLAN-aware** para poder asignar VLANs diferentes a cada VM:

```
auto vmbr0
iface vmbr0 inet static
    address 95.217.226.229/26
    gateway 95.217.226.193
    bridge-ports enp35s0
    bridge-stp off
    bridge-fd 0
    bridge-vlan-aware yes
    bridge-vids 2-4094
```

Con `bridge-vlan-aware yes`, cada VM puede tener su propio tag VLAN. Las VMs del dominio irán en VLAN 10, y Kali en VLAN 20.

### ZFS para almacenamiento de VMs

ZFS nos da snapshots instantáneos, compresión, y la capacidad de revertir todo el laboratorio a un estado limpio en segundos. Usamos el espacio libre de LVM:

```bash
# Crear volumen lógico con el 90% del espacio libre
lvcreate -l 90%FREE -n zfsdata vg0

# Crear pool ZFS con compresión
zpool create -f vmstore /dev/vg0/zfsdata
zfs set compression=lz4 vmstore

# Crear datasets
zfs create -p vmstore/images
zfs create -p vmstore/templates
```

Después registramos el pool en Proxmox:

```bash
pvesm add zfspool local-zfs -pool vmstore/images -content images,rootdir
```

### Herramientas adicionales

```bash
apt-get install -y vim htop tmux wget curl git unzip \
    wireguard-tools qemu-guest-agent libguestfs-tools \
    python3 python3-pip python3-venv jq
```

Tras un reboot final al kernel de Proxmox, tenemos:

```
pve-manager/8.4.18 (running kernel: 6.8.12-20-pve)

Storage:
  local        dir       51 GB (ISOs, snippets)
  local-zfs    zfspool  364 GB (VM disks)
```

## Paso 4: Descargar las ISOs

El script [`03-download-isos.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/03-download-isos.sh) descarga todas las ISOs necesarias. Las de Linux se descargan directamente, y para las de Windows descubrimos que existen URLs directas del CDN de Microsoft que funcionan con `wget`:

| ISO | Tamaño | Descarga |
|-----|--------|----------|
| Windows Server 2019 Eval | 5.0 GB | CDN directo de Microsoft |
| Windows Server 2016 Eval | 6.5 GB | CDN directo de Microsoft |
| Windows 10 Enterprise Eval | 4.5 GB | CDN directo de Microsoft |
| Kali Linux 2026.1 | 4.5 GB | cdimage.kali.org |
| Ubuntu 22.04 Server | 2.0 GB | releases.ubuntu.com |
| pfSense CE | 835 MB | atxfiles.netgate.com |
| VirtIO drivers | 754 MB | fedorapeople.org |

```bash
# Las ISOs de Windows se descargan con user-agent de navegador
wget --user-agent="Mozilla/5.0" -O windows-server-2019.iso \
    "https://software-download.microsoft.com/download/pr/17763.737.190906-2324.rs5_release_svc_refresh_SERVER_EVAL_x64FRE_en-us_1.iso"
```

Total: **24 GB** de ISOs, descargadas en unos 10 minutos gracias al ancho de banda de Hetzner.

## Scripts resumibles

Un detalle importante de la automatización: todos los scripts usan un sistema de **checkpoints** ([`lib-state.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/lib-state.sh)) que permite:

- **Reanudar** desde el último paso completado si algo falla
- **Saltarse** pasos ya completados al re-ejecutar
- **Inspeccionar** el estado de cada fase

```bash
$ bash 02-configure-proxmox.sh

=== 02-configure-proxmox ===

  [SKIP] Setting hostname to proxmox-lab (already done)
  [SKIP] Adding Proxmox VE repository (already done)
  [SKIP] Installing Proxmox VE (already done)
  [10]   Creating ZFS pool for VM storage...
  [OK]   Creating ZFS pool for VM storage (0s)
  ...
```

Si la conexión SSH se cae o hay un error temporal, simplemente vuelves a ejecutar el script y continúa donde lo dejó.

## Resultado

Al final de esta fase tenemos:

- **Proxmox VE 8.4** corriendo en Debian 12
- **ZFS** con 364 GB disponibles para VMs (compresión lz4)
- **Bridge vmbr0** VLAN-aware, listo para segregar redes
- **7 ISOs** descargadas y listas para crear VMs
- **Interfaz web** accesible en `https://IP:8006`
- Todo **automatizado y documentado** en 3 scripts resumibles

Tiempo total: **unos 20 minutos** desde el servidor en blanco.

---

*Siguiente: Part 2 — The Seven Kingdoms: Deploying Windows VMs with Unattended Install*

*Anterior: [Introducción — The Iron Throne of DFIR]({% post_url es/2026-04-12-ad-dfir-lab-intro %})*
