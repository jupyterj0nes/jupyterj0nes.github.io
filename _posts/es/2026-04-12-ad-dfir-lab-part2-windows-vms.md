---
layout: post
title: "AD DFIR Lab — Part 2: The Seven Kingdoms — Deploying Windows VMs with Unattended Install"
date: 2026-04-12 12:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part2
tags: [dfir, proxmox, windows, autounattend, virtio, lab]
description: "Creamos las 9 máquinas virtuales del laboratorio AD sobre Proxmox: 6 Windows con instalación desatendida via autounattend.xml, Ubuntu con cloud-init y Kali con preseed inyectado en el initrd."
comments: true
---

*Esta es la Part 2 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Creamos todas las VMs del laboratorio con instalación completamente desatendida.*

## El reto

Necesitamos instalar 9 máquinas virtuales:
- **6 Windows** (3x Server 2019, 2x Server 2016, 1x Windows 10)
- **1 Ubuntu** 22.04
- **1 Kali** Linux
- **1 pfSense** (pendiente para Part 3)

Hacerlo manualmente por VNC significaría horas de clicks. La gracia es automatizarlo todo.

## Creación de VMs con `qm`

Cada VM se crea con `qm create` definiendo el hardware virtual. Para Windows usamos:

```bash
qm create 101 \
    --name DC01-kingslanding \
    --ostype win10 \
    --machine q35 \
    --cpu host \
    --cores 2 \
    --memory 4096 \
    --scsihw virtio-scsi-single \
    --scsi0 local-zfs:50,iothread=1,discard=on,ssd=1 \
    --ide2 local:iso/windows-server-2019.iso,media=cdrom \
    --ide0 local:iso/virtio-win.iso,media=cdrom \
    --ide3 local:iso/autounattend-2019.iso,media=cdrom \
    --net0 virtio,bridge=vmbr0,tag=10 \
    --boot order=ide2\;scsi0 \
    --agent enabled=1
```

Puntos clave:
- **`virtio-scsi-single`** con `iothread=1`: máximo rendimiento de disco, un thread de I/O por disco
- **`discard=on,ssd=1`**: TRIM para que ZFS recupere espacio no usado
- **3 CD-ROMs**: la ISO de Windows en `ide2`, los drivers VirtIO en `ide0`, y el autounattend en `ide3`
- **`tag=10`**: VLAN 10 (red corporativa)
- **`agent enabled=1`**: habilita la comunicación con QEMU guest agent

### La tabla completa de VMs

| VMID | Nombre | OS | RAM | Disco | VLAN |
|------|--------|----|-----|-------|------|
| 100 | pfsense | FreeBSD | 1 GB | 8 GB | 10+20 |
| 101 | DC01-kingslanding | Win 2019 | 4 GB | 50 GB | 10 |
| 102 | DC02-winterfell | Win 2019 | 4 GB | 50 GB | 10 |
| 103 | SRV02-castelblack | Win 2019 | 4 GB | 50 GB | 10 |
| 104 | DC03-meereen | Win 2016 | 4 GB | 50 GB | 10 |
| 105 | SRV03-braavos | Win 2016 | 4 GB | 50 GB | 10 |
| 106 | WS01-highgarden | Win 10 | 4 GB | 50 GB | 10 |
| 107 | LNX01-oldtown | Ubuntu 22.04 | 2 GB | 20 GB | 10 |
| 108 | KALI-nightking | Kali Linux | 4 GB | 30 GB | 20 |

Total: 35 GB de RAM y ~358 GB de disco en ZFS con thin provisioning.

## Windows: autounattend.xml

Windows Setup busca automáticamente un archivo `autounattend.xml` en las unidades de CD-ROM al arrancar. Si lo encuentra, ejecuta la instalación sin intervención humana.

### Los drivers VirtIO

Windows no incluye drivers VirtIO de serie. Sin ellos, el instalador no ve el disco SCSI virtual. El truco: cargar los drivers desde la ISO de VirtIO en la fase `windowsPE`:

```xml
<component name="Microsoft-Windows-PnpCustomizationsWinPE" ...>
  <DriverPaths>
    <PathAndCredentials wcm:action="add" wcm:keyValue="1">
      <Path>D:\vioscsi\2k19\amd64</Path>
    </PathAndCredentials>
    <PathAndCredentials wcm:action="add" wcm:keyValue="2">
      <Path>D:\NetKVM\2k19\amd64</Path>
    </PathAndCredentials>
    <PathAndCredentials wcm:action="add" wcm:keyValue="3">
      <Path>D:\viostor\2k19\amd64</Path>
    </PathAndCredentials>
    <!-- Repetir para E: y F: por si la letra cambia -->
  </DriverPaths>
</component>
```

