---
layout: post
title: "Artefactos forenses de Linux para movimiento lateral"
date: 2026-04-07 11:00:00 +0100
category: artifacts
lang: es
ref: artifact-linux-logs
tags: [linux, ssh, lateral-movement, dfir, masstin, logs, utmp, wtmp, btmp, audit]
description: "Guía forense de artefactos Linux para detectar movimiento lateral: /var/log/secure, audit.log, utmp/wtmp/btmp y lastlog para reconstruir sesiones SSH y accesos remotos."
comments: true
---

## Movimiento lateral en Linux: diferente ecosistema, mismos principios

Cuando pensamos en movimiento lateral, la conversación suele centrarse en entornos Windows: EVTX, Kerberos, PsExec, RDP. Pero los entornos empresariales modernos son híbridos, y los atacantes no se detienen en las fronteras del sistema operativo. Servidores Linux, especialmente los que ejecutan servicios web, bases de datos o infraestructura de contenedores, son objetivos frecuentes.

El vector principal de movimiento lateral en Linux es **SSH**. A diferencia de Windows, donde existen múltiples protocolos de acceso remoto (RDP, WMI, WinRM, SMB), en Linux prácticamente todo el acceso remoto pasa por SSH, lo que simplifica el análisis pero también exige conocer exactamente dónde buscar.

[Masstin](/es/tools/masstin-lateral-movement-rust/) soporta el parseo de logs de Linux, integrando la actividad SSH en la misma timeline de movimiento lateral que los artefactos de Windows.

---

## /var/log/secure y /var/log/auth.log

Dependiendo de la distribución, los eventos de autenticación se registran en:
- **/var/log/secure** — Red Hat, CentOS, Fedora, Rocky Linux
- **/var/log/auth.log** — Debian, Ubuntu

Ambos contienen la misma información, solo cambia la ruta.

### Logon SSH exitoso

Un logon SSH exitoso genera una línea como esta:

```
Apr  7 14:23:01 servidor sshd[12345]: Accepted publickey for admin from 10.0.1.50 port 52341 ssh2
```

| Campo | Descripción |
|-------|------------|
| Timestamp | Fecha y hora del evento |
| Hostname | Máquina donde se produjo el logon |
| PID | Process ID del proceso sshd que gestiona la sesión |
| Método | `publickey`, `password`, `keyboard-interactive`, `gssapi-with-mic` (Kerberos) |
| Usuario | Cuenta que inició sesión |
| IP origen | Dirección IP desde la que se conectó |
| Puerto origen | Puerto efímero del cliente |

> **Indicadores de movimiento lateral:**
> - Logon con `password` desde una IP interna que normalmente usa clave pública.
> - Logon como `root` directamente (si `PermitRootLogin` está habilitado).
> - Logon desde una IP no reconocida o fuera de horario laboral.

### Logon SSH fallido

```
Apr  7 14:23:05 servidor sshd[12346]: Failed password for admin from 10.0.1.50 port 52342 ssh2
Apr  7 14:23:06 servidor sshd[12346]: Failed password for invalid user test from 10.0.1.50 port 52343 ssh2
```

| Patrón | Significado |
|--------|-----------|
| `Failed password for <usuario>` | Contraseña incorrecta para usuario existente |
| `Failed password for invalid user <usuario>` | El usuario no existe en el sistema |
| `Connection closed by <IP> [preauth]` | Conexión cerrada antes de completar autenticación |
| `Too many authentication failures` | Múltiples intentos fallidos — fuerza bruta |

> **Detección de fuerza bruta:** Una ráfaga de `Failed password` seguida de un `Accepted password` indica fuerza bruta exitosa.

### Eventos de conexión y desconexión

```
Apr  7 14:23:01 servidor sshd[12345]: Connection from 10.0.1.50 port 52341
Apr  7 14:45:30 servidor sshd[12345]: Disconnected from user admin 10.0.1.50 port 52341
Apr  7 14:45:30 servidor sshd[12345]: pam_unix(sshd:session): session closed for user admin
```

Estos eventos permiten calcular la duración de la sesión y confirmar que la sesión se cerró de forma limpia.

---

## /var/log/messages

En distribuciones basadas en Red Hat, `/var/log/messages` registra eventos del sistema general, incluyendo algunos relacionados con SSH y PAM que no aparecen en `/var/log/secure`.

| Tipo de entrada | Ejemplo | Relevancia |
|----------------|---------|-----------|
| PAM session opened | `pam_unix(sshd:session): session opened for user admin` | Confirma inicio de sesión SSH |
| PAM session closed | `pam_unix(sshd:session): session closed for user admin` | Confirma cierre de sesión |
| systemd-logind | `New session 42 of user admin` | Sesión registrada por systemd |
| su/sudo | `admin : TTY=pts/0 ; COMMAND=/bin/bash` | Escalada de privilegios post-logon |

---

## /var/log/audit/audit.log

El subsistema de auditoría de Linux (auditd) proporciona un nivel de detalle superior al de los logs estándar. Es especialmente útil cuando se configuran reglas específicas para monitorizar SSH y accesos remotos.

