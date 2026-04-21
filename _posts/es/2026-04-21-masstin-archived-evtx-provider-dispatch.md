---
layout: post
title: "EVTX archivados: por qué tu timeline de masstin estaba vacía y cómo el dispatch por Provider.Name lo arregla"
date: 2026-04-21 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin-archived-evtx
tags: [masstin, evtx, provider, archivados, dfir, parse-windows, tools]
description: "Windows rota los Security.evtx llenos en archivos Security-YYYY-MM-DD-HH-MM-SS.evtx. Los EVTX renombrados, extraídos por operador o generados por herramientas de terceros rompían silenciosamente el dispatcher por nombre de fichero de masstin. Aquí se cuenta cómo masstin ahora despacha por Provider.Name leído del XML y acepta cualquier EVTX con un provider conocido — verificado end-to-end contra los propios fixtures de test del crate evtx upstream."
comments: true
---

## El fallo silencioso

Un compañero me señaló `I:\forensic\act3\archive\`. Dos ficheros zip:

```
Security-2026-04-17-02-09-25.zip
Security-2026-04-17-02-47-33.zip
```

Los dos de ~80 KB, cada uno conteniendo un único EVTX con el mismo nombre dentro. Es Windows haciendo lo suyo: cuando el Security event log se llena y el canal está configurado para *"Archive the log when full, do not overwrite events"*, Windows rota el `Security.evtx` activo a `C:\Windows\System32\winevt\Logs\Archive\Security-<YYYY-MM-DD-HH-MM-SS>.evtx` y abre uno nuevo. En cualquier DC ocupado, servidor Exchange o terminal farm vas a encontrar docenas de estos — son la diferencia entre una ventana forense de 2 horas y dos meses de historial.

Apuntas masstin:

```bash
masstin -a parse-windows -d I:/forensic/act3/archive/ -o timeline.csv
```

Salida:

```
  [1/3] Searching for artifacts...
        2 EVTX artifacts found inside 2 of 2 compressed archives
        => 2 EVTX artifacts found total

  [2/3] Processing artifacts...

  [3/3] Generating output...

  ──────────────────────────────────────────────────
  Artifacts parsed: 0
  Skipped: 2 (no relevant events found in file)
  Events collected: 0
```

Cero eventos. Ningún warning sobre ficheros corruptos, ningún exit code de error — solo descarte silencioso con la frase poco útil *"no relevant events found in file"*.

Este post es la historia de ese bug, por qué llevaba un tiempo allí, cómo lo pillé en un caso real, y el fix de una línea que rescató la timeline.

---

## A dónde fueron los eventos

El parser EVTX de masstin hacía dos cosas sobre cada fichero que encontraba:

1. **Walker**: recorrer cada directorio, abrir cada `.zip`, listar cada `.evtx` dentro. Funciona de forma transparente con ZIPs anidados (triage packages, output de collectors, lo que sea). Esta parte estaba bien — la línea `2 EVTX artifacts found` es el walker reportando éxito.
2. **Dispatcher**: mirar el nombre del fichero, enrutar al parser correcto por match exacto de string.

El dispatcher era así:

```rust
match file_name.as_str() {
    "Security.evtx" => parse_security_log(...),
    "Microsoft-Windows-SMBServer%4Security.evtx" => parse_smb_server(...),
    "Microsoft-Windows-SmbClient%4Security.evtx" => parse_smb_client(...),
    "Microsoft-Windows-TerminalServices-RDPClient%4Operational.evtx" => parse_rdp_client(...),
    // ... ~10 nombres canónicos más ...
    _ => Vec::new(),    // ← todo lo demás descartado silenciosamente
}
```

`Security-2026-04-17-02-09-25.evtx` no es `Security.evtx`. El match cae al brazo `_`, devuelve un vector vacío, el fichero queda marcado como *"no relevant events found"* y se salta. Misma historia con cualquier EVTX que un operador haya renombrado por la razón que sea: copias con timestamp, `hostname_Security.evtx`, `Security_DC01_2025-01-15.evtx`, extractos de herramientas de terceros que añaden un prefijo o un sufijo.

Los tests internos de masstin usaban nombres canónicos, así que nada pillaba esto. La primera vez que lo noté fue en el caso de arriba — un incidente real en producción donde había habido una rotación unas horas antes de la captura de memoria, y el único registro del 4624 inicial del atacante estaba dentro de uno de esos ficheros de archivo.

---

## El fix: dispatch por Provider.Name, no por nombre de fichero

Un EVTX no es solo un blob. El primer record significativo de cada fichero lleva un bloque XML `System` completo con metadatos del provider:

```xml
<System>
  <Provider Name="Microsoft-Windows-Security-Auditing" Guid="..."/>
  <EventID>4624</EventID>
  <Computer>DC01.example.corp</Computer>
  ...
