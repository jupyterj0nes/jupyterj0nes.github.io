---
layout: post
title: "AD DFIR Lab — Part 3: Beyond the Wall — pfSense, VLANs y segmentación de red"
date: 2026-04-12 15:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part3
tags: [dfir, pfsense, vlan, network, lab, proxmox]
description: "Desplegamos pfSense como router/firewall entre la red corporativa (VLAN 10) y la red de ataque (VLAN 20). Kali debe pivotar a través de pfSense para llegar al dominio — exactamente como un atacante real."
comments: true
---

*Esta es la Part 3 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Configuramos pfSense para separar la red de ataque de la red corporativa y obligar a Kali a pivotar como un atacante externo.*

## Por qué pfSense

En la [Part 2]({% post_url es/2026-04-12-ad-dfir-lab-part2-windows-vms %}) creamos las VMs separadas en dos VLANs:
- **VLAN 10** (192.168.10.0/24) — Red corporativa con todos los DCs, servers y workstations
- **VLAN 20** (192.168.20.0/24) — Red aislada con Kali

Pero las VLANs por sí solas no hacen nada útil — necesitan un router que decida qué tráfico puede pasar entre ellas. Ese es el papel de pfSense.

¿Por qué pfSense y no `iptables` directamente en Proxmox? Tres razones:

1. **Realismo**: en un entorno corporativo real hay un firewall dedicado entre segmentos. Reproducirlo en el lab te da artefactos forenses más representativos
2. **Trazabilidad**: pfSense logea cada conexión bloqueada/permitida, igual que un firewall enterprise
3. **Reglas visuales**: la web UI permite crear escenarios de pivoting controlados sin tocar `iptables`

## Por qué la instalación de pfSense es manual

A diferencia de las Windows (autounattend), Ubuntu (cloud-init) o Kali (preseed en initrd), **pfSense no tiene un mecanismo de instalación desatendida fiable**. Hay proyectos como `mfsBSD` que permiten cierta automatización, pero para una instalación única son más complicados que hacerla a mano.

La instalación dura unos 5 minutos via VNC. Te describo el proceso completo.

## Instalación paso a paso

### 1. Aceptar copyright

Boot desde la ISO de pfSense (`pfSense-CE-2.7.2-RELEASE-amd64.iso`):

![pfSense installer copyright notice](/assets/img/posts/ad-dfir-lab/pfsense-01-installer.png)

Enter para Accept.

### 2. Particionado ZFS

Pasamos por el menú de instalación: Install → default keymap → **Auto (ZFS)** → Install → Stripe → seleccionar disco:

![pfSense ZFS disk selection](/assets/img/posts/ad-dfir-lab/pfsense-02-zfs-disk.png)

Espacio para marcar `da0`, Tab a OK, Enter.

### 3. Confirmar borrado

![pfSense confirm wipe disk](/assets/img/posts/ad-dfir-lab/pfsense-03-confirm-wipe.png)

YES. El disco está vacío, no hay riesgo.

### 4. Quitar la ISO antes del primer boot

**Gotcha importante**: cuando pfSense termina de instalar y reinicia, vuelve a arrancar desde la ISO. Hay que quitarla desde Proxmox:

```bash
qm stop 100 --timeout 5
qm set 100 --delete ide2
qm set 100 --boot order=scsi0
qm start 100
```

Sin esto, pfSense te pide reinstalar en cada boot. Es el mismo problema que vimos con Kali en la Part 2.

### 5. Configuración inicial de interfaces

Tras el primer boot del sistema instalado, pfSense pregunta por la configuración de interfaces:

![pfSense VLAN setup prompt](/assets/img/posts/ad-dfir-lab/pfsense-04-vlan-prompt.png)

- "Should VLANs be set up now?" → **n** (no, las VLANs ya las maneja Proxmox a nivel de bridge)
- "Enter the WAN interface name" → **vtnet0** (es nuestro `--net0` con `tag=10`)

![pfSense WAN interface assignment](/assets/img/posts/ad-dfir-lab/pfsense-05-wan-interface.png)

