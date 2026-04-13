---
layout: post
title: "AD DFIR Lab — Part 6: Ravens and Whispers — Configuración de auditoría con Sysmon y auditd"
date: 2026-04-13 12:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part6
tags: [dfir, sysmon, auditd, audit-policy, powershell-logging, lab]
description: "Instrumentamos las 7 máquinas del dominio con la auditoría necesaria para capturar artefactos forenses durante los ataques. Sysmon con sysmon-modular en Windows, auditd con 50 reglas DFIR en Linux, PowerShell logging completo, y dimensionamiento conservador de logs para un servidor con disco limitado."
comments: true
---

*Esta es la Part 6 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Configuramos toda la auditoría antes de ejecutar los ataques — si no lo hacemos ahora, los ataques no dejarán rastro.*

## Por qué auditar antes de atacar

Un lab DFIR sin auditoría es como investigar un crimen sin cámaras de seguridad. Los ataques ocurren, pero cuando llegas a investigar **no queda nada**. Por eso Phase 8 va antes de Phase 9 (attacks): primero instrumentamos, después atacamos, y entonces los artefactos están ahí para analizarlos.

Lo que vamos a capturar:

**Windows:**
- **Sysmon** con `sysmon-modular` de olafhartong (2704 líneas de reglas)
- **Windows Advanced Audit Policy** vía `auditpol` (no GPO)
- **PowerShell logging**: Script Block (4104), Module (4103), Transcription
- **Command line en 4688**
- **Logs operacionales**: WinRM, WMI-Activity, TaskScheduler

**Linux:**
- **auditd** con 50 reglas DFIR (exec, auth, sudo, ssh, sssd, systemd, cron, priv esc)
- **journald persistente** en `/var/log/journal/`

## Windows: Sysmon con sysmon-modular

El Sysmon que trae GOAD es de 2021 (v13) y usa la config SwiftOnSecurity. Nosotros usamos la **última versión de Sysmon** (v15+) con **sysmon-modular de Olaf Hartong**, que tiene mejor cobertura para técnicas MITRE ATT&CK modernas.

```bash
# En el host Proxmox
cd /root/lab/audit
wget https://download.sysinternals.com/files/Sysmon.zip
wget https://raw.githubusercontent.com/olafhartong/sysmon-modular/master/sysmonconfig.xml
# 2704 líneas de reglas con mapping a MITRE ATT&CK
```

Y el playbook Ansible instala Sysmon en las 6 Windows VMs:

```yaml
- name: Copy Sysmon.zip to Windows VM
  ansible.windows.win_copy:
    src: /root/lab/audit/Sysmon.zip
    dest: 'C:\sysmon\Sysmon.zip'

- name: Unzip Sysmon
  community.windows.win_unzip:
    src: 'C:\sysmon\Sysmon.zip'
    dest: 'C:\sysmon'

- name: Copy sysmon-modular config
  ansible.windows.win_copy:
    src: /root/lab/audit/sysmonconfig.xml
    dest: 'C:\sysmon\sysmonconfig.xml'

- name: Install Sysmon (first time)
  ansible.windows.win_command: 'C:\sysmon\Sysmon64.exe -accepteula -i C:\sysmon\sysmonconfig.xml'
  when: sysmon_svc.exists is not defined or not sysmon_svc.exists

- name: Update Sysmon config (if already installed)
  ansible.windows.win_command: 'C:\sysmon\Sysmon64.exe -c C:\sysmon\sysmonconfig.xml'
  when: sysmon_svc.exists is defined and sysmon_svc.exists
```

La lógica está bien pensada: si es una instalación nueva, usa `-i`; si ya estaba instalado, usa `-c` para actualizar la config sin reinstalar.

### Eventos Sysmon clave que captura la config modular

| ID | Evento | Para qué |
|----|--------|----------|
| 1 | ProcessCreate | **Con command line** — base de todo el análisis |
| 3 | NetworkConnect | Conexiones salientes |
| 7 | ImageLoaded | DLLs cargadas (detección de DLL sideloading) |
| 8 | CreateRemoteThread | Inyección de procesos |
| 10 | ProcessAccess | Apertura de handles a otros procesos (mimikatz → lsass.exe) |
| 11 | FileCreate | Creación de archivos en paths sospechosos |
| 13 | RegistryValueSet | Modificación del registro (persistencia) |
| 22 | DnsQuery | Resolución DNS — gold para detectar C2 |