</System>
```

El campo `Provider.Name` es **canónico e inmutable**. Microsoft lo genera a partir del manifest del propio canal. Un `Security-2026-04-17-02-09-25.evtx` archivado por la política de retención sigue llevando `Microsoft-Windows-Security-Auditing` dentro. Un operador que renombre el fichero a `Cliente-ABC_Security.evtx` no puede cambiarlo. Extraído por Velociraptor, KAPE o un script de triage forense — sigue siendo el mismo provider.

Así que el dispatcher deja de preocuparse por el nombre de fichero. Lee el segundo record, extrae `Provider.Name`, y enruta:

```rust
match provider.as_str() {
    "Microsoft-Windows-Security-Auditing"      => parse_security_log(...),
    "Microsoft-Windows-SMBServer"              => parse_smb_server(...),
    "Microsoft-Windows-SMBClient"              => parse_smb_client(...),
    "Microsoft-Windows-TerminalServices-ClientActiveXCore" => parse_rdp_client(...),
    "Microsoft-Windows-RemoteDesktopServices-RdpCoreTS"    => parse_rdpkore(...),
    "Microsoft-Windows-WinRM"                  => parse_winrm(...),
    "Microsoft-Windows-WMI-Activity"           => parse_wmi(...),
    // ...
    _ => Vec::new(),    // provider genuinamente desconocido, no tenemos parser
}
```

La función `parse_unknown()` existía en el código desde hace un tiempo, puerta atrás de un atómico `MASSIVE_MODE` para que solo `parse-massive` la usara. El razonamiento era precaución: mantener `parse-windows` estricto y predecible, dejar el fallback agresivo detrás del flag *"off-the-leash"*. En la práctica eso significaba que `parse-windows` descartaba silenciosamente los logs archivados mientras que `parse-massive` los recogía — una distinción que ningún usuario podía razonablemente adivinar sin leer el código fuente.

Volviendo a correr el mismo caso ahora, comando sin cambios:

```bash
masstin -a parse-windows -d I:/forensic/act3/archive/ -o timeline.csv
```

```
  [1/3] Searching for artifacts...
        2 EVTX artifacts found inside 2 of 2 compressed archives
        => 2 EVTX artifacts found total

  [2/3] Processing artifacts...

  [+] Lateral movement events grouped by source (2 sources):
        => [ARCHIVE]  archive/Security-2026-04-17-02-09-25.zip  (76 events total)
        => [ARCHIVE]  archive/Security-2026-04-17-02-47-33.zip  (169 events total)

  [3/3] Generating output...
  Artifacts parsed: 2
  Events collected: 245