Incluimos paths para `D:`, `E:` y `F:` porque la letra de la unidad de CD depende del orden de montaje y varía entre VMs.

### Selección de edición por INDEX

Las ISOs de evaluación de Microsoft contienen varias ediciones. Un error común es seleccionar por nombre — pero el nombre varía entre versiones y ediciones. Mucho más fiable: seleccionar por **INDEX**:

```xml
<InstallFrom>
  <MetaData wcm:action="add">
    <Key>/IMAGE/INDEX</Key>
    <Value>2</Value>  <!-- Standard con Desktop Experience -->
  </MetaData>
</InstallFrom>
```

Para saber qué índice corresponde a qué edición, usamos `wiminfo` desde Linux:

```bash
apt-get install -y wimtools
mount -o loop windows-server-2019.iso /mnt/iso
wiminfo /mnt/iso/sources/install.wim
```

```
Index 1: Windows Server 2019 SERVERSTANDARDCORE (Server Core)
Index 2: Windows Server 2019 SERVERSTANDARD (Desktop Experience) ← este
Index 3: Windows Server 2019 SERVERDATACENTERCORE
Index 4: Windows Server 2019 SERVERDATACENTER
```

### Sin product key

Las ISOs de evaluación no necesitan clave de producto. Si pones una clave KMS retail, el instalador dice "No images are available". Simplemente omite el bloque `ProductKey`:

```xml
<UserData>
  <AcceptEula>true</AcceptEula>
  <!-- Sin ProductKey para evaluación -->
</UserData>
```

### Post-instalación automática

En `FirstLogonCommands` configuramos todo lo que necesitamos después de instalar:

```xml
<FirstLogonCommands>
  <!-- 1. Deshabilitar firewall permanentemente -->
  <SynchronousCommand wcm:action="add">
    <Order>2</Order>
    <CommandLine>powershell -Command "Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False"</CommandLine>
  </SynchronousCommand>
  <!-- 2. Habilitar WinRM para administración remota -->
  <SynchronousCommand wcm:action="add">
    <Order>4</Order>
    <CommandLine>powershell -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck"</CommandLine>
  </SynchronousCommand>
  <!-- 3. Instalar QEMU Guest Agent desde la ISO VirtIO -->
  <SynchronousCommand wcm:action="add">
    <Order>7</Order>
    <CommandLine>powershell -Command "$d = (Get-Volume | Where-Object {$_.FileSystemLabel -eq 'virtio-win'}).DriveLetter; if ($d) { Start-Process msiexec.exe -Wait -ArgumentList \"/i ${d}:\guest-agent\qemu-ga-x86_64.msi /qn\" }"</CommandLine>
  </SynchronousCommand>
</FirstLogonCommands>
```

El guest agent permite a Proxmox comunicarse con la VM: ejecutar comandos, obtener IPs, hacer shutdown limpio.

Tras unos minutos, el instalador arranca y empieza a copiar archivos sin intervención:

![Windows Server 2019 installing files](/assets/img/posts/ad-dfir-lab/win-installing-files.png){:loading="lazy"}

Y ~15 minutos después, la VM aparece con el escritorio listo, Server Manager abierto, y firewall deshabilitado:

![Windows Server 2019 desktop ready](/assets/img/posts/ad-dfir-lab/win-server-manager.png){:loading="lazy"}

### El ISO truco

¿Cómo metemos el `autounattend.xml` en un CD-ROM? Creamos una ISO mínima:

```bash
apt-get install -y genisoimage
TMPDIR=$(mktemp -d)
cp autounattend-2019.xml ${TMPDIR}/autounattend.xml
genisoimage -o autounattend-2019.iso -J -r ${TMPDIR}/
```

Este ISO de pocos KB se monta como `ide3` y Windows Setup lo encuentra automáticamente.

## Ubuntu: Cloud Image + Cloud-Init

Para Ubuntu, intentar automatizar la ISO del servidor con autoinstall es frágil — hay prompts de confirmación que rompen la automatización. La solución más limpia: usar la **cloud image** con **cloud-init de Proxmox**:

```bash
# Descargar cloud image (700 MB vs 2 GB de la ISO)
wget -O jammy-server-cloudimg-amd64.img \
    "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"

# Importar como disco de VM
qm importdisk 107 jammy-server-cloudimg-amd64.img local-zfs
qm set 107 --scsi0 local-zfs:vm-107-disk-0,iothread=1,discard=on,ssd=1
qm resize 107 scsi0 20G

# Configurar cloud-init
qm set 107 --ide2 local-zfs:cloudinit
qm set 107 --ciuser ubuntu --cipassword ubuntu
qm set 107 --sshkeys /root/.ssh/authorized_keys
qm set 107 --ipconfig0 ip=dhcp
qm set 107 --boot order=scsi0
```

