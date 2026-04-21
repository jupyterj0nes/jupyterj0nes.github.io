---
layout: post
title: "masstin en macOS: binarios nativos arm64 e Intel, sin dependencias runtime"
date: 2026-04-21 08:00:00 +0100
category: tools
lang: es
ref: tool-masstin-macos
tags: [masstin, macos, arm64, apple-silicon, release, dfir, tools]
description: "Masstin ahora distribuye binarios nativos separados para Apple Silicon (arm64) e Intel macOS. Sin Homebrew, sin instalar libewf, sin fallback a Rosetta para M1/M2/M3. Cómo el build se mantiene zero-dep, la nota de Gatekeeper para la primera ejecución, y la verificación end-to-end contra los fixtures de test del crate evtx upstream sobre un runner macOS arm64 real."
comments: true
---

## Un binario, un `chmod +x`, listo

Hasta ahora el asset `masstin-macos` de cada release era un único binario Intel `x86_64`. En un Mac con Apple Silicon (M1, M2, M3, M4) eso significaba traducción con Rosetta 2 en cada ejecución — funcional, pero un 20-30% más lento que nativo y un pequeño punto de fricción para quien le importara. El pipeline de release ahora produce dos binarios separados:

| Plataforma | Binario | Corre nativo en |
|------------|---------|-----------------|
| Apple Silicon (M1 / M2 / M3 / M4) | [`masstin-macos-arm64`](https://github.com/jupyterj0nes/masstin/releases/latest) | macOS arm64 |
| Mac Intel | [`masstin-macos-x86_64`](https://github.com/jupyterj0nes/masstin/releases/latest) | macOS x86_64 |

Los dos son standalone. Descargar, hacer ejecutable, ejecutar. Nada de Homebrew. Nada de `libewf`. Nada de `libesedb`. Nada.

```bash
# Apple Silicon
curl -LO https://github.com/jupyterj0nes/masstin/releases/latest/download/masstin-<tag>-macos-arm64
chmod +x masstin-<tag>-macos-arm64
./masstin-<tag>-macos-arm64 -a parse-windows -d /evidencia/logs -o timeline.csv
```

---

## Por qué "cero dependencias" es una garantía real, no un deseo

Masstin lee formatos forenses que tradicionalmente tienen backend C: E01 (EnCase/libewf), ESE (bases de datos UAL vía libesedb), NTFS, VMDK, ext4. La forma habitual en que una herramienta Rust consume esto es enlazar contra la librería C instalada en el sistema (`libewf.dylib`, `libesedb.dylib`) y esperar a que el usuario haga `brew install` primero. Ese modelo arruina el "descargar y ejecutar" en macOS porque cada máquina necesita un paso de setup.

El árbol de dependencias con el que masstin se distribuye evita eso en cada nodo:

- **`ewf` 0.2** — Rust puro, sin wrapper alrededor de `libewf`. Un lector E01 en Rust escrito desde cero.
- **`libesedb-sys` 0.2.1** — vendora el source C completo de `libesedb 20230824` dentro del crate y lo compila estáticamente vía `cc::Build` en su `build.rs`. Nunca se lee una `libesedb.dylib` del sistema, en ningún punto.
- **`ntfs`, `ext4-view`, `vshadow`** — Rust puro.
- **`vmdk` reader, `polars`, `tokio`, `evtx`** — Rust puro.
- **`systemd-journal-reader`** — Rust puro, lee el formato binario `.journal` directamente sin `libsystemd`.

La única dependencia dinámica que el linker emite en macOS es `libSystem.B.dylib`, que Apple garantiza que está presente en cada instalación de macOS. Ejecutar `otool -L masstin-macos-arm64` lo confirma:

```
masstin-macos-arm64:
  /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
  /usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1700.255.5)
  /usr/lib/libiconv.2.dylib (compatibility version 7.0.0, current version 7.0.0)
```

Las tres están garantizadas por el OS. Mismo binario en cualquier Mac corriendo macOS 11+.

---

## El cambio en el CI

La matrix del workflow `release.yml` previamente compilaba solo `x86_64-apple-darwin` sobre el `macos-latest` que tocara. Desde octubre de 2024 `macos-latest` es ya arm64, así que el target Intel estaba siendo cross-compilado — bien para crates Rust puros, pero frágil para `libesedb-sys`, que tiene que invocar `cc::Build` con el target triple correcto y a veces no lo hacía.

La nueva matrix separa las dos arquitecturas en runners nativos:

```yaml
- target: x86_64-apple-darwin
  os: macos-13          # runner Intel real, sin cross-compile para libesedb-sys
  mac_arch: x86_64
- target: aarch64-apple-darwin
  os: macos-latest      # Apple Silicon nativo
  mac_arch: arm64
```

Cada tag push ahora produce cuatro assets de release: `windows.exe`, `linux`, `macos-arm64`, `macos-x86_64`.

---

## La nota de Gatekeeper "cannot verify"

Gatekeeper de macOS etiqueta los ficheros descargados desde un navegador con el atributo extendido `com.apple.quarantine`, y se niega a ejecutar binarios sin firmar en la primera ejecución. Firmar + notarizar una herramienta Rust CLI cuesta $99/año en una cuenta de Apple Developer para una utilidad forense pequeña que no podemos justificar, así que el workaround pragmático está en el README: quitar el atributo una vez y ejecutar normal.

```bash
chmod +x masstin-<tag>-macos-<arch>
xattr -d com.apple.quarantine masstin-<tag>-macos-<arch>
./masstin-<tag>-macos-<arch> --version
```

Buenas noticias para quien use curl / wget: el atributo de quarantine solo lo aplican Safari, la UI del Finder, y AirDrop. Descargas vía `curl`, `wget`, o `git clone` nunca se etiquetan. Si tu equipo baja el binario desde un script, Gatekeeper no entra en juego.

---

## Verificación end-to-end sobre un runner macOS arm64 real

La forma habitual de convencerte de que un binario realmente funciona en una plataforma que no tienes es levantar un runner hosted y comprobarlo. Como GitHub Actions da minutos gratuitos de macOS a repositorios públicos, esto sale barato. Monté un pequeño workflow manual-only (`mac-debug.yml`) que compila masstin y abre una shell accesible vía SSH usando `mxschmitt/action-tmate@v3`, luego metí los fixtures de test canónicos de `github.com/omerbenamram/evtx` — el repositorio del parser `evtx` sobre el que masstin está construido — y corrí `parse-windows` sobre ellos.

Input: 27 fixtures EVTX de `omerbenamram/evtx/samples/` (chunks intencionalmente dirty, caché de strings rota, post-security, big security, ficheros Security renombrados, RdpCoreTS, forwarded events).

Output sobre macOS arm64 (build nativo de `main`):

```
  [2/3] Processing artifacts...

  [+] Lateral movement events grouped by source (1 sources):

        => [FOLDER]  /private/tmp/evtx-upstream/samples  (14660 events total)
           - 2-system-Security-dirty.evtx (2985)
           - 2-vss_0-Microsoft-Windows-RemoteDesktopServices-RdpCoreTS%4Operational.evtx (126)
           - Archive-ForwardedEvents-test.evtx (618)
           - Security_short_selected.evtx (2)
           - Security_with_size_t.evtx (272)
           - post-Security.evtx (27)
           - security.evtx (675)
           - security_bad_string_cache.evtx (675)
           - security_big_sample.evtx (9280)

  [3/3] Generating output...
        2841 duplicate events removed (live + VSS overlap)

  Artifacts parsed: 9
  Events collected: 11819
  Completed in: 1.48s
```

11.819 eventos extraídos en 1,48 segundos sobre un runner gratuito de GitHub, contra EVTX diseñados deliberadamente para estresar un parser. Mismo esquema de CSV que los builds de Windows y Linux — un `timeline.csv` producido en macOS es bit-idéntico en estructura al producido en una workstation DFIR.

Por simetría, relancé el mismo dataset con el binario de release v0.14.0 (Intel, corriendo bajo Rosetta sobre el mismo runner arm64):

| Binario | Eventos | Notas |
|---------|--------:|-------|
| v0.14.0 release (Intel + Rosetta) | 0 | Le pegó el bug del dispatcher por Provider.Name — ver [post separado](/es/tools/masstin-archived-evtx-provider-dispatch/) |
| main en runner macos-13 (Intel nativo) | 11.819 | Igual en el próximo release |
| main en runner macos-latest (arm64 nativo) | 11.819 | Mismos números, nativo, 20-30% más rápido en wall clock |

El binario de release Intel también corrió fino bajo Rosetta 2 — sin errores de dyld, sin fricción de Gatekeeper (porque vino de `curl`) — simplemente no extrajo ningún evento por un bug de dispatcher no relacionado, ya arreglado en `main`. Compatibilidad Rosetta para quien esté en Intel transicionando a Apple Silicon queda confirmada, pero el nuevo binario arm64 nativo se salta la capa de traducción entera.

---

## Para flujos MSP / consultoría

- **Drop-in en triage kits**: un binario por arch, sin instalador, sin pasos post-install. Copiar a `/usr/local/bin/` o ejecutar en sitio.
- **Pipelines CI** sobre runners Apple Silicon (cada vez más el default en las build farms Mac): `curl -LO` el binario arm64, listo. Sin andamiaje de `brew update`, sin toquetear `HOMEBREW_NO_AUTO_UPDATE`.
- **Labs de análisis air-gapped**: el binario no necesita nada de internet después de la descarga. Todos los parsers forenses están estáticamente enlazados.
- **Ejecución firmada**: si tu organización requiere binarios notarizados, el camino de rebuild está documentado — forkea el repo, instala las Xcode command line tools, `cargo build --release --target aarch64-apple-darwin`, codesign tú mismo. El único input externo es `rustup`.

---

## Qué está planeado para macOS

Los parsers actuales son Windows y Linux. macOS como *objetivo de investigación* — `/var/log` en vivo, unified logging `.tracev3`, imágenes forenses APFS / HFS+ — está en el roadmap como una acción separada (`parse-mac`). Es independiente de este release; lo que sale ahora es solo la paridad de plataforma para *ejecutar* masstin desde una workstation macOS.

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| EVTX archivados / dispatch por Provider.Name | [EVTX archivados](/es/tools/masstin-archived-evtx-provider-dispatch/) |
| EVTX carving desde espacio no asignado | [carve-image](/es/tools/evtx-carving-unallocated/) |
| Formato CSV | [Formato CSV](/es/tools/masstin-csv-format/) |