### Eventos SSH en audit.log

```
type=USER_AUTH msg=audit(1712502181.123:4567): pid=12345 uid=0 auid=4294967295 ses=4294967295 msg='op=PAM:authentication grantors=pam_unix acct="admin" exe="/usr/sbin/sshd" hostname=10.0.1.50 addr=10.0.1.50 terminal=ssh res=success'
```

| Campo | Descripción |
|-------|------------|
| type | `USER_AUTH` (autenticación), `USER_LOGIN` (logon), `USER_LOGOUT` (logout) |
| pid | PID del proceso sshd |
| acct | Cuenta autenticada |
| exe | Ejecutable que realizó la autenticación |
| hostname / addr | IP de origen |
| res | `success` o `failed` |

Tipos de registro relevantes para movimiento lateral:

| Tipo audit | Descripción |
|-----------|------------|
| USER_AUTH | Resultado de autenticación PAM |
| USER_LOGIN | Logon de usuario completado |
| USER_LOGOUT | Logout de usuario |
| CRED_ACQ | Credenciales adquiridas |
| CRED_DISP | Credenciales liberadas |
| USER_ACCT | Verificación de cuenta (existe, no expirada, etc.) |

> **Ventaja de audit.log:** A diferencia de `/var/log/secure`, audit.log usa un formato estructurado con timestamps Unix precisos, lo que facilita la correlación temporal con otros artefactos.

---

## utmp, wtmp y btmp

Estos son archivos **binarios** que registran información de sesiones de usuario. No se pueden leer con `cat` — requieren herramientas como `who`, `w`, `last`, `lastb` y `utmpdump`.

### utmp — Sesiones activas

**Ubicación:** `/var/run/utmp`

Registra las sesiones actualmente abiertas en el sistema. Es lo que consultan los comandos `who` y `w`.

| Campo | Descripción |
|-------|------------|
| ut_type | Tipo de registro (USER_PROCESS, LOGIN_PROCESS, etc.) |
| ut_user | Nombre de usuario |
| ut_line | Terminal (ej: `pts/0`, `tty1`) |
| ut_host | IP o hostname de origen (para sesiones remotas) |
| ut_time | Timestamp del evento |

> **Limitación:** utmp solo contiene sesiones activas. Cuando una sesión se cierra, se elimina de utmp y se escribe en wtmp.

### wtmp — Historial de sesiones

**Ubicación:** `/var/log/wtmp`

Registra todas las sesiones de logon y logout, incluyendo reinicios del sistema. Es un registro histórico acumulativo.

```bash
last -f /var/log/wtmp
```

Salida típica:
```
admin    pts/0        10.0.1.50        Mon Apr  7 14:23 - 14:45  (00:22)
root     pts/1        10.0.1.100       Mon Apr  7 03:15 - 03:17  (00:02)
reboot   system boot  5.14.0-284.el9   Mon Apr  7 00:00
```

| Información | Relevancia forense |
|-------------|-------------------|
| Usuario + IP origen | Quién se conectó y desde dónde |
| Terminal | `pts/*` = sesión remota (SSH/telnet), `tty*` = consola local |
| Duración | Tiempo de la sesión — sesiones cortas pueden ser automatizadas |
| Reinicios | El evento `reboot` indica arranques del sistema |

> **Análisis forense:** Sesiones de `root` desde IPs internas a las 3 AM con duración de 2 minutos son altamente sospechosas.

### btmp — Intentos de logon fallidos

**Ubicación:** `/var/log/btmp`

Registra todos los intentos de logon fallidos. Es el equivalente Linux del Event ID 4625 de Windows.

```bash
lastb -f /var/log/btmp
```

Salida típica:
```
admin    ssh:notty    10.0.1.50        Mon Apr  7 14:22 - 14:22  (00:00)
root     ssh:notty    192.168.1.200    Mon Apr  7 14:22 - 14:22  (00:00)
test     ssh:notty    10.0.1.50        Mon Apr  7 14:22 - 14:22  (00:00)
```

> **Detección de ataques:**
> - Múltiples entradas desde la misma IP con diferentes usuarios = **password spraying**.
> - Múltiples entradas con el mismo usuario desde la misma IP = **fuerza bruta**.
> - Intentos con usuarios como `admin`, `test`, `root`, `oracle` = **ataque de diccionario**.

---

## lastlog — Último logon por usuario

**Ubicación:** `/var/log/lastlog`

Registra la fecha, hora y origen del último logon exitoso de cada usuario del sistema.

```bash
lastlog
```

Salida típica:
```
Username         Port     From             Latest
root             pts/1    10.0.1.100       Mon Apr  7 03:15:22 +0100 2026
admin            pts/0    10.0.1.50        Mon Apr  7 14:23:01 +0100 2026
www-data                                   **Never logged in**
```

> **Valor forense:** Si una cuenta de servicio como `www-data` o `postgres` muestra un logon reciente, es un fuerte indicador de compromiso — estas cuentas normalmente no tienen logons interactivos.

