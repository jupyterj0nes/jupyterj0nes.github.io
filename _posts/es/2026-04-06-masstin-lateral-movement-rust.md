---
layout: post
title: "Masstin: Analisis de movimiento lateral a la velocidad de Rust"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, memgraph, evtx, herramientas]
description: "Masstin es una herramienta DFIR escrita en Rust que parsea artefactos forenses y genera timelines unificadas de movimiento lateral, con visualizacion en bases de datos graficas."
comments: true
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "masstin",
  "alternateName": "Masstin",
  "description": "Masstin es una herramienta DFIR escrita en Rust que parsea EVTX de Windows, logs de Linux, bases UAL, exportaciones de Cortex XDR, logs personalizados e imagenes forenses (E01/dd/VMDK incluido streamOptimized) en una timeline unificada de movimiento lateral, con visualizacion en grafos Neo4j y Memgraph.",
  "url": "https://weinvestigateanything.com/es/tools/masstin-lateral-movement-rust/",
  "downloadUrl": "https://github.com/jupyterj0nes/masstin/releases/latest",
  "softwareVersion": "0.13.0",
  "applicationCategory": "SecurityApplication",
  "applicationSubCategory": "Digital Forensics and Incident Response",
  "operatingSystem": "Windows, Linux, macOS",
  "programmingLanguage": "Rust",
  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
  "codeRepository": "https://github.com/jupyterj0nes/masstin",
  "author": {
    "@type": "Person",
    "name": "Toño Díaz",
    "url": "https://github.com/jupyterj0nes",
    "sameAs": "https://www.linkedin.com/in/antoniodiazcastano/"
  },
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "keywords": "DFIR, movimiento lateral, EVTX, UAL, VSS, Neo4j, Memgraph, Velociraptor, KAPE, Cortex XDR, respuesta a incidentes, forense digital, Rust, EVTX carving, BitLocker, eventos de seguridad Windows, 4624, 4778, 4779"
}
</script>

![Masstin Logo](/assets/images/masstin-logo.png){: style="display:block; margin: 0 auto 2rem; max-width: 100%; width: 600px;" loading="lazy"}

## El problema

Un atacante ha comprometido tu red. Se ha movido lateralmente entre servidores Windows, máquinas Linux e infraestructura cloud. La evidencia está dispersa: EVTX de 50 máquinas, logs de auth de una docena de servidores Linux, datos de red de tu EDR. Necesitas reconstruir el camino del atacante — cada salto, cada credencial, cada intento fallido — y lo necesitas **ya**.

Masstin parsea **todas** estas fuentes y las fusiona en una **única timeline cronológica** donde un logon RDP de Windows, un brute-force SSH de Linux y una conexión de red del EDR aparecen lado a lado, en el mismo formato, listos para análisis o visualización en grafos.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** AGPL-3.0
- **Plataformas:** Windows, Linux y macOS — sin dependencias, binario único

---

## Características clave