- "Enter the LAN interface name" → **vtnet1** (nuestro `--net1` con `tag=20`)
- Confirmar → **y**

### 6. El menú de consola

Llegamos al menú principal de pfSense:

![pfSense console menu](/assets/img/posts/ad-dfir-lab/pfsense-06-console-menu.png)

Por defecto pfSense ha cogido DHCP en WAN (`192.168.10.50` del dnsmasq temporal de Proxmox) y la LAN está en `192.168.1.1`. Hay que cambiar ambas a las IPs del lab.

### 7. Configurar IP estática WAN

Opción **2** (Set interface IP) → **1** (WAN) → **n** (no DHCP):

![pfSense set IP](/assets/img/posts/ad-dfir-lab/pfsense-07-set-ip.png)

- IP: `192.168.10.2`
- Subnet: `24`
- Gateway: `192.168.10.1` (el host Proxmox, que hace NAT a internet)
- Default gateway: `y`
- IPv6: `n`
- DHCP server on WAN: `n` (las VMs Windows tienen IPs estáticas)

![pfSense WAN config result](/assets/img/posts/ad-dfir-lab/pfsense-08-wan-config.png)

### 8. Configurar IP estática LAN

Opción **2** otra vez → **2** (LAN) → **n**:
- IP: `192.168.20.1`
- Subnet: `24`
- Gateway: ENTER (LAN no necesita gateway)
- IPv6: `n`
- DHCP server on LAN: `y`
- Range: `192.168.20.50` a `192.168.20.99`
- Revert HTTP: `n`

### 9. Estado final

![pfSense final state](/assets/img/posts/ad-dfir-lab/pfsense-09-final-state.png)

```
WAN (vtnet0) → 192.168.10.2/24
LAN (vtnet1) → 192.168.20.1/24
```

### 10. Habilitar SSH

Opción **14** (Enable Secure Shell sshd). Default user: `admin` / `pfsense`.

## Reconfigurar Kali para usar pfSense

Hasta ahora Kali usaba el host Proxmox (192.168.20.1 antes) como gateway. Ahora pfSense ha tomado esa IP. Kali necesita actualizar su default route, pero como su IP estática estaba configurada con gateway 192.168.20.1, **automáticamente apunta a pfSense**. Solo hay que verificar:

```bash
qm guest exec 108 -- bash -c "ip route show; ping -c 2 192.168.20.1"
```

Y que el host Proxmox ya no tenga la IP `.20.1`:

```bash
ip addr del 192.168.20.1/24 dev vmbr0.20
# Añadir IP de gestión para SSH a pfSense desde el host
ip addr add 192.168.20.254/24 dev vmbr0.20
```

## Verificación

```bash
# Kali → internet via pfSense
ssh root@PROXMOX 'qm guest exec 108 -- curl -s -o /dev/null -w "HTTP %{http_code}" https://google.com'
# HTTP 200

# Kali → pfSense LAN
ssh root@PROXMOX 'qm guest exec 108 -- ping -c 2 192.168.20.1'
# 0% packet loss

# SSH a pfSense desde Proxmox
ssh root@PROXMOX 'sshpass -p pfsense ssh admin@192.168.20.1 "ifconfig vtnet0 | grep inet"'
# inet 192.168.10.2 netmask 0xffffff00
```

Y comprobar que el NAT está activo en pfSense:

```bash
sshpass -p pfsense ssh admin@192.168.20.1 'pfctl -sn | grep -i nat'
# nat on vtnet0 inet from 192.168.20.0/24 to any -> 192.168.10.2 port 1024:65535
```

Kali aparece como `192.168.10.2` cuando hace conexiones a Windows VMs. **Esto es importante para los ataques** — el atacante no aparece con su IP real (192.168.20.100) sino con la del firewall, simulando exactamente lo que ocurre cuando un atacante externo pivota a través de un dispositivo perimetral.

## Estado de seguridad por defecto

Por defecto pfSense **bloquea todo el tráfico WAN→LAN**. Esto significa:
- ✅ Kali puede iniciar conexiones hacia Windows VMs (LAN→WAN está permitido)
- ❌ Las Windows VMs **no pueden** iniciar conexiones hacia Kali (WAN→LAN bloqueado)