---

## Tabla resumen de artefactos Linux

| Artefacto | Ubicación | Formato | Qué registra | Herramienta de lectura |
|-----------|-----------|---------|--------------|----------------------|
| secure / auth.log | `/var/log/secure` o `/var/log/auth.log` | Texto | Autenticación SSH (éxitos, fallos, conexiones) | `cat`, `grep` |
| messages | `/var/log/messages` | Texto | Eventos del sistema, PAM, systemd | `cat`, `grep` |
| audit.log | `/var/log/audit/audit.log` | Texto estructurado | Auditoría detallada de autenticación | `ausearch`, `aureport` |
| utmp | `/var/run/utmp` | Binario | Sesiones activas | `who`, `w` |
| wtmp | `/var/log/wtmp` | Binario | Historial de logon/logout | `last` |
| btmp | `/var/log/btmp` | Binario | Logons fallidos | `lastb` |
| lastlog | `/var/log/lastlog` | Binario | Último logon por usuario | `lastlog` |

---

## Cómo masstin parsea artefactos Linux

[Masstin](/es/tools/masstin-lateral-movement-rust/) soporta el parseo de logs de autenticación Linux, extrayendo logons exitosos y fallidos de `/var/log/secure` (y `/var/log/auth.log`), y los normaliza en el mismo formato CSV que utiliza para los artefactos Windows.

```bash
# Directorio con logs extraidos
masstin -a parse-linux -d /evidence/var/log/ -o timeline.csv

# Paquete forense comprimido (extraccion automatica, soporta contrasenas)
masstin -a parse-linux -d /evidence/triage_package/ -o timeline.csv
```

![Salida CLI de masstin parse-linux](/assets/images/masstin_cli_linux.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

Masstin reporta de forma transparente todas las inferencias: identificación del hostname (desde `/etc/hostname`, `dmesg` o la cabecera syslog), inferencia del año (desde `dpkg.log`, `wtmp` o fecha de modificación del fichero) y extracción de ZIPs protegidos con contraseña.

Esto permite crear timelines de movimiento lateral que cruzan las fronteras de sistema operativo: un atacante que se mueve de una workstation Windows a un servidor Linux vía SSH aparecerá en la misma timeline que sus movimientos RDP o SMB.

---

## Compatibilidad entre distribuciones

Los logs de Linux difieren según la distribución, pero masstin los maneja de forma transparente:

| Distribución | Fichero de log | Formato |
|-------------|----------------|---------|
| **Debian, Ubuntu** | `/var/log/auth.log` | RFC3164 (syslog legacy) |
| **RHEL, CentOS, Fedora, Rocky** | `/var/log/secure` | RFC3164 (syslog legacy) |
| **Cualquiera (export journal systemd)** | Variable | RFC5424 (syslog estructurado) |

### Formatos de timestamp

**RFC3164** (el más común en la práctica) usa timestamps sin año:

```
Mar 16 08:25:22 app-1 sshd[4894]: Accepted password for user3 from 192.168.126.1 port 61474 ssh2
```

Dado que RFC3164 no incluye el año, masstin lo infiere automáticamente de ficheros vecinos en el mismo directorio. El orden de prioridad es: `dpkg.log` (contiene fechas completas `YYYY-MM-DD`), `wtmp` (timestamps epoch con año), fecha de modificación del fichero, y año actual como último recurso. Masstin reporta qué infiere y de qué fuente lo obtiene, para que el analista siempre conozca la base de los timestamps.

Lo mismo aplica a la identificación del hostname: masstin comprueba `/etc/hostname`, `dmesg`, `/etc/hosts`, y como fallback extrae el hostname de la propia cabecera syslog. Todas las inferencias se reportan de forma transparente en la salida.

**RFC5424** (syslog estructurado) incluye timestamps completos con zona horaria:

```
<38>1 2024-03-16T08:25:22+00:00 app-1 sshd 4894 - - Accepted password for user3 from 192.168.126.1 port 61474 ssh2
```

Este formato se utiliza cuando se exporta el journal de systemd o cuando rsyslog está configurado con salida estructurada.

### Soporte de triage comprimido

Al igual que `parse-windows`, `parse-linux` puede procesar paquetes de triage comprimidos directamente. Descomprime archivos ZIP de forma recursiva — incluyendo archivos **protegidos con contraseña** utilizando contraseñas forenses comunes (`cyberdefenders.org`, `infected`, `malware`, `password`). Cuando se detecta y desbloquea un archivo protegido, masstin notifica al usuario.

---

## Conclusión

En entornos híbridos, ignorar los artefactos Linux deja puntos ciegos críticos en la investigación. Los logs de autenticación SSH, los registros binarios utmp/wtmp/btmp y audit.log proporcionan la misma riqueza forense que los EVTX de Windows — solo hay que saber dónde buscar.

[Masstin](/es/tools/masstin-lateral-movement-rust/) unifica estos artefactos con los de Windows para darte una visión completa del movimiento lateral a través de toda la infraestructura.