La VM arranca en ~30 segundos con SSH habilitado. Sin ISO, sin instalador, sin prompts.

El servidor ISO de Ubuntu, en cambio, necesita confirmar `autoinstall` con un prompt manual aunque tengas el seed configurado:

![Ubuntu autoinstall prompt blocking install](/assets/img/posts/ad-dfir-lab/ubuntu-autoinstall-prompt.png){:loading="lazy"}

Por eso descartamos la ISO y usamos directamente la cloud image.

**Gotcha**: la cloud image de Ubuntu es minimal y **no incluye `qemu-guest-agent`**. Proxmox cloud-init tampoco instala paquetes — solo configura usuarios, red y SSH. Después del primer boot hay que conectarse por SSH e instalarlo:

```bash
ssh ubuntu@VM_IP 'sudo apt install -y qemu-guest-agent && sudo systemctl enable --now qemu-guest-agent'
```

## Kali: Preseed inyectado en el initrd

Kali fue el más complejo de automatizar. Tres problemas:

1. **La ISO oficial usa `simple-cdd`** con profiles que sobreescriben cualquier preseed externo
2. **El preseed debe estar disponible antes de que el installer pregunte el idioma** — no basta con montarlo como CD

![Kali language prompt blocking install](/assets/img/posts/ad-dfir-lab/kali-language-prompt.png){:loading="lazy"}

3. **Los paquetes de `kali-linux-default` hacen preguntas de debconf** (macchanger, kismet, wireshark, sslh):

![Kali macchanger debconf prompt](/assets/img/posts/ad-dfir-lab/kali-macchanger-prompt.png){:loading="lazy"}

Y como bonus, sin DHCP en la VLAN 20, el installer falla en la configuración de red:

![Kali network autoconfiguration failed](/assets/img/posts/ad-dfir-lab/kali-network-failed.png){:loading="lazy"}

### La solución: inyectar el preseed en el initrd

```bash
# Extraer la ISO
xorriso -osirrox on -indev kali.iso -extract / /tmp/kali-iso

# Inyectar preseed en el initrd
mkdir /tmp/initrd-work && cd /tmp/initrd-work
gzip -d < /tmp/kali-iso/install.amd/initrd.gz | cpio -id
cp preseed-kali.cfg preseed.cfg
find . | cpio -H newc -o | gzip > /tmp/kali-iso/install.amd/initrd.gz

# Parchear GRUB — eliminar simple-cdd
sed -i 's|preseed/file=/cdrom/simple-cdd/default.preseed simple-cdd/profiles=kali,offline desktop=xfce|auto=true priority=critical preseed/file=/preseed.cfg locale=en_US.UTF-8 keymap=us|g' \
    /tmp/kali-iso/boot/grub/grub.cfg

# Reempaquetar ISO
xorriso -as mkisofs -r -J -joliet-long -l -cache-inodes \
    -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
    -b isolinux/isolinux.bin -c isolinux/boot.cat \
    -no-emul-boot -boot-load-size 4 -boot-info-table \
    -o kali-preseed.iso /tmp/kali-iso
```

### Preseed con IP estática y respuestas de debconf

Sin pfSense/DHCP en la red, necesitamos IP estática. Y los paquetes de Kali hacen preguntas que hay que pre-responder:

```
# Red estática (VLAN 20)
d-i netcfg/disable_autoconfig boolean true
d-i netcfg/get_ipaddress string 192.168.20.100
d-i netcfg/get_netmask string 255.255.255.0
d-i netcfg/get_gateway string 192.168.20.1
d-i netcfg/get_nameservers string 8.8.8.8

# Respuestas para paquetes de kali-linux-default
macchanger macchanger/automatically_run boolean false
kismet-capture-common kismet-capture-common/install-setuid boolean true
wireshark-common wireshark-common/install-setuid boolean true
sslh sslh/inetd_or_standalone select standalone
```

### Gotcha: bucle de instalación

Después de que Kali termina de instalar y reinicia, vuelve a arrancar desde el CD-ROM y **vuelve a ejecutar el instalador**. Te pregunta si borrar los LVM existentes. El problema es el boot order de la VM — prioriza IDE sobre SCSI.

Solución: tras la primera instalación completa, quitar la ISO y cambiar el boot order:

```bash
qm set 108 --delete ide2
qm set 108 --boot order=scsi0
qm reboot 108
```