```

Los mismos bytes en disco, el mismo comando, 245 eventos recuperados en vez de 0.

---

## ¿Cuánto importa esto en la práctica? Probémoslo contra upstream

La mejor validación para un parser es correrlo contra los fixtures de test que *los propios autores del parser subyacente* usan. Masstin depende del crate `evtx` de [omerbenamram](https://github.com/omerbenamram/evtx), y ese crate incluye un directorio `samples/` con ficheros EVTX reales e intencionalmente malformados para su propio test suite. Muchos tienen nombres no canónicos — `security_big_sample.evtx`, `2-system-Security-dirty.evtx`, `post-Security.evtx`, `Security_short_selected.evtx`, `Security_with_size_t.evtx`, `security_bad_string_cache.evtx`, etc. Exactamente la clase de nombres que el dispatcher antiguo descartaba.

Un test rápido en el binario de release público `masstin-v0.14.0-macos` (pre-fix) y en un build de `main` después del fix, ambos apuntando al mismo directorio de samples de `omerbenamram/evtx`:

| Build | Artifacts parsed | Events collected | CSV size |
|-------|-----------------:|-----------------:|---------:|
| v0.14.0 release (filename-strict) | 0 | **0** | 180 B (solo cabecera) |
| main después del fix (Provider.Name) | 9 | **11,819** | 2.3 MB |

El binario de release descarta silenciosamente cada uno de esos fixtures. El binario nuevo parsea nueve de ellos (los que tienen providers que masstin conoce — los otros dieciocho son logs genuinamente no-LM: CAPI2, HelloForBusiness, Shell-Core, etc., donde el dispatcher correctamente devuelve un vec vacío).

Fíjate en los fixtures dirty/broken — `2-system-Security-dirty.evtx` (corrupción de chunk intencional), `security_bad_string_cache.evtx` (caché de strings roto intencional), `sample-with-irregular-bool-values.evtx` (codificación de bool inválida intencional): el dispatcher por Provider.Name extrae eventos de ellos limpiamente, porque el mismo hardening que protege a carve-image de chunks malformados protege también este camino.

---

## Qué se parsea, qué no

El dispatcher ahora acepta cualquier EVTX cuyo `Provider.Name` coincida con uno de los canales que masstin conoce:

| Provider.Name | Parser | Canal / fichero típico |
|---------------|--------|------------------------|
| `Microsoft-Windows-Security-Auditing` | `parse_security_log` | `Security.evtx`, `Security-<ts>.evtx` (archivado) |
| `Microsoft-Windows-SMBServer` | `parse_smb_server` | `Microsoft-Windows-SMBServer%4Security.evtx` |
| `Microsoft-Windows-SMBClient` | `parse_smb_client` | `Microsoft-Windows-SmbClient%4Security.evtx` |
| `Microsoft-Windows-TerminalServices-ClientActiveXCore` | `parse_rdp_client` | `...TerminalServices-RDPClient%4Operational.evtx` |
| `Microsoft-Windows-TerminalServices-RemoteConnectionManager` | `parse_rdp_connmanager` | `...RemoteConnectionManager%4Operational.evtx` |
| `Microsoft-Windows-TerminalServices-LocalSessionManager` | `parse_rdp_localsession` | `...LocalSessionManager%4Operational.evtx` |
| `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS` | `parse_rdpkore` | `...RdpCoreTS%4Operational.evtx` |
| `Microsoft-Windows-WinRM` | `parse_winrm` | `Microsoft-Windows-WinRM%4Operational.evtx` |
| `Microsoft-Windows-WMI-Activity` | `parse_wmi` | `Microsoft-Windows-WMI-Activity%4Operational.evtx` |

Los EVTX cuyo provider no sea ninguno de los anteriores — `Application.evtx`, `System.evtx`, Sysmon, cualquier canal ETW de tercero — siguen devolviendo un vec vacío. Están genuinamente fuera del scope de un tracker de movimiento lateral; sus providers simplemente no coinciden.

Esto significa:

- **Logs archivados** (`Security-<YYYY-MM-DD-HH-MM-SS>.evtx` en `winevt/Logs/Archive/`) → parsean correctamente.
- **Copias renombradas por el operador** (`Security_DC01_2025-01-15.evtx`, `Cliente-ABC_Security.evtx`) → parsean correctamente.
- **Output de extracción de terceros** (dumps re-zippeados de Velociraptor, layouts por máquina de KAPE `hostname_Security.evtx`, collectors de triage custom) → parsean correctamente.
- **Sysmon y otros providers no-LM** → siguen saltándose (no es trabajo de masstin).

---

## Cuándo preocuparse por el trabajo extra

El fallback es **barato**: lee el segundo record de cada fichero de nombre desconocido para aprender el provider, luego enruta. Si el provider tampoco se conoce, el fichero se salta inmediatamente sin parsear el resto de records. Para un árbol masivo de directorios lleno de EVTX no relacionados (un Application.evtx por máquina, por ejemplo), el overhead está en microsegundos por fichero.

Si quieres específicamente el comportamiento estricto antiguo — por velocidad en un árbol enorme donde ya sabes que los ficheros canónicos están en un sitio concreto — apunta `-d` directo a `winevt/Logs`. El walker solo abre ficheros con extensión `.evtx` o `.zip` de todos modos, así que un path dirigido hace que todo el pipeline sea proporcional al tamaño del objetivo.

```bash
# Scope solo a la carpeta canónica, equivalente al comportamiento estricto antiguo
masstin -a parse-windows -d /evidencia/C/Windows/System32/winevt/Logs -o timeline.csv

# Incluir también los logs archivados
masstin -a parse-windows -d /evidencia/C/Windows/System32/winevt/Logs \
                          -d /evidencia/C/Windows/System32/winevt/Logs/Archive \
                          -o timeline.csv
```

---

## Conclusiones prácticas

1. Si alguna vez apuntaste masstin a un archivo de logs rotados, un extract de KAPE por hostname, o un dump de collector offline de Velociraptor y viste `Events collected: 0` — eso era este bug, no una timeline vacía.
2. El fix está en `main` (commit [`9419c95`](https://github.com/jupyterj0nes/masstin/commit/9419c95)) y estará en el próximo release. El commit es de una línea: quitar el gate `MASSIVE_MODE`, llamar a `parse_unknown` incondicionalmente.
3. Las tres acciones ahora comparten el mismo dispatch EVTX y solo difieren en **qué le meten dentro**:
   - `parse-windows` → ficheros y directorios (+ zips recursivos).
   - `parse-image` → imágenes forenses de disco, extrayendo del `winevt/Logs` del NTFS + VSS.
   - `parse-massive` → todo lo anterior, más triage detection, más promoción de loose-artifact.
4. El test canónico para la robustez de cualquier parser EVTX es una corrida contra `github.com/omerbenamram/evtx/samples/`. Vale la pena tenerlo en el bolsillo.

Si estás investigando un caso ahora mismo y a masstin le pareció que no veía nada, relánzalo contra `main` — los bytes en disco son los mismos, la timeline probablemente no.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| EVTX carving desde espacio no asignado | [carve-image](/es/tools/evtx-carving-unallocated/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
| Triage detection | [triage detection](/es/tools/masstin-triage-detection/) |
