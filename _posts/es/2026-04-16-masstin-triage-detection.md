---
layout: post
title: "Detección de triages en masstin: KAPE, Velociraptor, Cortex XDR — y un desglose por fuente que por fin tiene sentido"
date: 2026-04-16 09:00:00 +0100
category: tools
lang: es
ref: tool-masstin-triage-detection
tags: [masstin, triage, kape, velociraptor, cortex-xdr, dfir, herramientas]
description: "Masstin v0.12 ahora detecta paquetes de triaje KAPE, Velociraptor y Cortex XDR durante el recorrido de directorios y agrupa cada artefacto parseado por su fuente real — imagen forense, zip de triage con hostname, archivo plano, o ruta completa de carpeta. Salida por consola que por fin le dice al analista qué eventos vinieron de qué evidencia."
comments: true
---

## El problema con la agrupación por nombre de directorio padre

Hasta ahora, cuando masstin terminaba de parsear una carpeta de evidencia, el desglose por artefacto se agrupaba por el **nombre del directorio padre inmediato** de cada fichero EVTX. Suena razonable hasta que ves lo que pasa en casos reales.

Si tienes tres zips de triaje KAPE en `D:\evidence\`, todos conteniendo ficheros EVTX dentro del mismo subdirectorio interno (`<host>\C\Windows\System32\winevt\Logs\`), masstin los renderizaba como un único grupo llamado `Logs`:

```
[+] Artifacts with lateral movement events:
      => Logs (12,847 events total)
         - Security.evtx (10,234)
         - Microsoft-Windows-WinRM%4Operational.evtx (1,453)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (1,160)
