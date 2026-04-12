---
layout: post
title: "MountPoints2: Evidencia de movimiento lateral oculta en el registro de Windows"
date: 2026-04-12 01:00:00 +0100
category: artifacts
lang: es
ref: artifact-mountpoints2
tags: [masstin, registro, ntuser, mountpoints2, movimiento-lateral, dfir, forense]
description: "La clave de registro MountPoints2 en NTUSER.DAT revela qué usuarios se conectaron a qué shares remotos — incluso después de borrar los logs de eventos. Masstin extrae y parsea estas claves automáticamente desde imágenes forenses."
comments: true
---

## Cuando los logs desaparecen, el registro recuerda

Un atacante compromete un servidor, se mueve lateralmente vía shares SMB, y borra los logs de eventos antes de exfiltrar datos. El Security.evtx está vacío. Los logs de SMBClient han desaparecido. Pero en lo más profundo del registro de cada usuario, la clave **MountPoints2** registra silenciosamente cada share remoto que se montó — y sobrevive al borrado de logs, porque no es un log.

## ¿Qué es MountPoints2?

Cada vez que un usuario de Windows se conecta a un share remoto (`\\SERVIDOR\SHARE`), Windows Explorer registra la conexión en el registro del usuario:

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2
```

Cada subclave representa un volumen montado o un share de red. Los shares de red usan `#` en lugar de `\` en el nombre de la clave:

| Subclave | Significa |
|----------|-----------|
| `##DC01#ADMIN$` | `\\DC01\ADMIN$` — share admin del controlador de dominio |
| `##192.168.1.22#c$` | `\\192.168.1.22\C$` — share del disco C: vía IP |
| `##FILESERVER#Projects` | `\\FILESERVER\Projects` — share de ficheros |
| `##10.0.0.5#IPC$` | `\\10.0.0.5\IPC$` — conexión IPC (frecuente en PsExec) |

## Valor forense

Cada subclave tiene un **LastWriteTime** — la última vez que se accedió a ese share. Combinado con la ubicación del NTUSER.DAT (`Users\<usuario>\NTUSER.DAT`), se obtienen tres piezas de información críticas:

1. **Quién** — el nombre de usuario (de la ruta del fichero NTUSER.DAT)
2. **Hacia dónde** — el servidor remoto y nombre del share (de la subclave)
3. **Cuándo** — el timestamp (del LastWriteTime)

Esto crea una **arista directa en el grafo de movimiento lateral**: `usuario@máquina_origen → servidor_remoto`.

### Los shares administrativos son señales de alerta

La presencia de shares administrativos (`C$`, `ADMIN$`, `IPC$`) en MountPoints2 es un indicador fuerte de movimiento lateral. Los usuarios legítimos raramente acceden a shares administrativos — pero PsExec, CrackMapExec y el movimiento manual de atacantes los usan constantemente.

## Cómo extrae masstin MountPoints2

Durante `parse-image`, masstin automáticamente:

1. **Encuentra todos los perfiles de usuario** en `Users\*\` en cada partición NTFS
2. **Extrae NTUSER.DAT** de cada perfil (salta Default, Public, perfiles del sistema)
3. **Parsea el hive del registro** usando el crate `notatin` con:
   - Soporte de transaction logs (`.LOG1`, `.LOG2`) para hives sucios/no cerrados
   - Recuperación de claves borradas para hives donde el atacante intentó limpiar
4. **Navega a MountPoints2** y extrae todas las subclaves `##*` (shares de red)
5. **Genera eventos CONNECT** con máquina origen, servidor destino, usuario y timestamp

```bash
# Automático — MountPoints2 se extrae junto con EVTX, UAL, VSS y Tasks
masstin -a parse-image -f servidor.e01 -o timeline.csv
```

Salida en el resumen:
```
  Extracted: 424 EVTX + 5 UAL + 10 Tasks + 3 NTUSER.DAT
  => 2 MountPoints2 remote share events found
```

## Salida CSV

Los eventos MountPoints2 aparecen en la timeline como eventos `CONNECT` con `event_id = MountPoints2`:

| Columna | Valor |
|---------|-------|
| `time_created` | LastWriteTime de la subclave del registro |
| `dst_computer` | Servidor remoto (ej: `74.118.139.11`, `DC01`) |
| `event_type` | `CONNECT` |
| `event_id` | `MountPoints2` |
| `target_user_name` | Usuario que se conectó (de la ruta del NTUSER.DAT) |
| `src_computer` | Máquina donde se encontró el registro |
| `src_ip` | Dirección IP si el servidor se accedió por IP |
| `detail` | Ruta UNC completa (ej: `MountPoints2: \\74.118.139.11\M4Projects`) |
| `log_filename` | Fichero origen (ej: `HRServer.e01:live:mpowers_NTUSER.DAT`) |

## Ejemplo real

Procesando las imágenes del DEFCON DFIR CTF 2018 con masstin:

```csv
2018-07-12T21:24:27+00:00,74.118.139.11,CONNECT,MountPoints2,"",mpowers,"",DESKTOP-1N4R894,74.118.139.11,...,MountPoints2: \\74.118.139.11\M4Projects
2018-07-23T16:00:53+00:00,74.118.139.11,CONNECT,MountPoints2,"",mpowers,"",WIN-29U41M70JCO,74.118.139.11,...,MountPoints2: \\74.118.139.11\M4Projects
```

El usuario `mpowers` se conectó a `\\74.118.139.11\M4Projects` desde dos máquinas diferentes — evidencia de movimiento lateral que **no aparece en ningún fichero EVTX**. Esto se encontró exclusivamente en el registro.

## Hives sucios y transaction logs

Las imágenes forenses frecuentemente contienen hives de registro sucios — el sistema no se apagó limpiamente (común en respuesta a incidentes: tirar del cable, adquisición forense en caliente, etc.). Los hives sucios tienen cambios no confirmados en los transaction logs (`.LOG1`, `.LOG2`).

Masstin usa la librería `notatin` (de Stroz Friedberg) que:

- Detecta hives sucios y aplica los transaction logs automáticamente
- Recupera celdas de registro borradas (claves que el atacante intentó eliminar)
- Maneja tanto hives limpios como sucios de forma transparente

Si se encuentran transaction logs junto al NTUSER.DAT en la imagen forense, se extraen y aplican automáticamente.

## Comparación con otros artefactos de movimiento lateral

| Artefacto | ¿Sobrevive al borrado de logs? | ¿Muestra usuario? | ¿Muestra destino? | ¿Muestra timestamp? |
|-----------|-------------------------------|--------------------|--------------------|---------------------|
| Security.evtx (4624) | No | Sí | Sí | Sí |
| UAL (.mdb) | Sí | Sí | Solo IP | Sí |
| MountPoints2 | **Sí** | **Sí** | **Servidor + Share** | **Sí** |
| Scheduled Tasks XML | Sí | Parcial | Máquina del Author | Sí |
| VSS (EVTX recuperados) | Depende | Sí | Sí | Sí |

MountPoints2 es único porque proporciona el **nombre del share** (ej: `C$`, `ADMIN$`, `Projects`) — ningún otro artefacto da este nivel de detalle sobre a qué accedió el atacante.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Imágenes forenses y recuperación VSS | [parse-image](/es/tools/masstin-vss-recovery/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| WinRM, WMI y Scheduled Tasks | [WinRM/WMI/Tasks](/es/artifacts/winrm-wmi-schtasks-lateral-movement/) |
| Eventos SMB en EVTX | [Eventos SMB](/es/artifacts/smb-evtx-events/) |