Después de los ataques, tendremos miles de estos eventos en `Microsoft-Windows-Sysmon/Operational.evtx`.

## Windows Advanced Audit Policy

Sysmon es genial pero no capta todo. El **Security.evtx** es quien tiene los eventos de Kerberos (4768, 4769), logons (4624, 4625), y DCSync (4662). Hay que activarlo explícitamente con `auditpol`:

```yaml
- name: Enable Account Logon auditing (4768-4776 Kerberos)
  ansible.windows.win_shell: |
    auditpol /set /subcategory:"Credential Validation" /success:enable /failure:enable
    auditpol /set /subcategory:"Kerberos Authentication Service" /success:enable /failure:enable
    auditpol /set /subcategory:"Kerberos Service Ticket Operations" /success:enable /failure:enable

- name: Enable DS Access (4662 — DCSync detection)
  ansible.windows.win_shell: |
    auditpol /set /subcategory:"Directory Service Access" /success:enable /failure:enable
    auditpol /set /subcategory:"Directory Service Changes" /success:enable /failure:enable
    auditpol /set /subcategory:"Directory Service Replication" /success:enable /failure:enable
```

Categorías activadas (Success + Failure):

| Categoría | Eventos importantes |
|-----------|---------------------|
| Account Logon | 4768 (TGT request), 4769 (TGS request), 4771, 4776 |
| Logon/Logoff | 4624 (success), 4625 (failure), 4634, 4647, 4648, 4672 (special) |
| Object Access | 5140/5145 (file share), 4656 (handle), 4663 (access) |
| **DS Access** | **4662 (DCSync detection)** |
| Detailed Tracking | 4688 (process creation), 4689 (termination) |
| Privilege Use | 4673, 4674 |
| Account Management | 4720-4738 (user changes), 4726 (delete) |
| Policy Change | 4719, 4907 |

### Command line en 4688

Por defecto el Event 4688 solo registra el nombre del ejecutable, no los argumentos. Para DFIR esto es **inútil** — necesitas ver qué parámetros usó el atacante. Se activa con una clave de registro:

```yaml
- name: Enable command line in 4688
  ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit
    name: ProcessCreationIncludeCmdLine_Enabled
    data: 1
    type: dword
```

Sin esto, verías `powershell.exe` pero no `powershell.exe -enc SQBFAHgA...`. Con esto, capturas el payload completo.

## PowerShell logging

Los atacantes usan PowerShell para todo. Sin logging de PowerShell, pierdes la mitad de los artefactos de un incidente moderno. Tres niveles:

```yaml
# Script Block Logging — Event 4104 (el más importante)
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging
    name: EnableScriptBlockLogging
    data: 1
    type: dword

# Module Logging — Event 4103 (todos los módulos)
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging
    name: EnableModuleLogging
    data: 1
    type: dword

- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging\ModuleNames
    name: '*'
    data: '*'
    type: string

# Transcription — archivos de texto con todo lo escrito
- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription
    name: EnableTranscripting
    data: 1
    type: dword

- ansible.windows.win_regedit:
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription
    name: OutputDirectory
    data: 'C:\PSTranscripts'
    type: string
```

Con esto:
- **Event 4104**: cualquier bloque de script que PowerShell ejecuta (incluso si está obfuscado con Base64, se decodifica antes del log)
- **Event 4103**: cada comando individual de cada módulo
- **Transcription**: archivos de texto en `C:\PSTranscripts` con toda la sesión

## Dimensionamiento de logs (importante para disco limitado)

El servidor Hetzner tiene 2×512 GB NVMe en RAID1, con ~310 GB libres en el pool ZFS tras crear todas las VMs. Los logs pueden crecer rápido si no los limitamos.

**Cálculo conservador (per-VM y total)**:

| Log | Por VM | Total 6 Windows |
|-----|--------|-----------------|
| Security | 512 MB | 3 GB |
| Sysmon | 512 MB | 3 GB |
| PowerShell Operational | 256 MB | 1.5 GB |
| WinRM Operational | 128 MB | 768 MB |
| WMI-Activity | 128 MB | 768 MB |
| TaskScheduler | 128 MB | 768 MB |
| **Subtotal Windows** | **~1.6 GB** | **~10 GB** |
| auditd Linux | - | 600 MB |
| journald | - | 500 MB |
| **TOTAL** | | **~11 GB** |

