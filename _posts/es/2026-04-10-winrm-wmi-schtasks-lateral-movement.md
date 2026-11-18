---
layout: post
title: "WinRM, WMI y Scheduled Tasks: artefactos ocultos de movimiento lateral"
date: 2026-04-10 01:00:00 +0100
category: artifacts
section: lateral-windows
order: 40
lang: es
ref: artifact-winrm-wmi-schtasks
tags: [masstin, winrm, wmi, scheduled-tasks, lateral-movement, dfir, evtx, artefactos]
description: "Cómo masstin extrae evidencia de movimiento lateral de WinRM, WMI-Activity y Scheduled Tasks — fuentes frecuentemente ignoradas en el análisis EVTX tradicional."
comments: true
---

## Más allá de Security.evtx

La mayoría de la detección de movimiento lateral se centra en Security.evtx — Event IDs 4624, 4625, 5140 y compañía. Pero cuando los atacantes borran logs, deshabilitan la auditoría, o usan técnicas que eluden los eventos estándar de autenticación, estas tres fuentes de artefactos pueden cubrir los huecos:

- **WinRM/Operational** — Sesiones de PowerShell Remoting
- **WMI-Activity/Operational** — Ejecución remota de comandos WMI
- **Scheduled Tasks XML** — Tareas registradas desde una máquina remota

Masstin parsea las tres automáticamente desde imágenes forenses. Sin configuración extra, sin extracción manual.

## WinRM/Operational — Event ID 6

Cuando un atacante usa PowerShell Remoting (`Enter-PSSession`, `Invoke-Command`), el **sistema origen** registra el Event ID 6 en `Microsoft-Windows-WinRM/Operational`. Este evento contiene el campo `connection` con el hostname o IP de destino:

```
connection: dc01.domain.local/wsman?PSVersion=5.1.17763.592
```

Masstin extrae el host destino de este campo y genera un evento `CONNECT`. La columna `detail` conserva la cadena de conexión completa para contexto.

**Punto clave:** Este evento se registra en el **origen** (la máquina del atacante), no en el destino. Si tienes imágenes de ambos sistemas, el Event 6 de WinRM te da la conexión saliente que otros logs no capturan.

| Campo | Valor |
|-------|-------|
| `dst_computer` | Host destino (sacado de la cadena de conexión del evento) |
| `src_computer` | Sistema origen (la máquina donde se registró el evento) |
| `event_id` | `6` |
| `event_type` | `CONNECT` |
| `detail` | `WinRM: <cadena de conexión completa>` |

**Filtrado:** Masstin filtra automáticamente conexiones localhost (`localhost`, `127.0.0.1`, `::1`) y auto-conexiones (hostname destino = hostname origen), incluyendo comparaciones FQDN vs NetBIOS.

## WMI-Activity/Operational — Event ID 5858

La ejecución remota de WMI (`wmic /node:host process call create`) genera el Event ID 5858 en el **sistema destino**. Este evento contiene el campo `ClientMachine` — el hostname de la máquina que inició la conexión WMI:

| Campo | Valor |
|-------|-------|
| `dst_computer` | Sistema destino (donde se ejecutó WMI) |
| `src_ip` / `src_computer` | `ClientMachine` (origen de la conexión WMI) |
| `target_user_name` | Cuenta de usuario utilizada para la llamada WMI |
| `event_id` | `5858` |
| `event_type` | `CONNECT` |
| `detail` | `WMI: <operación WQL>` (truncada a 100 caracteres) |

**Filtrado:** Masstin solo genera eventos cuando `ClientMachine` difiere del nombre `Computer` local. Esto elimina la gran mayoría del ruido WMI (Group Policy local, tareas programadas, etc.). La comparación FQDN vs nombre corto se maneja automáticamente. Las cuentas de sistema (`SYSTEM`, `LOCAL SERVICE`, `NETWORK SERVICE`) también se filtran.

**Por qué importa:** WMI es una de las técnicas de movimiento lateral más sigilosas. A diferencia de PsExec (que crea servicios) o RDP (que genera logging extenso), WMI deja rastros mínimos. El Event 5858 es frecuentemente el **único** artefacto en el sistema destino.

## Scheduled Tasks — Registro remoto

Cuando un atacante programa una tarea remotamente (vía `schtasks /CREATE /S target` o herramientas similares), el fichero XML de la tarea en `Windows\System32\Tasks\` registra la **máquina origen** en el campo `<Author>`:

```xml
<RegistrationInfo>
    <Author>ATTACKER-PC\admin</Author>
    <Date>2024-03-15T14:30:00</Date>
    <URI>\TareaMaliciosa</URI>
</RegistrationInfo>
<Actions>
    <Exec>
        <Command>C:\temp\payload.exe</Command>
    </Exec>
</Actions>
```

El campo Author guarda quién registró la tarea, normalmente como `MÁQUINA\usuario` o `DOMINIO\usuario`. Cuando la parte de la máquina no es la del propio equipo, la tarea pudo registrarse desde otro sitio, y eso es lo que masstin señala.

| Campo | Valor |
|-------|-------|
| `dst_computer` | Nombre de la máquina donde está la tarea (sacado de sus EVTX) |
| `src_computer` | La parte de máquina o dominio del campo Author |
| `target_user_name` | Nombre de usuario del campo Author |
| `event_id` | `SCHTASK` |
| `event_type` | `CONNECT` |
| `detail` | `Task: <nombre> -> <comando>` |
| `log_filename` | `image.e01:tasks:<NombreTarea>` |

**Filtrado, y sus límites:** masstin saca el nombre de la máquina de sus propios EVTX y lo compara con el del Author. Solo señala las tareas en las que no coinciden. Es una **pista, no una prueba**: también lo cumplen una tarea creada localmente con una cuenta de dominio (el prefijo es el dominio, no la máquina) y una máquina a la que se le cambió el nombre después de crear la tarea. Antes de afirmar que una tarea vino de fuera, comprueba que el nombre del Author es de verdad otra máquina de la red.

**Por qué importa:** Las Scheduled Tasks son un mecanismo común de persistencia y movimiento lateral. Incluso cuando los atacantes eliminan la tarea después de la ejecución (limpiando Event IDs 4698/4699), el fichero XML puede seguir existiendo en disco — o ser recuperable desde snapshots VSS.

## Cómo masstin maneja estos artefactos

Los tres tipos de artefactos se extraen automáticamente cuando `parse` lee una imagen de disco:

```bash
masstin -a parse -d /evidence/ -o timeline.csv
```

Para cada imagen forense:

1. **Recorrido NTFS** extrae ficheros EVTX (incluyendo `WinRM/Operational` y `WMI-Activity/Operational`)
2. **Extracción de tareas** copia recursivamente todos los ficheros de `Windows\System32\Tasks\`
3. **Parsing EVTX** aplica los filtros de WinRM Event 6 y WMI Event 5858
4. **Parsing de tareas** lee cada XML, decodifica UTF-16 si es necesario, y comprueba el campo Author
5. **Resolución de hostname** lee el campo Computer de los propios EVTX de la imagen para filtrar correctamente local vs remoto
6. Todos los eventos se fusionan en la timeline CSV unificada

Los eventos resultantes aparecen junto a los eventos estándar de Security.evtx y se pueden cargar directamente en Neo4j o Memgraph para visualización en grafos — la relación `src_computer` → `dst_computer` crea aristas en el grafo de movimiento lateral.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Análisis de imágenes forenses y recuperación VSS | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
| Eventos SMB en EVTX | [Eventos SMB](/es/artifacts/smb-evtx-events/) |