## NAT temporal

Sin pfSense configurado, las VMs no tienen salida a internet. Para que Kali pueda descargar paquetes durante la instalación, configuramos NAT en el host Proxmox:

```bash
# Crear interfaces VLAN en Proxmox
ip link add link vmbr0 name vmbr0.10 type vlan id 10
ip addr add 192.168.10.1/24 dev vmbr0.10
ip link set vmbr0.10 up

ip link add link vmbr0 name vmbr0.20 type vlan id 20
ip addr add 192.168.20.1/24 dev vmbr0.20
ip link set vmbr0.20 up

# NAT
echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -A POSTROUTING -s 192.168.10.0/24 -o vmbr0 -j MASQUERADE
iptables -t nat -A POSTROUTING -s 192.168.20.0/24 -o vmbr0 -j MASQUERADE
```

Esto es temporal — en la Part 3 pfSense se encargará del routing y NAT.

## QEMU Guest Agent: el último obstáculo (y por qué necesita intervención manual)

El guest agent permite a Proxmox comunicarse con las VMs — obtener IPs, ejecutar comandos, hacer shutdown limpio. Parece simple: instalar un MSI y listo. No lo es. De hecho, esta es **la única parte del laboratorio que NO se puede automatizar** completamente.

### El MSI no basta

El MSI `qemu-ga-x86_64.msi` que hay en la ISO VirtIO solo instala el **servicio** del guest agent. No instala el **driver virtio-serial** que es el canal de comunicación con Proxmox. Sin ese driver, el servicio arranca pero no puede hablar con el host. Proxmox dice `QEMU guest agent is not running` aunque dentro de Windows el servicio está `Running`.

La solución aparente: instalar `virtio-win-guest-tools.exe` — el instalador all-in-one que incluye TODOS los drivers VirtIO (vioserial, balloon, etc.) además del guest agent. Pero aquí viene el problema.

### Todas las formas de automatizar que fallaron

Intentamos **todas** las maneras de instalar el driver remotamente:

1. **`pnputil /add-driver vioser.inf /install`** — "Invalid INF passed as parameter". Los paths con backslashes se rompen a través de WinRM
2. **Copiar drivers del CD a disco local** (`robocopy`, `xcopy`) — las sesiones WinRM no pueden leer de unidades CD-ROM correctamente, el copy devuelve 0 files
3. **Descargar `virtio-win-guest-tools.exe` via HTTP y ejecutarlo via WinRM** — el instalador devuelve exit 0, el servicio queda running, pero el driver vioserial **no se bindea al hardware**
4. **Tarea programada como SYSTEM** — mismo resultado, instalación "exitosa" pero driver no cargado
5. **Reinstalar el MSI con `ADDLOCAL=ALL`** — tampoco instala el driver vioserial

En cada caso, PowerShell reporta:
```
Status  FriendlyName
------  ------------
Error   PCI Simple Communications Controller   (VEN_1AF4&DEV_1003)
```

El dispositivo VirtIO Serial queda con `Status: Error` — sin driver vinculado.

### La única solución: instalación manual via VNC

Después de múltiples intentos, la conclusión: **el instalador VirtIO requiere una sesión interactiva** para bindear kernel-mode drivers al hardware. No hay workaround automático.

![virtio-win-guest-tools installer running interactively](/assets/img/posts/ad-dfir-lab/win-virtio-installer.png){:loading="lazy"}

El procedimiento manual por VM:
1. Abrir la consola VNC en el web UI de Proxmox
2. Login como `vagrant`/`vagrant`
3. Abrir PowerShell como administrador
4. Ejecutar: `D:\virtio-win-guest-tools.exe`
5. Click en el asistente: Next → Install → Finish
6. `Restart-Computer -Force`

Tras el reboot, el driver vioserial carga y el guest agent conecta con Proxmox.

**Tiempo total**: ~1 minuto por VM × 6 VMs Windows = **6 minutos de trabajo manual**. Es el único paso no automatizable del laboratorio, pero después, todo lo demás se puede hacer via guest agent.

## Cuidado con las VLANs y Hetzner

Un error que casi nos cuesta el servidor: durante la fase de provisioning, pusimos temporalmente las VMs en el bridge sin VLAN tag para que tuvieran DHCP. Las MAC addresses virtuales de las VMs se filtraron a la red física de Hetzner.

Resultado: un email de abuse de Hetzner con amenaza de bloqueo del servidor.

**Regla de oro**: nunca quitar el VLAN tag de las VMs en un servidor dedicado Hetzner. En su lugar, usar interfaces VLAN en el host:

```bash
# Crear interfaces VLAN en Proxmox
ip link add link vmbr0 name vmbr0.10 type vlan id 10
ip addr add 192.168.10.1/24 dev vmbr0.10

# CRÍTICO: añadir VLANs al self-port del bridge
bridge vlan add dev vmbr0 vid 10 self
bridge vlan add dev vmbr0 vid 20 self
```

Sin `bridge vlan add dev vmbr0 vid 10 self`, el host no puede comunicarse con las VMs en VLAN 10 aunque la interfaz `vmbr0.10` exista.

## Resultado

Tras ~20 minutos de instalación desatendida:

```
VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB)
 101 DC01-kingslanding    running    4096       50.00
 102 DC02-winterfell      running    4096       50.00
 103 SRV02-castelblack    running    4096       50.00
 104 DC03-meereen         running    4096       50.00
 105 SRV03-braavos        running    4096       50.00
 106 WS01-highgarden      running    4096       50.00
 107 LNX01-oldtown        running    2048       20.00
 108 KALI-nightking       running    4096       30.00
```

8 máquinas virtuales instaladas sin tocar un solo prompt:
- **Windows**: con guest agent, WinRM, RDP, firewall deshabilitado, usuario `vagrant/vagrant`
- **Ubuntu**: con SSH, cloud-init, usuario `ubuntu/ubuntu`
- **Kali**: con `kali-linux-default`, SSH, usuario `kali/kali`

Todo el código en: [`04-create-vms.sh`](https://github.com/jupyterj0nes/ad-dfir-lab/blob/master/scripts/04-create-vms.sh) y [`autounattend/`](https://github.com/jupyterj0nes/ad-dfir-lab/tree/master/autounattend)

## Configuración post-instalación via guest agent

Una vez que el guest agent está instalado en las 8 VMs (las 6 Windows + Ubuntu + Kali), el resto de la configuración es trivial. Olvida WinRM, olvida SSH manual — `qm guest exec` desde Proxmox es más fiable que cualquier otra alternativa:

```bash
# Asignar IP estática + hostname a DC01 desde Proxmox
qm guest exec 101 -- powershell -Command '
    $a = Get-NetAdapter | Where { $_.Status -eq "Up" } | Select -First 1
    New-NetIPAddress -InterfaceIndex $a.ifIndex `
        -IPAddress 192.168.10.10 -PrefixLength 24 `
        -DefaultGateway 192.168.10.1
    Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex `
        -ServerAddresses 192.168.10.10
    Rename-Computer -NewName kingslanding -Force
'
```

Verificación rápida desde dentro de la VM via VNC:

![Windows ipconfig showing the assigned IP](/assets/img/posts/ad-dfir-lab/win-ipconfig.png){:loading="lazy"}

Después de aplicar la configuración a las 6 VMs Windows, un reboot via guest exec:

```bash
qm guest exec 101 -- cmd /c "shutdown /r /t 5 /f"
```

Y por último, limpieza: quitar las ISOs de instalación y fijar el boot order:

```bash
for VMID in 101 102 103 104 105 106; do
    qm set $VMID --delete ide2  # Windows ISO
    qm set $VMID --delete ide0  # VirtIO ISO
    qm set $VMID --delete ide3  # autounattend ISO
    qm set $VMID --boot order=scsi0
done
```

## Estado final

Tras Phase 5, el laboratorio queda así:

| VMID | Hostname | IP | Rol |
|------|----------|-----|-----|
| 101 | kingslanding | 192.168.10.10 | Root DC, sevenkingdoms.local |
| 102 | winterfell | 192.168.10.11 | Child DC, north.sevenkingdoms.local |
| 103 | castelblack | 192.168.10.12 | IIS + MSSQL + shares |
| 104 | meereen | 192.168.10.13 | Root DC, essos.local |
| 105 | braavos | 192.168.10.14 | Cross-forest server |
| 106 | highgarden | 192.168.10.20 | Workstation Win10 |
| 107 | oldtown | DHCP | Ubuntu (Linux client) |
| 108 | nightking | 192.168.20.100 | Kali (atacante) |

8 máquinas configuradas, hostnames coherentes con la temática Game of Thrones, IPs estáticas en VLAN 10 (corporativa) y Kali aislado en VLAN 20.

Listas para el siguiente paso: configurar pfSense como router entre las dos VLANs, y luego desplegar Active Directory con GOAD.

---

*Siguiente: Part 3 — Beyond the Wall: pfSense, VLANs and Network Segmentation*

*Anterior: [Part 1 — From Bare Metal to Proxmox]({% post_url es/2026-04-12-ad-dfir-lab-part1-proxmox %})*