```

Tres hosts diferentes, tres triajes diferentes, todos colapsados en "Logs". El analista no tiene forma de saber qué eventos vinieron de qué colección. Y empeora cuando mezclas triages con imágenes forenses y dumps EVTX sueltos en la misma carpeta — todas las variantes de fuente fundidas en cubos anónimos por nombre de directorio padre.

Lo mismo pasaba con la fase de descubrimiento: masstin decía `100 compressed packages found` cuando en realidad había 100 EVTX **dentro de** 2 archivos — el número era correcto pero el sustantivo era erróneo, y no había forma de saber qué tipo de archivos eran.

Este post documenta el fix de v0.12: detección de triages durante el recorrido de directorios, y agrupación por fuente en el desglose final.

## Tres herramientas de triaje, tres firmas

La mayoría de equipos DFIR convergen en un conjunto pequeño de colectores de triaje. Hablando con analistas y mirando datos de casos reales, las tres que aparecen una y otra vez son:

- **KAPE** (Kroll Artifact Parser and Extractor) — el estándar de facto para colección dirigida en Windows
- **Velociraptor Offline Collector** — el colector standalone de Velocidex, cada vez más común en entornos mixtos Linux+Windows
- **Cortex XDR Offline Collector** — el colector de Palo Alto para endpoints que ya corren el agente XDR

Cada uno produce archivos ZIP con un layout interno reconocible. La detección es solo pattern matching contra la lista de entradas top-level del ZIP, y los patrones son lo bastante estables como para detectar cada uno con fiabilidad sin falsos positivos.

### Cortex XDR — el fácil

El offline collector de Cortex XDR escribe un fichero llamado `cortex-xdr-payload.log` en su salida. Este nombre de fichero es **único del colector XDR** — ninguna otra herramienta DFIR lo usa, ningún proceso de triaje normal lo produce. Una sola coincidencia es concluyente.

```rust
// pseudocódigo del detector real
if entries.iter().any(|n| n.ends_with("cortex-xdr-payload.log")) {
    return Some(TriageType::CortexXdr);
}
```

El colector de Cortex XDR también sigue una convención estricta de nombre de fichero:

```
offline_collector_output_<HOSTNAME>_<YYYY-MM-DD>_<HH-MM-SS>.zip
```

Así que extraemos el hostname del filename siempre que coincida con esa forma. Ejemplo: `offline_collector_output_STFVEEAMPRXY01_2026-03-17_21-18-38.zip` → host `STFVEEAMPRXY01`.

Dentro del paquete, Cortex XDR tiene un layout rico de módulos: cada categoría de artefacto forense está en su propia carpeta `<nombre>-parsing/` o `<nombre>-collection/`, y cada carpeta contiene un `script_output.zip` anidado con la evidencia real. Los ficheros EVTX terminan en `output/event_log-parsing/script_output.zip` dentro de rutas como `entry_159_0/Microsoft-Windows-Windows Firewall With Advanced Security%4FirewallDiagnostics.evtx`. Las bases de datos UAL `.mdb` terminan en `output/user_access_logging_db-collection/script_output.zip`. El colector XDR cubre unos 70+ módulos de artefactos.

La recursión existente de zips anidados de masstin (originalmente construida para paquetes de triaje comprimidos) maneja el layout doble-zip de forma transparente — una vez que la detección identifica el paquete exterior como Cortex XDR, el walker recursivo encuentra los EVTX dentro de los zips internos y los pasa por el pipeline normal.

### Velociraptor — firma por combinación

El offline collector de Velociraptor no tiene un único marker file único, pero la **combinación** de ficheros root es lo bastante distintiva. Una colección Velociraptor sin cifrar siempre tiene estos en el top level de su ZIP:

- `client_info.json`
- `collection_context.json`
- `uploads.json`
- `log.json`
- `requests.json`

La regla de detección necesita `client_info.json` más al menos uno de `collection_context.json` o `uploads.json` — esa combinación no aparece en la salida de ninguna otra herramienta.

Para colecciones cifradas (Velociraptor envuelve el data zip en un contenedor exterior con un fichero de password separado), los markers cambian a `metadata.json` + `data.zip`. El detector maneja ambas variantes.

Patrón de filename: `Collection-<HOSTNAME>-<YYYY-MM-DD>T<HH_MM_SS>Z.zip`. La extracción de hostname toma todo entre el prefijo literal `Collection-` y el primer `-` seguido de un dígito (el inicio del timestamp).

Los ficheros EVTX dentro de colecciones Velociraptor están en `uploads/auto/C%3A/Windows/System32/winevt/Logs/` (rutas URL-encoded porque el upload accessor las almacena por ruta literal de origen). Los artefactos Linux van en rutas `uploads/auto/` similares bajo los directorios POSIX correspondientes.

### KAPE — heurístico con markers + fallback de layout

KAPE es el más complicado de los tres porque no impone ningún filename canónico ni marker único. Los operadores lo usan de muchas formas distintas. El detector intenta dos capas:

1. **Markers directos**: presencia de `_kape.cli` (el fichero command-line que KAPE escribe junto a su salida) o `Console/KAPE.log` (el log de ejecución). Cualquiera es concluyente.
2. **Fallback de layout**: si los markers directos no están, el detector cuenta entradas que coincidan con el layout típico de KAPE `<prefix>/C/Windows/System32/winevt/Logs/<nombre>.evtx`. Cinco o más coincidencias disparan la detección de KAPE. Esto pilla el caso común donde alguien ejecuta KAPE con `--zip <hostname>` y el archivo resultante tiene el hostname como directorio top-level.

La falta de un patrón de filename estricto en KAPE también hace la extracción de hostname poco fiable. El detector es **deliberadamente conservador**: solo devuelve un hostname cuando el filename del ZIP tiene una forma clara `<palabra>_<dígitos>...`, que es lo que obtienes de operadores usando `KAPE.exe ... --zip <hostname>_<timestamp>`. Para filenames ambiguos como `kape-output.zip` el detector simplemente no reporta host — mejor omitir información que inventarla.

## Agrupación por fuente en el desglose

La detección corre una vez por ZIP en tiempo de descubrimiento y el resultado se guarda en un `HashMap<zip_path, TriageInfo>`. Después, cuando cada EVTX individual se parsea y cuenta, masstin computa una **source label** para él:

```
[IMAGE]  HRServer_Disk0.e01
[TRIAGE: Cortex XDR]  offline_collector_output_TESTHOST01_2026-04-13_15-30-00.zip  [host: TESTHOST01]
[TRIAGE: Velociraptor]  Collection-WIN-DC01-2026-04-13T15_30_00Z.zip  [host: WIN-DC01]
[TRIAGE: KAPE]  workstation05_20260413.zip  [host: workstation05]
[ARCHIVE]  some-other-archive.zip
[FOLDER]  D:/evidence/loose/extracted_evtx
```

Las labels se computan a partir del enum `EvtxLocation` que masstin ya usa para trackear de dónde vino cada EVTX:

- `EvtxLocation::File(path)` donde la ruta contiene el marker `masstin_image_extract/` → extract de imagen forense → `[IMAGE]  <nombre-imagen>`
- `EvtxLocation::File(path)` en otro caso → fichero suelto → `[FOLDER]  <ruta completa del directorio padre>`
- `EvtxLocation::ZipEntry { zip_path, .. }` → busca el zip exterior en el triage map → `[TRIAGE: <type>]` si fue detectado, `[ARCHIVE]` en otro caso

El desglose de fase 2 entonces agrupa por source label y renderiza cada grupo con su event count más la lista por-EVTX:

```
[+] Lateral movement events grouped by source (4 sources):

      => [IMAGE]  HRServer_Disk0.e01  (45 events total)
         - Security.evtx (32)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (13)

      => [TRIAGE: Cortex XDR]  offline_collector_output_TESTHOST01_...zip  [host: TESTHOST01]  (834 events total)
         - Security.evtx (612)
         - Microsoft-Windows-WinRM%4Operational.evtx (89)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (133)

      => [TRIAGE: Velociraptor]  Collection-WIN-DC01-...zip  [host: WIN-DC01]  (4521 events total)
         - Security.evtx (4380)
         - Microsoft-Windows-WinRM%4Operational.evtx (141)

      => [FOLDER]  D:/evidence/loose/extracted_evtx  (131 events total)
         - Security.evtx (120)
         - Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx (11)