| Característica | Descripción | Artículo |
|----------------|-------------|----------|
| **Parsing unificado cross-OS** | **Un solo comando `parse-image` auto-detecta el SO por partición** — NTFS recibe parsing Windows (EVTX + UAL + VSS), ext4 recibe parsing Linux (auth.log, wtmp, audit.log, **logs binarios de systemd-journald**, etc.) — todo fusionado en una timeline. Apunta a una carpeta con imágenes mixtas y obtén un único CSV. Cero pasos manuales. | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| Análisis multi-directorio | Analiza docenas de máquinas a la vez con múltiples flags `-d`, crítico para investigaciones de ransomware | [Parsear evidencia](#parsear-evidencia) |
| Timeline multiplataforma | Windows EVTX + Linux SSH + datos EDR en una timeline — `parse-image` auto-fusiona entre sistemas operativos | [Windows](/es/artifacts/security-evtx-lateral-movement/) / [Linux](/es/artifacts/linux-forensic-artifacts/) / [Cortex](/es/artifacts/cortex-xdr-artifacts/) |
| 32+ Event IDs de 11 fuentes EVTX + Scheduled Tasks XML | Security.evtx, Terminal Services, SMBServer, SMBClient, RdpCoreTS, WinRM, WMI-Activity + detección de tareas remotas — cubriendo RDP, SMB, Kerberos, NTLM, acceso a shares, PowerShell Remoting, WMI y Scheduled Tasks | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) / [RDP](/es/artifacts/terminal-services-evtx/) / [SMB](/es/artifacts/smb-evtx-events/) |
| Clasificación de eventos | Cada evento clasificado como `SUCCESSFUL_LOGON`, `FAILED_LOGON`, `LOGOFF` o `CONNECT` | [Formato CSV — event_type](/es/tools/masstin-csv-format/) |
| Descompresión recursiva | Extrae automáticamente paquetes ZIP/triage de forma recursiva, gestiona logs archivados con nombres duplicados, detecta contraseñas forenses comunes | [Artefactos Linux — soporte triage](/es/artifacts/linux-forensic-artifacts/) |
| Linux: inferencia inteligente | Auto-detecta hostname, infiere año desde `dpkg.log`, soporta Debian (`auth.log`) y RHEL (`secure`), formatos RFC3164 y RFC5424 | [Artefactos Linux — inferencia](/es/artifacts/linux-forensic-artifacts/) |
| **Logs binarios de systemd-journald** | **Lector en Rust puro para `/var/log/journal/*.journal[~]`** — modo compacto + descompresión zstd. Esencial en Ubuntu 22 / RHEL 8+ con SSSD + Active Directory, donde `/var/log/auth.log` está vacío porque PAM enruta la autenticación a través del journal. Recorre eventos sshd y aplica las mismas regex `Accepted`/`Failed password` que los logs de texto. Funciona en workstations DFIR con Windows sin libsystemd. | [Artefactos Linux — systemd-journald](/es/artifacts/linux-forensic-artifacts/#logs-binarios-de-systemd-journald--la-mitad-que-falta-en-el-linux-moderno) |
| Visualización en grafos con reducción de ruido | Carga directa a Neo4j o Memgraph con agrupación de conexiones (fecha más temprana + recuento) y resolución automática IP-a-hostname | [Neo4j](/es/tools/neo4j-cypher-visualization/) / [Memgraph](/es/tools/memgraph-visualization/) |
| Reconstrucción de camino temporal | Query Cypher para encontrar la ruta cronológicamente coherente del atacante entre dos nodos | [Neo4j — camino temporal](/es/tools/neo4j-cypher-visualization/) / [Memgraph — camino temporal](/es/tools/memgraph-visualization/) |
| Correlación de sesiones | Campo `logon_id` permite vincular eventos de logon/logoff para determinar duración de sesión | [Formato CSV — logon_id](/es/tools/masstin-csv-format/) |
| Modo silencioso | Flag `--silent` suprime toda la salida para integración con Velociraptor, plataformas SOAR y pipelines de automatización | [Tabla de acciones](#acciones-disponibles) |
| **Procesamiento masivo de evidencia** | Apunta `-d` a una carpeta de evidencia — masstin encuentra recursivamente todas las imágenes E01/VMDK/dd, auto-detecta el SO por partición, extrae todos los artefactos del live + VSS, agrupación de artefactos por imagen en el resumen. Un solo comando para un incidente completo | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| Detección de BitLocker | Detecta particiones cifradas con BitLocker (firma `-FVE-FS-`) y avisa al analista — sin perder tiempo en datos ilegibles | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| VMDK streamOptimized | Soporte completo para VMDKs comprimidos (exportaciones OVA, plantillas cloud). También maneja subidas SFTP incompletas (fallback `.filepart`) | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| Recuperación de snapshots VSS | Detecta y extrae EVTX de Volume Shadow Copies — recupera logs borrados por atacantes | [Recuperación VSS](/es/tools/masstin-vss-recovery/) |
| Soporte de volúmenes montados | Apunta `-d D:` a un volumen montado o usa `--all-volumes` — EVTX live + recuperación VSS desde discos conectados, sin necesidad de crear imagen | [Imágenes forenses](/es/tools/masstin-vss-recovery/) |
| Parsing UAL | Detecta automáticamente bases de datos UAL (User Access Logging) — 3 años de historial de acceso a servidor que sobreviven al borrado de logs | [UAL](/es/tools/masstin-ual/) |
| MountPoints2 del registro | Extrae NTUSER.DAT de cada perfil de usuario y parsea MountPoints2 — revela conexiones usuario→servidor share con timestamps, sobrevive al borrado de logs. Soporte de hives sucios + transaction logs | [MountPoints2](/es/artifacts/mountpoints2-lateral-movement/) |
| EVTX carving | `carve-image` escanea el disco raw buscando chunks EVTX en espacio no asignado — recupera eventos después de que los logs Y los VSS hayan sido borrados. Implementa Nivel 1 (chunks completos de 64 KB) + Nivel 2 (detección de records huérfanos); el Nivel 3 (template matching) está planificado. Construye EVTX sintéticos agrupados por provider y los parsea por el pipeline completo. Tres bugs del parser upstream (bucles infinitos y OOMs de varios GB sobre BinXML corrupto) fueron reportados y arreglados en evtx 0.11.2; masstin mantiene el aislamiento en threads + `catch_unwind` + `--skip-offsets` como red de seguridad belt-and-suspenders | [EVTX carving](/es/tools/evtx-carving-unallocated/) |
| Reporte transparente | La CLI muestra descubrimiento de artefactos, progreso de procesamiento, inferencias de hostname/año y recuento de eventos por artefacto | [Parsear evidencia](#parsear-evidencia) |

---

## Instalar

### Descargar binario pre-compilado (recomendado)

> **No necesitas Rust.** Solo descarga y ejecuta.

| Plataforma | Descarga |
|------------|----------|
| Windows | [`masstin-windows.exe`](https://github.com/jupyterj0nes/masstin/releases/latest) |
| Linux | [`masstin-linux`](https://github.com/jupyterj0nes/masstin/releases/latest) |
| macOS | [`masstin-macos`](https://github.com/jupyterj0nes/masstin/releases/latest) |

Ve a [**Releases**](https://github.com/jupyterj0nes/masstin/releases) y descarga el binario para tu plataforma. Nada más.

### Compilar desde el código fuente (alternativa)

```bash
git clone https://github.com/jupyterj0nes/masstin.git
cd masstin && cargo build --release
```

### Parsear evidencia

```bash
# Imágenes forenses — auto-detecta Windows y Linux, timeline única
masstin -a parse-image -f DC01.e01 -f ubuntu-server.vmdk -o timeline.csv

# Escanear carpeta de evidencia — cualquier mezcla de imágenes Windows/Linux
masstin -a parse-image -d /evidence/all_machines/ -o full_timeline.csv

# Parsear logs extraídos desde directorios
masstin -a parse-windows -d /evidence/DC01 -d /evidence/SRV-FILE -o windows.csv
masstin -a parse-linux -d /evidence/linux-triage/ -o linux.csv
```

![Salida CLI de Masstin](/assets/images/masstin_cli_output.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

### Visualizar en base de datos de grafos

```bash
# Cargar en Memgraph (sin autenticacion)
masstin -a load-memgraph -f full-timeline.csv --database localhost:7687

# Cargar en Neo4j
masstin -a load-neo4j -f full-timeline.csv --database localhost:7687 --user neo4j
```

![Grafo de movimiento lateral en Memgraph Lab](/assets/images/memgraph_output1.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

### Reconstruir el camino del atacante

La query de camino temporal encuentra la ruta cronológicamente coherente entre dos nodos:

```cypher
MATCH path = (start:host {name:'10.10.1.50'})-[*]->(end:host {name:'SRV-BACKUP'})
WHERE ALL(i IN range(0, size(relationships(path))-2)
  WHERE localDateTime(relationships(path)[i].time) < localDateTime(relationships(path)[i+1].time))
RETURN path ORDER BY length(path) LIMIT 5
```

![Camino temporal en Memgraph](/assets/images/memgraph_temporal_path.png){: style="display:block; margin: 1rem auto; max-width: 100%;" loading="lazy"}

---

## Acciones disponibles

| Acción | Descripción |
|--------|-------------|
| `parse-windows` | Parsea EVTX de Windows desde directorios o ficheros (soporta triage comprimido) |
| `parse-linux` | Parsea logs de Linux: auth.log, secure, messages, audit.log, utmp, wtmp, btmp, lastlog |
| `parser-elastic` | Parsea logs de Winlogbeat en JSON exportados desde Elasticsearch |
| `parse-cortex` | Consulta la API de Cortex XDR para conexiones de red (RDP/SMB/SSH) |
| `parse-image` | **Auto-detecta el SO por partición.** Abre imágenes E01/dd/VMDK (incluido streamOptimized), escanea carpetas de evidencia (`-d /evidence/`), volúmenes montados (`-d D:`) o `--all-volumes`. Detecta BitLocker. NTFS → EVTX + UAL + VSS + Tasks. ext4 → logs Linux. Todo fusionado en un CSV |
| `parse-massive` | Como `parse-image` pero también incluye EVTX y logs sueltos de los directorios `-d` — útil cuando la evidencia es una mezcla de imágenes de disco y paquetes triage extraídos |
| `carve-image` | **Último recurso.** Escanea el disco raw buscando chunks EVTX en espacio no asignado. Recupera eventos de movimiento lateral después de que logs + VSS hayan sido borrados. Usa `--carve-unalloc` para escanear solo espacio no asignado |
| `parse-cortex-evtx-forensics` | Consulta la API de Cortex XDR para colecciones EVTX forenses de múltiples máquinas |
| `parse-custom` | Parsea logs de texto arbitrarios (VPN, firewall, proxy, aplicación web) usando ficheros YAML de reglas. Trae tu propio formato de log — ver [parsers personalizados de masstin](/es/tools/masstin-custom-parsers/) |
| `merge` | Combina múltiples CSVs en una única timeline cronológica |
| `load-neo4j` | Sube la timeline a Neo4j para visualización en grafos |
| `load-memgraph` | Sube la timeline a Memgraph para visualización en grafos en memoria |
| `merge-neo4j-nodes` | Fusiona dos nodos `:host` del grafo después de cargar (por ejemplo, cuando una IP y un hostname no se unificaron automáticamente). No requiere APOC |
| `merge-memgraph-nodes` | Igual que el anterior, para Memgraph. No requiere MAGE |

---

## Documentación

### Artefactos

| Artefacto | Artículo |
|-----------|----------|
| Security.evtx (14 Event IDs) | [Security.evtx y movimiento lateral](/es/artifacts/security-evtx-lateral-movement/) |
| Terminal Services EVTX | [Terminal Services EVTX](/es/artifacts/terminal-services-evtx/) |
| SMB EVTX | [Eventos SMB en EVTX](/es/artifacts/smb-evtx-events/) |
| WinRM, WMI-Activity + Scheduled Tasks | PowerShell Remoting (Event 6), WMI remoto (Event 5858) y tareas programadas remotas (campo Author) | [WinRM, WMI y Tasks](/es/artifacts/winrm-wmi-schtasks-lateral-movement/) |
| MountPoints2 (NTUSER.DAT) | Conexiones a shares remotos desde el registro — usuario→servidor con timestamps, sobrevive al borrado de logs | [MountPoints2](/es/artifacts/mountpoints2-lateral-movement/) |
| Logs de Linux | [Artefactos forenses de Linux](/es/artifacts/linux-forensic-artifacts/) |
| Winlogbeat JSON | [Winlogbeat: artefactos en JSON](/es/artifacts/winlogbeat-elastic-artifacts/) |
| Cortex XDR | [Cortex XDR: artefactos forenses](/es/artifacts/cortex-xdr-artifacts/) |
| **Parsers personalizados (BYO logs)** | VPN, firewall, proxy, aplicación web — define tu propio formato de log con un fichero YAML de reglas y parséalo como cualquier otra fuente. [Parsers personalizados de masstin](/es/tools/masstin-custom-parsers/) |

### Formato de salida y funcionalidades avanzadas

| Tema | Artículo |
|------|----------|
| Columnas CSV, event_type, mapeo Event ID, logon_id, detail | [Formato CSV y Clasificación de Eventos](/es/tools/masstin-csv-format/) |
| Análisis de imágenes forenses y recuperación VSS | [Recuperando logs borrados desde VSS](/es/tools/masstin-vss-recovery/) |
| User Access Logging (UAL) | [Historial de acceso a servidor desde bases de datos ESE](/es/tools/masstin-ual/) |
| vshadow-rs — parser VSS en Rust puro | [vshadow-rs](/es/tools/vshadow-rs/) |
| Detección de triages (KAPE / Velociraptor / Cortex) — reconocimiento automático de paquetes triage dentro de `parse-image` y `parse-massive` | [Detección de triages en masstin](/es/tools/masstin-triage-detection/) |

### Bases de datos graficas

| Base de datos | Artículo |
|---------------|----------|
| Neo4j | [Neo4j y Cypher: visualización y queries](/es/tools/neo4j-cypher-visualization/) |
| Memgraph | [Memgraph: visualización en memoria](/es/tools/memgraph-visualization/) |
