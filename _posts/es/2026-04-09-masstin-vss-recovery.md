---
layout: post
title: "Análisis de imágenes forenses: auto-detección cross-OS y recuperación VSS con Masstin"
date: 2026-04-09 01:00:00 +0100
category: tools
lang: es
ref: tool-masstin-vss-recovery
tags: [masstin, vss, shadow-copy, forensics, dfir, evtx, herramientas]
description: "El comando parse-image de masstin auto-detecta el SO por partición (NTFS/ext4), extrae EVTX+UAL+VSS de Windows y logs de Linux desde imágenes forenses, y fusiona todo en una única timeline."
comments: true
---

## Un comando, cualquier SO, cualquier imagen

Un incidente de ransomware golpea tu red. Recibes una carpeta llena de imágenes forenses — controladores de dominio Windows, servidores web Linux, servidores de ficheros — todos mezclados. Tradicionalmente, necesitarías identificar cada SO, montar cada imagen, ejecutar herramientas separadas para Windows y Linux, y luego fusionar los resultados manualmente.

**El comando `parse-image` de masstin lo hace todo en un solo paso.** Auto-detecta el sistema operativo de cada partición dentro de cada imagen y aplica el parser correcto automáticamente:

- **¿Partición NTFS detectada?** → Extrae EVTX + UAL del volumen activo, recupera logs borrados de snapshots VSS, deduplica
- **¿Partición ext4 detectada?** → Extrae auth.log, secure, messages, audit.log, wtmp, btmp, lastlog, infiere hostname y año

Todos los resultados se fusionan en un **único CSV cronológico** — logons RDP de Windows y sesiones SSH de Linux lado a lado.

```bash
# Una imagen — SO auto-detectado
masstin -a parse-image -f HRServer_Disk0.e01 -o timeline.csv

# Imágenes mixtas Windows + Linux — una sola timeline fusionada
masstin -a parse-image -f DC01.e01 -f ubuntu-web.vmdk -o incident.csv

# Apunta a carpeta de evidencia — encuentra todas las imágenes, cualquier SO
masstin -a parse-image -d /evidence/all_machines/ -o full_timeline.csv
```

Para cada imagen, masstin:

1. **Abre la imagen forense** (E01, dd/raw o VMDK)
2. **Encuentra todas las particiones** automáticamente (GPT y MBR)
3. **Identifica el SO** por partición (firma NTFS o superbloque ext4)
4. **Extrae artefactos Windows** de NTFS: EVTX + UAL del volumen activo
5. **Recupera logs borrados** de snapshots VSS usando [vshadow-rs](/es/tools/vshadow-rs/)
6. **Extrae logs Linux** de ext4: auth.log, wtmp, audit.log, etc.
7. **Parsea cada fuente** con su parser nativo
8. **Fusiona y deduplica** en una única timeline

![Salida de masstin parse-image-windows](/assets/images/masstin_cli_parse_image.png){: style="display:block; margin: 1rem auto; max-width: 100%;" }

## Ejemplo

Procesando una imagen E01 de 50 GB de un Windows Server donde el atacante había borrado los logs de eventos:

| Métrica | Resultado |
|---------|-----------|
| Tamaño de imagen | 50.00 GB |
| Partición NTFS | 1 (offset 0x1F500000) |
| Snapshots VSS | 1 (creado 2018-08-07, 149.9 MB delta) |
| EVTX del volumen activo | 296 ficheros |
| EVTX del store VSS | 128 ficheros |
| Total tras dedup | 424 EVTX únicos |
| Eventos del live | 6,947 |
| Eventos recuperados del VSS | 34,586 |
| **Total eventos únicos** | **41,533** |
| Duplicados eliminados | 1,406 |
| **Tiempo de procesamiento** | **~5 segundos** |

El snapshot VSS contenía **34,586 eventos que ya no estaban en el volumen activo** — incluyendo el Security.evtx con el historial completo de autenticación que el atacante había borrado.

## Trazabilidad del origen

Cada evento en el CSV de salida incluye un `log_filename` descriptivo que indica exactamente de dónde viene — tanto para fuentes Windows como Linux:

```
HRServer_Disk0.e01:live:Security.evtx                    ← Windows: volumen activo
HRServer_Disk0.e01:vss_0:Security.evtx                   ← Windows: recuperado del snapshot VSS 0
HRServer_Disk0.e01:UAL:Current.mdb                       ← Windows: base de datos UAL
kali-linux.vmdk:partition_0:/var/log/auth.log             ← Linux: auth.log desde ext4
ubuntu-server.e01:partition_0:/var/log/wtmp               ← Linux: registros de login wtmp
```

Esto permite al analista distinguir inmediatamente entre evidencia actual, evidencia recuperada y el sistema operativo de origen.

## Múltiples imágenes, sistemas operativos mezclados

Para incidentes a gran escala, apunta masstin a cualquier combinación de imágenes forenses Windows y Linux:

```bash
masstin -a parse-image \
  -f DC01.e01 \
  -f SRV-FILE.e01 \
  -f linux-web.vmdk \
  -f ubuntu-db.e01 \
  -o full-incident-timeline.csv
```

Cada imagen se procesa independientemente: particiones detectadas, SO identificado por partición, artefactos apropiados extraídos (EVTX + UAL + VSS para Windows, auth.log + wtmp para Linux), y todo fusionado en una única timeline que abarca todas las máquinas y sistemas operativos.

O simplemente apunta a una carpeta de evidencia:

```bash
masstin -a parse-image -d /evidence/ -o timeline.csv
```