Con 310 GB libres en ZFS, el ratio de seguridad es ~28x. Cómodo.

```yaml
# Tamaños aplicados con wevtutil
- ansible.windows.win_shell: wevtutil sl Security /ms:536870912
- ansible.windows.win_shell: wevtutil sl Microsoft-Windows-Sysmon/Operational /ms:536870912
- ansible.windows.win_shell: wevtutil sl Microsoft-Windows-PowerShell/Operational /ms:268435456
```

**Gotcha**: los tamaños iniciales que puse (1GB cada uno) eran excesivos para un lab en servidor compartido. La primera iteración llegaba a ~24 GB de logs potenciales. Revisando los ratios de disco antes de lanzar los ataques me di cuenta y bajé los valores. **Siempre calcula el peor caso antes de activar auditoría completa en un entorno con disco limitado.**

## Linux: auditd con reglas DFIR

Para Ubuntu (LNX01), usamos `auditd` con reglas enfocadas a DFIR, no cumplimiento:

```
## ======= AUTHENTICATION =======
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k identity
-w /etc/sudoers.d/ -p wa -k identity

## ======= PROCESS EXECUTION =======
-a always,exit -F arch=b64 -S execve -k exec
-a always,exit -F arch=b32 -S execve -k exec

## ======= SUDO (uid != euid = escalated) =======
-a always,exit -F arch=b64 -S execve -C uid!=euid -F euid=0 -k sudo_exec

## ======= SSH =======
-w /etc/ssh/sshd_config -p wa -k sshd
-w /root/.ssh/ -p wa -k root_ssh

## ======= PRIVILEGE ESCALATION =======
-w /bin/su -p x -k priv_esc
-w /usr/bin/sudo -p x -k priv_esc
-w /usr/bin/pkexec -p x -k priv_esc

## ======= KERNEL MODULES =======
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules

## ======= SSSD / KERBEROS =======
-w /etc/sssd/ -p wa -k sssd
-w /etc/krb5.conf -p wa -k kerberos
-w /etc/krb5.keytab -p wa -k kerberos

## ======= CRON / SYSTEMD =======
-w /etc/cron.d/ -p wa -k cron
-w /etc/crontab -p wa -k cron
-w /var/spool/cron/ -p wa -k cron
-w /etc/systemd/ -p wa -k systemd
```

50 reglas en total, con keys para filtrado rápido:

```bash
# Buscar ejecuciones privilegiadas
sudo ausearch -k sudo_exec --start recent

# Buscar modificaciones a /etc/passwd
sudo ausearch -k identity

# Buscar intentos de autenticación SSSD
sudo ausearch -k sssd
```

### Tamaño auditd

Configurado para 600MB total (200MB × 3 archivos) con rotación automática:

```
max_log_file = 200
num_logs = 3
max_log_file_action = ROTATE
```

Y **journald persistente** (sobrevive reboots), limitado a 500 MB:

```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
Storage=persistent
```

## Verificación post-deployment

```bash
# Sysmon corriendo en Windows
ansible -i goad/inventory dc01 -m win_shell -a '(Get-Service sysmon64).Status'
# Running

# Cantidad de eventos Sysmon capturados ya
ansible -i goad/inventory dc01 -m win_shell -a '(Get-WinEvent -ListLog Microsoft-Windows-Sysmon/Operational).RecordCount'
# 1660

# Audit policy activa
ansible -i goad/inventory dc01 -m win_shell -a 'auditpol /get /category:* | Select-String "Success and Failure"'
# System Integrity         Success and Failure
# Logon                    Success and Failure
# Process Creation         Success and Failure
# ...

# auditd en Linux
ssh ubuntu@192.168.10.32 'sudo auditctl -l | wc -l'
# 50
```

Las 7 máquinas del dominio están instrumentadas. Cuando lancemos los ataques en Phase 9, cada técnica dejará huellas en los EVTX/logs que podremos analizar después con herramientas como [masstin](https://github.com/jupyterj0nes/masstin).

---

*Siguiente: Part 7 — Fire and Blood: Attack Scenarios and Forensic Analysis (próximamente)*

*Anterior: [Part 5 — The Smallfolk: Users, Groups and Vulnerabilities]({% post_url es/2026-04-13-ad-dfir-lab-part5-users-vulns %})*