Esto reproduce el escenario realista: un atacante en Kali ha conseguido acceso, debe **pivotar** desde Kali hacia el dominio sin que el dominio pueda escanearle de vuelta.

Para escenarios de ataque más complejos (callbacks de meterpreter, conexiones reverse), añadiremos reglas específicas en pfSense más adelante.

## WireGuard: acceso al lab desde fuera

Hasta ahora todo el acceso al lab es via SSH al host Proxmox (`qm guest exec`, consolas VNC). Para trabajar realmente con las VMs (RDP a los servidores Windows, abrir el web UI de pfSense, hacer SMB) necesitamos un VPN.

El plan original era WireGuard sobre pfSense, pero acabamos poniéndolo **directamente en el host Proxmox** porque:

1. `wireguard-tools` ya está instalado desde Phase 2
2. El host tiene la IP pública de Hetzner — pfSense no
3. El host ya tiene rutas a `vmbr0.10` y `vmbr0.20`
4. Setup en 5 minutos vs 30+ via la web UI de pfSense

### Server config

```bash
mkdir -p /etc/wireguard && cd /etc/wireguard
umask 077

# Generar claves
wg genkey | tee server-private.key | wg pubkey > server-public.key
wg genkey | tee client-private.key | wg pubkey > client-public.key

cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.99.99.1/24
ListenPort = 51820
PrivateKey = $(cat server-private.key)

PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o vmbr0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o vmbr0 -j MASQUERADE

[Peer]
PublicKey = $(cat client-public.key)
AllowedIPs = 10.99.99.2/32
EOF

sysctl -w net.ipv4.ip_forward=1
systemctl enable --now wg-quick@wg0
```

### Client config (PC del operador)

```ini
[Interface]
PrivateKey = <client-private-key>
Address = 10.99.99.2/24
DNS = 192.168.10.10

[Peer]
PublicKey = <server-public-key>
Endpoint = 95.217.226.229:51820
AllowedIPs = 10.99.99.0/24, 192.168.10.0/24, 192.168.20.0/24
PersistentKeepalive = 25
```

`AllowedIPs` incluye **las dos VLANs del lab**, así puedes RDP a los Windows (192.168.10.x) y SSH a Kali (192.168.20.100) desde tu PC.

### Gotcha: error 0x38 al activar el túnel en Windows

La primera vez que activas el túnel en WireGuard for Windows puede fallar con:

```
Failed to setup adapter (problem code: 0x38)
Unable to create network adapter: The device is not ready for use.
```

Es un problema del driver WinTun cuando había una versión anterior instalada. Solución: **reiniciar el PC**. Después de reboot, abre WireGuard como administrador y el túnel activa sin problemas.

### Verificación

Una vez conectado:

```bash
# Desde tu PC
ping 192.168.10.10              # DC01-kingslanding
ping 192.168.20.100             # KALI-nightking
mstsc /v:192.168.10.10          # RDP a DC01 (vagrant/vagrant)
```

El certificado RDP confirma el hostname `kingslanding`:

![RDP connection showing kingslanding hostname](/assets/img/posts/ad-dfir-lab/wg-rdp-success.png)

A partir de aquí ya tienes una conexión "como si estuvieras dentro" de la red corporativa del lab.

## Acceso desde internet

¿Está pfSense expuesto a internet? **No.** Capas de protección:

1. **IP privada**: pfSense WAN (192.168.10.2) es RFC1918, no enrutable
2. **Sin port forwarding**: el host Proxmox no forwardea ningún puerto al lab
3. **Firewall pfSense**: bloquea todo el tráfico entrante en WAN

Solo el host Proxmox (95.217.226.229) está expuesto, y solo via SSH key + Web UI con auth.

---

*Siguiente: Part 4 — Crowning the Domain Controllers: AD, Forests and Trusts con GOAD*

*Anterior: [Part 2 — The Seven Kingdoms: Deploying Windows VMs]({% post_url es/2026-04-12-ad-dfir-lab-part2-windows-vms %})*