```

Cada evento está contabilizado. El analista puede leer este desglose y responder inmediatamente a preguntas como *"¿cuántos eventos WinRM vinieron del DC vs del triage de Cortex XDR?"* sin tener que hacer grep al CSV.

## Por qué tags ASCII en lugar de emoji

Consideré usar emoji para los marcadores de fuente (💿 imagen, 🎯 triage, 📦 archivo, 📁 carpeta) — quedan muy bien en terminales modernos. Pero los escenarios de despliegue realistas para masstin incluyen:

- **Windows Server 2016/2019 conhost** (fuente por defecto: Consolas, sin glyphs de emoji) — los emoji se renderizan como cajas o caracteres `?`
- **PowerShell 5.1 en conhost legacy** — mismo problema
- **PowerShell ISE** — renderizado de emoji roto
- **Sesiones RDP a hosts Windows antiguos** — depende de la fuente remota
- **SSH desde Linux/Mac a servidores Windows** — depende de la capacidad del terminal local

Estos no son edge cases. Son la **mayoría** de los engagements DFIR reales. Un analista en RDP a Windows Server 2019 mirando un run de masstin y viendo `□` cajas en lugar de `💿` es un fallo de UX.

Los tags ASCII funcionan en todas partes. Combinados con el styling de color existente (cyan / yellow / white / dim), la diferenciación visual es igual de clara que los emoji:

- `[IMAGE]` en cyan bold
- `[TRIAGE: <tipo>]` en yellow bold
- `[ARCHIVE]` en white bold
- `[FOLDER]` en dim white

Y se mantiene consistente con el resto del estilo visual existente de masstin, que siempre ha sido ASCII-only con `=>`, `[+]`, `[1/3]`, y los mismos helpers de color `style().cyan().bold()`.

## Mejoras en la fase de descubrimiento

La detección de triages no es el único fix en este commit. Otros cuatro bugs de salida por consola de un reporte de verificación previo se han colado de paso:

### "Compressed packages found" decía lo que no era

El mensaje viejo era:

```
[1/3] Searching for artifacts...
        100 compressed packages found
        => 102 EVTX artifacts found