Masstin encuentra recursivamente todas las imágenes E01, VMDK y dd/raw en la carpeta, auto-detecta el SO de cada una, y produce un único CSV unificado.

## Detalle de logons fallidos

Cuando masstin encuentra un logon fallido (Event 4625), la columna `detail` muestra una descripción legible:

| detail | Significado |
|--------|-------------|
| `Wrong password (0xC000006A)` | Contraseña incorrecta |
| `User does not exist (0xC0000064)` | Cuenta no encontrada |
| `Account locked out (0xC0000234)` | Demasiados intentos fallidos |
| `Account disabled (0xC0000072)` | Cuenta deshabilitada |
| `Expired password (0xC0000071)` | Contraseña expirada |

## Detección de BitLocker

Masstin detecta automáticamente particiones cifradas con BitLocker leyendo la firma del Volume Boot Record. BitLocker reemplaza la firma estándar `NTFS    ` en el offset 3 del VBR por `-FVE-FS-`. Cuando se detecta, masstin:

- Muestra un **aviso amarillo** con el offset exacto de la partición
- **Salta** la partición cifrada (los artefactos no son legibles sin la clave de recuperación)
- Reporta el **recuento de BitLocker** en el resumen de particiones (ej: `Partitions: 1 NTFS, 1 BitLocker`)
- Si **todas** las particiones están cifradas, muestra un error claro: `All NTFS partitions are BitLocker-encrypted — recovery key required`

Esto evita el escenario confuso donde miles de EVTX se extraen con tamaños correctos pero cero eventos — el analista sabe inmediatamente por qué.

## Soporte de formatos VMDK

El parser VMDK propio de masstin maneja todos los formatos comunes encontrados en evidencia forense:

| Formato | Origen | Funcionamiento |
|---------|--------|----------------|
| **Monolithic sparse** | VMware Workstation por defecto | Un solo `.vmdk` con tablas de grains sparse |
| **Split sparse** | VMware Workstation (dividido) | Descriptor `.vmdk` + extensiones `-s001.vmdk`, `-s002.vmdk` — ensamblado automático |
| **Flat (monolítico)** | VMware ESXi / vSphere | Descriptor `.vmdk` + fichero de datos `-flat.vmdk` |
| **streamOptimized** | Exportaciones OVA, plantillas cloud, backups vSphere | Grains comprimidos con zlib — descompresión al vuelo con caché de grains |

**Subidas SFTP incompletas:** Cuando falta el fichero de datos de un VMDK flat (ej: `server-flat.vmdk`), masstin prueba automáticamente la extensión `.filepart` (`server-flat.vmdk.filepart`) — común cuando las transferencias SFTP se interrumpieron durante la recolección de evidencia.

## Soporte LVM2

Para imágenes forenses Linux que utilizan Logical Volume Management (LVM2), masstin detecta particiones LVM (GUID de tipo GPT o tipo MBR `0x8E`), lee los metadatos LVM, y extrae los ficheros de log de cada volumen lógico. Esto cubre servidores Linux empresariales que comúnmente usan LVM para la gestión de discos.

## Agrupación de artefactos por imagen

Al procesar múltiples imágenes, el resumen agrupa los artefactos por nombre de imagen — mostrando exactamente qué imagen produjo eventos de movimiento lateral:

```
[+] Artifacts with lateral movement events (9 of 10 images):
    => Windows Server 2019.vmdk (428 events total)
       - Security.evtx (406)
       - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (10)
       - Current.mdb (12)
    => HRServer_Disk0.e01 (42943 events total)
       - Security.evtx (34454)
       - Microsoft-Windows-SMBServer%4Security.evtx (5395)
       ...
    => kali-linux.vmdk (5 events total)
       - wtmp (5)
```

## Cómo funciona

Masstin utiliza parsers en Rust puro para todo — sin herramientas externas, sin montar, sin FUSE:

1. **Acceso a imagen**: E01 vía crate `ewf`, VMDK vía parser propio (sparse, split, flat, streamOptimized), dd/raw vía I/O directo
2. **Detección de particiones**: tablas GPT y MBR parseadas para encontrar todas las particiones, incluyendo LVM2
3. **Detección de cifrado**: comprobación de firma BitLocker (`-FVE-FS-`) en el offset 3 del VBR — las particiones cifradas se reportan y se saltan
4. **Identificación del SO**: firma del boot sector NTFS (`NTFS    `) o magic del superbloque ext4 (`0xEF53`) — cada partición se clasifica independientemente
5. **Extracción Windows** (particiones NTFS):
   - EVTX de `Windows\System32\winevt\Logs\`
   - Bases de datos UAL de `Windows\System32\LogFiles\Sum\`
   - XML de Scheduled Tasks de `Windows\System32\Tasks\`
   - Detección VSS en offset `0x1E00`, mapeo de block descriptors, reconstrucción de snapshot vía [vshadow-rs](https://github.com/jupyterj0nes/vshadow-rs)
6. **Extracción Linux** (particiones ext4):
   - auth.log, secure, messages, audit.log de `/var/log/`
   - wtmp, btmp, utmp, lastlog, hostname
   - Inferencia de año desde `dpkg.log`, hostname desde `/etc/hostname`
7. **Parsing dual**: artefactos Windows → `parse_events`, artefactos Linux → `parse_linux`
8. **Fusión y deduplicación**: ambas timelines fusionadas cronológicamente, duplicados eliminados

Funciona en Windows, Linux y macOS. Binario único, cero dependencias.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| vshadow-rs — parser VSS | [vshadow-rs](/es/tools/vshadow-rs/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
