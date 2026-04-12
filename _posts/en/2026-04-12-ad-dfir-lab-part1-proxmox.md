---
layout: post
title: "AD DFIR Lab — Part 1: From Bare Metal to Proxmox"
date: 2026-04-12 11:00:00 +0100
category: cases
lang: en
ref: case-ad-dfir-lab-part1
tags: [dfir, proxmox, hetzner, zfs, lab, installation]
description: "From a blank Hetzner dedicated server to a fully running Proxmox VE with ZFS, VLAN-aware bridge and storage ready for VMs — all automated via SSH."
comments: true
---

*This is Part 1 of the [AD DFIR Lab]({% post_url en/2026-04-12-ad-dfir-lab-intro %}) series. We start from a freshly provisioned Hetzner dedicated server and end with Proxmox VE installed and ready to create virtual machines.*

## The server

For this lab we use a **Hetzner AX41-NVMe** from the [Server Auction](https://www.hetzner.com/sb) (refurbished servers):

| Component | Specification |
|-----------|---------------|
| CPU | AMD Ryzen 5 3600 (6 cores, 12 threads) |
| RAM | 64 GB DDR4 (Non-ECC) |
| Storage | 2x 512 GB NVMe |
| Network | 1 Gbps, 20 TB/month included |
| Location | Helsinki, Finland |
| Cost | 38.40 EUR/month (VAT included) |

64 GB of RAM is enough to run all 9 lab VMs (35 GB allocated to VMs + 4 GB for Proxmox/ZFS), and the two NVMe drives allow us to set up RAID1 for redundancy.

## Step 1: Rescue System

When Hetzner delivers the server, the first step is to boot into the **Rescue System** — a minimal Linux loaded into RAM that lets you install the operating system on the disks.

From the Hetzner Robot panel:
1. **Rescue** → Activate Linux 64-bit → Note the root password
2. **Reset** → Hardware Reset

In 2-3 minutes the server boots into rescue and you can connect via SSH:

```bash
ssh root@95.217.226.229
```

What we see upon connecting:

```
CPU1: AMD Ryzen 5 3600 6-Core Processor (Cores 12)
Memory:  64244 MB (Non-ECC)
Disk /dev/nvme0n1: 512 GB (=> 476 GiB)
Disk /dev/nvme1n1: 512 GB (=> 476 GiB)
```

Two virgin NVMe drives, no partition table.

## Step 2: Install Debian with installimage

Hetzner provides `installimage`, a proprietary tool that installs the operating system unattended. Our script [`01-install-proxmox.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/01-install-proxmox.sh) automates the entire process.

### Disk detection

First, we detect the NVMe disks correctly. The rescue system has a loop device that can confuse detection:

```bash
DISKS=($(lsblk -dnpo NAME,TYPE | grep disk | grep -E "nvme|sd" | cut -d" " -f1 | head -2))
# Result: /dev/nvme0n1 /dev/nvme1n1
```

### installimage configuration

We generate the configuration for `installimage`:

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

Key points:
- **Software RAID1** across both NVMe drives — if one fails, you don't lose the lab
- **LVM** with a 50 GB root volume and 8 GB swap
- The remaining space in vg0 stays free for ZFS (we'll use it later)
- **Debian 12 Bookworm** as the base — required by Proxmox 8

```bash
/root/.oldroot/nfs/install/installimage -a -c /tmp/installimage-config
```

Installation takes about 70 seconds. Then, reboot.

## Step 3: Install Proxmox VE

After rebooting, we're on a clean Debian 12. The script [`02-configure-proxmox.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/02-configure-proxmox.sh) installs Proxmox and configures everything needed.

### Repository and packages

```bash
# Add Proxmox repo (community, no subscription)
echo "deb [arch=amd64] http://download.proxmox.com/debian/pve bookworm pve-no-subscription" \
    > /etc/apt/sources.list.d/pve.list

# Install Proxmox VE
apt-get install -y proxmox-ve postfix open-iscsi chrony
```

Proxmox installation takes about 3 minutes and includes the Proxmox kernel (6.8.12-20-pve), the web interface, and all virtualization tools.

### VLAN-aware bridge

For VMs to have networking, we need a bridge. Proxmox uses `vmbr0` as the main bridge. We configure it as **VLAN-aware** so we can assign different VLANs to each VM:

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

With `bridge-vlan-aware yes`, each VM can have its own VLAN tag. Domain VMs will go on VLAN 10, and Kali on VLAN 20.

### ZFS for VM storage

ZFS gives us instant snapshots, compression, and the ability to revert the entire lab to a clean state in seconds. We use the free LVM space:

```bash
# Create logical volume with 90% of free space
lvcreate -l 90%FREE -n zfsdata vg0

# Create ZFS pool with compression
zpool create -f vmstore /dev/vg0/zfsdata
zfs set compression=lz4 vmstore

# Create datasets
zfs create -p vmstore/images
zfs create -p vmstore/templates
```

Then register the pool in Proxmox:

```bash
pvesm add zfspool local-zfs -pool vmstore/images -content images,rootdir
```

### Additional tools

```bash
apt-get install -y vim htop tmux wget curl git unzip \
    wireguard-tools qemu-guest-agent libguestfs-tools \
    python3 python3-pip python3-venv jq
```

After a final reboot into the Proxmox kernel, we have:

```
pve-manager/8.4.18 (running kernel: 6.8.12-20-pve)

Storage:
  local        dir       51 GB (ISOs, snippets)
  local-zfs    zfspool  364 GB (VM disks)
```

## Step 4: Download ISOs

The script [`03-download-isos.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/03-download-isos.sh) downloads all required ISOs. Linux ISOs download directly, and for Windows we discovered that direct Microsoft CDN URLs work with `wget`:

| ISO | Size | Download |
|-----|------|----------|
| Windows Server 2019 Eval | 5.0 GB | Direct Microsoft CDN |
| Windows Server 2016 Eval | 6.5 GB | Direct Microsoft CDN |
| Windows 10 Enterprise Eval | 4.5 GB | Direct Microsoft CDN |
| Kali Linux 2026.1 | 4.5 GB | cdimage.kali.org |
| Ubuntu 22.04 Server | 2.0 GB | releases.ubuntu.com |
| pfSense CE | 835 MB | atxfiles.netgate.com |
| VirtIO drivers | 754 MB | fedorapeople.org |

```bash
# Windows ISOs download with browser user-agent
wget --user-agent="Mozilla/5.0" -O windows-server-2019.iso \
    "https://software-download.microsoft.com/download/pr/17763.737.190906-2324.rs5_release_svc_refresh_SERVER_EVAL_x64FRE_en-us_1.iso"
```

Total: **24 GB** of ISOs, downloaded in about 10 minutes thanks to Hetzner's bandwidth.

## Resumable scripts

An important detail about the automation: all scripts use a **checkpoint system** ([`lib-state.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/lib-state.sh)) that allows:

- **Resuming** from the last completed step if something fails
- **Skipping** already completed steps on re-run
- **Inspecting** each phase's state

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

If the SSH connection drops or there's a temporary error, just re-run the script and it continues where it left off.

## Result

At the end of this phase we have:

- **Proxmox VE 8.4** running on Debian 12
- **ZFS** with 364 GB available for VMs (lz4 compression)
- **Bridge vmbr0** VLAN-aware, ready for network segmentation
- **7 ISOs** downloaded and ready to create VMs
- **Web interface** accessible at `https://IP:8006`
- Everything **automated and documented** in 3 resumable scripts

Total time: **about 20 minutes** from blank server.

---

*Next: Part 2 — The Seven Kingdoms: Deploying Windows VMs with Unattended Install*

*Previous: [Introduction — The Iron Throne of DFIR]({% post_url en/2026-04-12-ad-dfir-lab-intro %})*