```

Pero solo había **2 archivos** — el `100` era el número de EVTX **dentro** de ellos. El wording era engañoso. Fixeado a:

```
[1/3] Searching for artifacts...
        100 EVTX artifacts found inside 2 of 2 compressed archives
        => 102 EVTX artifacts found total
```

El "2 of 2" también es útil — te dice que los 2 archivos escaneados contribuyeron al menos un EVTX cada uno. Si uno de los archivos era un ZIP genérico sin EVTX (por ejemplo el case6.zip del test set WeAreVicon, que contiene una imagen forense en lugar de un triage), el mensaje pasa a ser:

```
[1/3] Searching for artifacts...
        100 EVTX artifacts found inside 1 of 2 compressed archives
        => 102 EVTX artifacts found total
```

Así el analista ve que un archivo se escaneó pero no contribuyó nada — útil para detectar casos donde apuntas masstin a una carpeta y quieres saber si todos tus archivos se procesaron.

### Los archivos silenciados ya no son silenciosos

Cuando una carpeta contenía ZIPs pero ninguno tenía EVTX dentro (porque eran archivos de imagen, o estaban protegidos con password desconocido, o estaban vacíos), la fase de descubrimiento vieja no mostraba nada sobre ellos. El analista se quedaba preguntándose si masstin siquiera había visto los archivos.

Ahora, cuando hay archivos presentes pero contribuyen cero entradas, la fase de descubrimiento imprime:

```
[1/3] Searching for artifacts...
        2 compressed archives scanned, none contained EVTX artifacts
        => 98 EVTX artifacts found total
```

Siempre sabes si masstin abrió tus archivos o no.

### Normalización de ruta larga

Windows genera nombres cortos 8.3 para cualquier directorio cuyo nombre largo sea más antiguo que el sistema, y el `tempdir` de PowerShell para el usuario actual a menudo aparece como `C:\Users\C00PR~1.DES\AppData\Local\Temp\` en lugar de la forma larga. La línea `Output:` del summary de masstin imprimía la ruta corta 8.3 cruda:

```
Output: C:/Users/C00PR~1.DES/AppData/Local/Temp/test-vicon.csv
```

Fixeado para canonicalizar la ruta vía `std::fs::canonicalize` y quitar el prefijo verbatim `\\?\` de Windows:

```
Output: C:/Users/c00pr.DESKTOP-VJ4PTJJ/AppData/Local/Temp/test-vicon.csv
```

### Wording de Skipped más limpio

El summary viejo decía:

```
Skipped: 100 (no relevant events or access denied)
```

Eso mezclaba dos casos muy distintos — ficheros que masstin parseó con éxito pero en los que no encontró eventos de movimiento lateral (normal, esperado) y ficheros que fallaron al abrir por permisos o corrupción (anómalo, requiere atención). Hasta que el stack del parser de masstin devuelva un tipo de error más rico que distinga estos casos, el wording es ahora simplemente:

```
Skipped: 100 (no relevant events found in file)
```

Un desglose completo por causa (no_events / access_denied / parse_error) está en el roadmap para v0.12.1.

## Qué significa esto para parse-windows, parse-image, parse-massive y parse-linux

La detección de triages y la agrupación por fuente aplican a **todas las actions que recorren directorios buscando artefactos**:

- **`parse-windows`** — directamente. Recorre los directorios `-d`, encuentra EVTX sueltos + abre ZIPs, detecta triages, agrupa por fuente.
- **`parse-image`** — hereda automáticamente. La action extrae EVTX de imágenes forenses a un directorio temporal cuya ruta contiene el marker `masstin_image_extract/`. El helper de source-label reconoce este marker y etiqueta cada EVTX extraído como `[IMAGE]  <nombre-imagen>`.
- **`parse-massive`** — hereda vía parse-image. Carpetas de evidencia mixtas con imágenes + triages + EVTX sueltos quedan todas correctamente clasificadas.
- **`parse-linux`** — mismo tratamiento. Los helpers de detección se reusan vía `crate::parse::detect_triage_type()` y el desglose por fuente usa el mismo helper `print_artifact_detail_grouped`. Los artefactos Linux dentro de colecciones Velociraptor o Cortex XDR (ambos soportan endpoints Linux) quedan correctamente atribuidos a su triage de origen.

Las source labels son consistentes entre todas las actions, así que un run de `parse-massive` contra una carpeta con una imagen E01, dos zips de triage, y un directorio de `auth.log` sueltos produce un único desglose coherente:

```
[+] Lateral movement events grouped by source (4 sources):

      => [IMAGE]  ubuntu-srv01.e01  (245 events total)
         - auth.log (180)
         - secure (45)
         - wtmp (20)

      => [TRIAGE: Velociraptor]  Collection-LINUX-DC01-2026-04-13T15_30_00Z.zip  [host: LINUX-DC01]  (1834 events total)
         - auth.log (1500)
         - audit.log (334)

      => [TRIAGE: Cortex XDR]  offline_collector_output_WIN-DB01_2026-04-13_16-15-22.zip  [host: WIN-DB01]  (612 events total)
         - Security.evtx (480)
         - Microsoft-Windows-WinRM%4Operational.evtx (132)

      => [FOLDER]  D:/evidence/standalone-syslog  (89 events total)
         - auth.log (89)
```

Un comando, cuatro clases de fuente, cada evento atribuido.

## Qué viene a continuación

Algunos follow-ups están en el backlog de v0.12.1:

- **Desglose de Skipped por causa** — contadores separados `no_events` / `access_denied` / `parse_error` en la línea de summary. Requiere un pequeño refactor del tipo de retorno de `parselog()`.
- **Tiempo por fase** — para runs muy largos (100+ imágenes), es útil ver cuánto tiempo consumió cada una de las 3 fases. Cosmético pero valioso cuando se debugean runs lentos.
- **Más herramientas de triaje** — Magnet RAM Capture, CyLR, Belkasoft Triage, IBM IRIS, y otros colectores menos comunes. Se aceptan PRs con un sample ZIP real y el patrón de marker.
- **Enumeración de módulos Cortex XDR aware-de-triage** — cuando se detecta un triage Cortex XDR, listar cuáles de sus ~70 módulos de artefactos están presentes para que el analista vea de un vistazo si la colección fue completa o parcial. Actualmente la detección solo reporta el hostname y el conteo de entradas.

Si quieres contribuir un nuevo detector de triage, los patrones viven como helpers `pub(crate)` en `src/parse.rs` (`detect_triage_type` + `extract_triage_hostname`). Añadir una nueva herramienta es solo una rama nueva en esas dos funciones más documentación opcional en el README.

## Pruébalo

La detección de triages y el desglose por fuente vienen en **masstin v0.12.0**. Los binarios pre-compilados están en la [Releases page](https://github.com/jupyterj0nes/masstin/releases) — sin necesidad de toolchain Rust. Apunta masstin a cualquier carpeta que contenga una mezcla de zips de triage, imágenes forenses, y EVTX sueltos, y el nuevo desglose te dirá exactamente qué eventos vinieron de qué fuente.

```bash
# Ejemplo del mundo real: parsear la carpeta de evidencia de un cliente
masstin -a parse-massive -d D:/incidents/2026-04-customer-x/evidence/ -o timeline.csv
```

Si detectas un layout de triage que el detector se salta, o un patrón de hostname que falla al extraer correctamente, abre un issue en el [repo de masstin](https://github.com/jupyterj0nes/masstin/issues) con un filename de sample (sanitizado) — añadir patrones nuevos es directo y queremos que el detector maneje la variedad real de formatos que aparecen en casos reales.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Página principal de masstin | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| README — sección de detección de triages | [`README.md#triage-detection-and-per-source-breakdown`](https://github.com/jupyterj0nes/masstin#triage-detection-and-per-source-breakdown) |
| Post de custom parsers (feature relacionada de v0.12) | [parse-custom + 8 reglas YAML](/es/tools/masstin-custom-parsers/) |
| EVTX carving | [evtx-carving-unallocated](/es/tools/evtx-carving-unallocated/) |
| Parseo de imágenes forenses + recuperación VSS | [masstin-vss-recovery](/es/tools/masstin-vss-recovery/) |
