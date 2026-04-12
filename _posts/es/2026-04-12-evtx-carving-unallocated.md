---
layout: post
title: "EVTX Carving: Recuperando logs de eventos borrados del espacio no asignado"
date: 2026-04-12 02:00:00 +0100
category: tools
lang: es
ref: tool-masstin-evtx-carving
tags: [masstin, carving, evtx, forense, dfir, unallocated, recuperación, herramientas]
description: "La acción carve-image de masstin escanea imágenes forenses buscando chunks EVTX en espacio no asignado, recuperando eventos de movimiento lateral después de que los atacantes borren los logs. Un análisis detallado de los tres niveles de carving EVTX y cómo masstin se protege contra bugs del parser upstream."
comments: true
---

## El último recurso: cuando hasta los VSS han desaparecido

El atacante fue meticuloso. Borró todos los logs de eventos. Eliminó los Volume Shadow Copies con `vssadmin delete shadows /all`. Incluso limpió las bases de datos UAL. Tu `Security.evtx` está vacío, tus stores VSS han desaparecido, y no queda nada que parsear.

¿O sí?

Cuando Windows borra un fichero, los datos no desaparecen del disco — el espacio simplemente se marca como "disponible" en el sistema de ficheros. Los bytes reales — incluyendo chunks EVTX completos — permanecen en disco hasta que se sobreescriben con datos nuevos. **El `carve-image` de masstin escanea el disco raw buscando estos restos, los recupera, los mete por el pipeline normal de parseo y te devuelve una timeline indistinguible de una construida a partir de logs vivos.**

Este artículo es un análisis en profundidad de cómo funciona eso: cómo están organizados los ficheros EVTX, los tres niveles teóricos de carving EVTX, qué implementa masstin hoy, qué dejamos como future work, y los obstáculos sorprendentemente dolorosos que nos encontramos por el camino — incluyendo tres bugs nuevos que descubrimos y reportamos upstream en el crate `evtx`.

---

## Estructura de los ficheros EVTX en disco

Un fichero EVTX tiene un layout simple y regular:

```
[File Header - 4 KB] [Chunk 0 - 64 KB] [Chunk 1 - 64 KB] [Chunk 2 - 64 KB] ...
```

El **file header** identifica el fichero (magic `ElfFile\x00`), registra el número de chunks y almacena metadatos globales. El header es útil para leer un fichero intacto, pero crucialmente **no es necesario para parsear chunks individuales**.

Cada chunk de 64 KB es autónomo y empieza con la firma mágica `ElfChnk\x00`. Un chunk lleva:

- Su propia tabla de strings
- Su propia tabla de templates (plantillas BinXML referenciadas por los records del interior)
- Uno o más records de eventos

Esta autonomía es lo que hace viable el carving EVTX. **Un solo chunk recuperado de espacio no asignado puede parsearse por su cuenta**, incluso sin el file header original, incluso sin los demás chunks, incluso si los sectores alrededor han sido reutilizados.

Cada record de evento dentro de un chunk empieza con la firma `\x2a\x2a\x00\x00` y sigue este layout:

| Offset | Tamaño | Campo |
|--------|--------|-------|
| 0 | 4 | Magic: `0x2A2A0000` |
| 4 | 4 | Tamaño del record (u32) |
| 8 | 8 | Record ID (u64) |
| 16 | 8 | Timestamp (FILETIME) |
| 24 | var | Datos BinXML del evento |
| size-4 | 4 | Copia del tamaño (validación) |

Esto importa porque existen tres estrategias distintas para recuperar eventos, cada una operando a un nivel de granularidad diferente.

---

## Los tres niveles del carving EVTX

Antes de ver qué hace masstin, merece la pena entender el panorama teórico. El carving EVTX se suele describir en tres niveles, en orden creciente de potencia y complejidad.

### Nivel 1 — Chunk carving

**Qué recupera:** chunks EVTX completos de 64 KB que han sobrevivido intactos en disco.

**Cómo funciona:** escanear el disco (secuencialmente o solo los extents no asignados) buscando el magic de 8 bytes `ElfChnk\x00` en un límite de alineación conocido. Cuando se encuentra una coincidencia, se leen los 64 KB completos, se valida como un chunk parseable, y se le pasa a un parser EVTX estándar.

**Fidelidad:** perfecta. El chunk recuperado contiene su propia tabla de strings y de templates, así que cada record del interior parsea a XML completo con todos sus valores sustituidos. Los eventos que obtienes son idénticos a lo que `wevtutil` habría mostrado en un sistema vivo.

**Qué se pierde:** cualquier chunk que haya sido parcialmente sobreescrito. Incluso un solo byte dañado dentro de los 64 KB rompe la validación, y el Nivel 1 lo descarta por completo.

**Coste:** muy barato. Un solo escaneo lineal del disco.

### Nivel 2 — Escaneo de records huérfanos

**Qué recupera:** records de evento individuales que han sobrevivido incluso cuando su chunk padre no lo hizo.

**Cómo funciona:** escanear el disco buscando el magic de record `\x2a\x2a\x00\x00`. Para cada coincidencia, validar la cabecera (campo de tamaño razonable, copia del tamaño al final coincide, byte de preámbulo BinXML, timestamp plausible) para filtrar coincidencias casuales. Los records que pasan la validación son "huérfanos" — records EVTX reales flotando fuera de cualquier chunk recuperable.

**Fidelidad:** parcial. La cabecera del record parsea y te da record ID, tamaño y timestamp. El **cuerpo** es BinXML — una codificación binaria compacta que sustituye valores en templates almacenadas en la tabla de templates del chunk. Sin la tabla de templates del chunk padre, puedes recuperar la cabecera del record y puedes ver que un evento *existió*, pero convertir el cuerpo BinXML en un evento legible (con su Event ID, provider, campos sustituidos, etc.) requiere más trabajo.

**Qué aporta hoy:** un recuento y los metadatos que se pueden extraer solo de la cabecera. Esto es suficiente para decir "había N eventos adicionales en el espacio no asignado con estos timestamps", lo cual es ya en sí mismo una evidencia útil para reconstrucción de timeline.

**Coste:** barato. El mismo escaneo lineal del Nivel 1, con un patrón mágico extra que buscar.

### Nivel 3 — Template matching (el santo grial)

**Qué recupera:** XML completo a partir de records huérfanos cuyos chunks padre ya no existen.

**Cómo funciona:** construir un corpus de templates BinXML conocidas — ya sea a partir de los chunks que sí sobrevivieron en la misma imagen, de una biblioteca de templates Windows comunes recopiladas de otros sistemas, o de ambos. Para cada record huérfano, recorrer su cuerpo BinXML, y para cada referencia a template intentar encontrarla en el corpus. Cuando hay match, sustituir los valores inline del record en la template y renderizar el XML como lo haría el parser normal.

**Fidelidad:** variable. Un record huérfano de un logon Security 4624 en un Windows Server 2019 es muy probable que encuentre una template coincidente en el corpus — esas templates son estables entre instalaciones. Un record de un provider poco común o de una build de SO inusual puede no encontrar match, quedando parcialmente decodificado.

**Por qué es difícil:** BinXML está diseñado para parsearse *con su tabla de templates a mano*, no hacia atrás desde un record parcial. Hay que reimplementar suficiente de la máquina de estados BinXML para recorrer un record sin explotar en el primer token desconocido, hay que decidir cómo manejar colisiones de hashes de templates, y hay que construir y mantener el corpus de templates.

**Coste:** no está en el escaneo — una pasada extra — sino en el código y en la base de datos de templates.

---

## Qué implementa masstin hoy

| Nivel | Estado en masstin |
|-------|-------------------|
| **Nivel 1** — chunk carving | **Implementado.** Chunks completos de 64 KB recuperados, agrupados por provider, parseados a través del pipeline normal de masstin hacia la timeline CSV unificada. |
| **Nivel 2** — detección de records huérfanos | **Implementado (solo detección).** Los records huérfanos se encuentran, se validan y se cuentan. Los metadatos de cabecera se reportan. La reconstrucción completa del XML a partir del cuerpo BinXML no se hace. |
| **Nivel 3** — template matching | **Future work.** El diseño está claro y el corpus podría bootstrapearse a partir de la salida del Nivel 1 en la misma imagen (usar las tablas de templates de los chunks recuperados para decodificar los records huérfanos), pero no está en la release actual. |

La razón de esta priorización es simple: **el Nivel 1 aporta la inmensa mayoría del valor por una fracción del coste de ingeniería.** En la práctica, en las imágenes que hemos probado, el Nivel 1 por sí solo recupera decenas de miles de eventos completos. El recuento del Nivel 2 es útil como evidencia corroborativa ("había N eventos más de los que el Nivel 1 pudo recuperar"). El Nivel 3 es donde vas cuando necesitas hasta el último byte, y en un incidente real rara vez es la diferencia entre atrapar al atacante y no atraparlo.

---

## Nivel 1 en masstin — de la firma a la timeline

El pipeline completo es:

1. **Abrir la imagen.** Para E01, masstin usa el crate `ewf` para leer la vista lógica del disco (bytes descomprimidos). Para VMDK usa su propio reader que maneja tanto `monolithicFlat` como `streamOptimized`. Para `dd`/`001` raw simplemente abre el fichero.
2. **Escanear en bloques de 4 MB.** Cada bloque se lee secuencialmente a memoria; sin seeks, así que discos giratorios y shares de red se mantienen a velocidad de read-ahead.
3. **Buscar `ElfChnk\x00`.** El magic de 8 bytes se busca en alineación de 512 bytes dentro de cada bloque.
4. **Validar el chunk.** Cuando se encuentra una firma, masstin lee los 64 KB completos desde la coincidencia y se los pasa al crate `evtx`. Un chunk que parsea se conserva; uno que falla se descarta silenciosamente.
5. **Extraer el nombre del provider.** Masstin parsea el primer record y lee su atributo `Provider Name="..."`. Esto determina en qué "fichero EVTX sintético" se escribirá el chunk.
6. **Agrupar por provider.** Todos los chunks con el mismo provider van al mismo bucket en memoria — p.ej. todos los chunks de Security-Auditing juntos, todos los de TerminalServices-LocalSessionManager juntos, etc.
7. **Construir ficheros EVTX sintéticos.** Para cada bucket, masstin escribe un file header (magic `ElfFile\x00`, número de chunks, CRC32) seguido de los chunks de 64 KB concatenados. El resultado es un `.evtx` real, parseable, con nombre del provider que contiene.
8. **Validar los ficheros sintéticos.** Cada fichero sintético se abre en un thread aislado y se recorre de principio a fin para detectar crashes/cuelgues/OOMs antes de que llegue al pipeline principal. Más sobre esto abajo — resultó ser esencial.
9. **Parsear por el pipeline normal de masstin.** Los ficheros validados se pasan a `parse_events_ex` exactamente como si hubieran sido extraídos de un sistema de ficheros NTFS. Los mismos 32+ Event IDs, la misma clasificación, las mismas columnas CSV, la misma carga a grafo.

La consecuencia clave: **los eventos carved son indistinguibles de los eventos live en la salida de masstin.** Aparecen en la misma timeline, en las mismas columnas, listos para `load-memgraph` o `load-neo4j` como cualquier otra fuente.

---

## Nivel 2 en masstin — escaneo de records huérfanos

Durante el mismo barrido en bloques de 4 MB, masstin también busca el magic de record `\x2a\x2a\x00\x00` en bytes que *no* están dentro de un chunk recuperado del Nivel 1. Cada candidato se valida:

- El campo de tamaño está entre 28 y 65024 bytes
- La copia del tamaño al final (en `size-4`) coincide con el tamaño de la cabecera
- El byte de preámbulo BinXML en offset 24 es `0x0F`
- El timestamp en offset 16 es un FILETIME en el rango 2000–2030

Los records que pasan las cuatro comprobaciones se cuentan y se reportan en el resumen final. Sus metadatos de cabecera (record ID, timestamp) están disponibles para investigación. Su cuerpo BinXML no se renderiza todavía a XML — eso es el Nivel 3.

En las imágenes que probamos, el Nivel 2 encuentra típicamente varias veces más records huérfanos que chunks completos del Nivel 1. La mayoría son records cuyo chunk padre ha sido parcialmente sobreescrito — los primeros kilobytes del chunk se han ido, las tablas de strings/templates se han perdido, pero records individuales más tarde en el chunk siguen intactos. El Nivel 3 es justo la herramienta para convertir esos recuentos en eventos.

---

## Nivel 3 — future work

El template matching es el próximo hito para el carving de masstin. El plan:

1. En la misma imagen, el Nivel 1 recupera chunks completos. Cada chunk que sobrevive aporta su tabla de templates a un corpus local.
2. Ampliar el corpus con una biblioteca pre-construida de templates Windows comunes (Security, SMB, TerminalServices, WinRM, etc.) recopiladas de instalaciones limpias conocidas — esas templates son estables entre versiones de Windows.
3. Para cada record huérfano del Nivel 2, recorrer su cuerpo BinXML consultando el corpus. Cuando toda template referenciada por el record tiene match, renderizar el XML completo.
4. Enviar el XML renderizado al pipeline normal de clasificación de eventos de masstin, de modo que los eventos del Nivel 3 aterricen en la misma timeline que los del Nivel 1.

Esto es trabajo de diseño, no simple codificación — las preguntas principales son cuán agresivamente hacer match contra el corpus (igualdad estricta de hash vs. matching estructural), cómo reportar records parcialmente decodificados, y cómo versionar la biblioteca de templates. No está en la release actual, pero la arquitectura es compatible con ello.

---

## Sobrevivir a un ecosistema hostil: endurecimiento contra bugs del parser upstream

Aquí viene la parte que nos sorprendió. El crate `evtx` (omerbenamram/evtx, el parser EVTX de facto en Rust) es excelente para parsear logs bien formados de un sistema Windows vivo. Nunca fue diseñado para lidiar con **buffers corruptos arbitrarios de 64 KB que dicen ser chunks**, que es exactamente lo que produce el carving.

Durante el desarrollo nos encontramos con tres clases distintas de bugs en el parser upstream:

### Bug 1 — Bucle infinito en BinXML malformado

Un chunk carved con una cabecera `ElfChnk\x00` aparentemente válida y un recuento de records razonable colgaba el parser indefinidamente cuando iterábamos sus records. No era un crash, no era un panic — un bucle infinito silencioso. Como era un bucle y no un panic, `std::panic::catch_unwind` era inútil contra él.

### Bug 2 — Asignación de varios GB (≈14 GB) en template corrupta

Un segundo chunk hacía que el parser leyera un campo de tamaño de una template BinXML corrupta e intentara asignar un `Vec` de ~14 GB. En una máquina con 64 GB de RAM esto aún abortaba el proceso completo con `memory allocation of 14136377380 bytes failed`. Como un abort de asignación en Rust es un abort, no un panic, de nuevo `catch_unwind` no podía recuperarlo.

### Bug 3 — Segunda asignación sin cota (≈2.3 GB)

Un chunk diferente, provider diferente, mismo modo de fallo — un intento de asignación de 2.3 GB que abortaba el proceso.

Los tres bugs eran **reproducibles**, **disparados por datos reales recuperados del espacio no asignado**, y **habrían hecho el carving de Nivel 1 inusable en la práctica**. Los reportamos upstream con repros mínimos y adjuntamos los chunks ofensivos.

### Cómo se defiende masstin

La escalera de defensas dentro de masstin es:

1. **Thread aislado para cada parseo de chunk.** Al extraer el nombre del provider durante el carving, la llamada a `peek_chunk_provider` corre en un thread worker dedicado con un `recv_timeout` de 3 segundos. Si el thread se cuelga, masstin imprime `[evtx hang] chunk at 0xOFFSET — skipping corrupt BinXML`, abandona el worker con `std::mem::forget` (morirá con el proceso), y continúa escaneando. **Bug 1 mitigado.**
2. **`alloc_error_hook` para cada parseo de validación.** Antes de validar los ficheros EVTX sintéticos, masstin instala `std::alloc::set_alloc_error_hook` para convertir fallos de asignación en panics. Ahora un `Vec::with_capacity(14_000_000_000)` desbocado se convierte en un panic atrapable en lugar de un abort del proceso. **Bugs 2 y 3 parcialmente mitigados.**
3. **Fase de validación con timeout + `catch_unwind`.** Cada fichero EVTX sintético pasa por un thread de validación aislado que recorre todos sus records con timeout de 15 segundos, con `catch_unwind` envolviendo el recorrido. Los ficheros que cuelgan, panican o disparan el alloc-error hook son **rechazados** y nunca llegan al pipeline principal de parseo. El resto de la timeline no se ve afectada. **Bugs 2 y 3 totalmente mitigados.**
4. **Escape hatch `--skip-offsets`.** Para imágenes patológicas donde ni siquiera el thread aislado es suficiente (por ejemplo, una llamada de read dentro del decompresor E01 que no retorna), el analista puede pasar `--skip-offsets 0x6478b6000,0x7a0000000` para decirle a masstin que salte una ventana de 32 MB alrededor de cada offset especificado en la siguiente ejecución. Los offsets de reads atascados se imprimen con una sugerencia lista para copy-paste.
5. **Preservación de ficheros rechazados en modo debug.** Cuando se ejecuta con `--debug`, masstin copia cada fichero EVTX sintético rechazado a `<output_dir>/masstin_rejected_evtx/` con un prefijo indicando el modo de fallo (`panic_oom__`, `hang__`, `open_fail__`). Esto permite al analista examinarlos con otras herramientas y te da los artefactos que necesitas para reportar un bug upstream.

El resultado: incluso cuando el parser upstream abortaría alegremente todo tu proceso con un solo chunk malformado, masstin termina el escaneo, construye la timeline a partir de los datos buenos, y te dice exactamente qué tuvo que descartar.

---

## Uso

```bash
# Carving de una imagen forense
masstin -a carve-image -f servidor.e01 -o carved-timeline.csv

# Carving de múltiples imágenes
masstin -a carve-image -f DC01.e01 -f SRV-FILE.vmdk -o carved.csv

# Escanear solo espacio no asignado (más rápido, planificado)
masstin -a carve-image -f servidor.e01 -o carved.csv --carve-unalloc

# Saltar offsets malos conocidos (para E01 patológicos)
masstin -a carve-image -f roto.e01 --skip-offsets 0x6478b6000 -o carved.csv

# Conservar ficheros rechazados para post-mortem (útil para reportes de bugs)
masstin -a carve-image -f imagen.e01 -o carved.csv --debug
```

La salida es el mismo CSV de 14 columnas que `parse-image`, con `log_filename` mostrando el origen carved:

```
HRServer_Disk0.e01_carved_Microsoft-Windows-Security-Auditing.evtx
```

---

## Resultados reales

### HRServer (DEFCON DFIR CTF 2018, E01 de 12.6 GB)

| Métrica | Resultado |
|---------|-----------|
| Tamaño imagen | 12.6 GB (E01 comprimido) |
| Tamaño disco | ~50 GB (expandido) |
| Chunks encontrados (Nivel 1) | 1,092 |
| Records huérfanos (Nivel 2) | 8,451 |
| Ficheros EVTX sintéticos | 94 (agrupados por provider) |
| **Eventos de movimiento lateral recuperados** | **37,772** |
| Tiempo de escaneo | ~3 minutos |

Solo el Nivel 1 recuperó Security.evtx (32,195 eventos), SMBServer (5,374), TerminalServices (90) y RdpCoreTS (136). Una timeline completa de movimiento lateral, construida enteramente a partir de bytes raw del disco, sin necesidad de NTFS ni VSS.

### Desktop (DEFCON DFIR CTF 2018, E01 de 29.2 GB / 50 GB lógicos)

| Métrica | Resultado |
|---------|-----------|
| Chunks encontrados (Nivel 1) | 2,219 |
| Records huérfanos (Nivel 2) | 28,503 |
| Ficheros EVTX sintéticos | 103 |
| Ficheros sintéticos rechazados | 2 (Bug 2 y Bug 3 de arriba) |
| **Eventos de movimiento lateral recuperados** | **34,916** |
| Tiempo de escaneo | ~8 minutos |

Esta fue la imagen que hizo aflorar los tres bugs upstream. Observa que **se construyeron 103 ficheros sintéticos, 2 fueron rechazados, y 101 fueron parseados con éxito** — sin las capas de endurecimiento, el primer rechazo habría tumbado el proceso entero, dejándote sin nada.

---

## Rendimiento

La velocidad del carving depende puramente de I/O: una sola pasada secuencial, sin seeks, casi sin CPU.

| Almacenamiento | Velocidad | Tiempo para 100 GB |
|----------------|-----------|---------------------|
| NVMe local | ~3 GB/s | ~35 segundos |
| SSD SATA | ~500 MB/s | ~3.5 minutos |
| E01 en SSD | ~200-400 MB/s | ~5-8 minutos |
| E01 en HDD | ~100-150 MB/s | ~12-17 minutos |
| Share de red | ~50-100 MB/s | ~17-33 minutos |

La fase de validación añade unos pocos segundos por fichero sintético, dominados por el timeout de 15 segundos cuando un fichero tiene que ser rechazado.

---

## Comparación con otras herramientas de carving

| Herramienta | Lenguaje | Nivel 1 | Nivel 2 | Nivel 3 | Parseo de movimiento lateral |
|-------------|----------|---------|---------|---------|------------------------------|
| **masstin `carve-image`** | Rust | Sí | Detección | Planificado | **Sí — pipeline completo** |
| EVTXtract (Ballenthin) | Python | Sí | Sí | Sí | No — genera XML raw |
| bulk_extractor-rec | C++ | Sí | Sí | No | No — genera ficheros raw |
| EvtxCarv | Python | Sí | Sí | Reensamblaje de fragmentos | No — genera ficheros raw |

Masstin es la única herramienta que hace carving de chunks EVTX **y** los parsea inmediatamente para movimiento lateral, produciendo una timeline lista para usar y cargar en grafo — y la única endurecida contra los propios bugs del parser upstream.

---

## Cuándo usar `carve-image` vs `parse-image`

| Escenario | Usar |
|-----------|------|
| Análisis forense normal | `parse-image` — extrae de NTFS + VSS |
| Logs borrados, VSS intacto | `parse-image` — la recuperación VSS lo maneja |
| Logs borrados, VSS borrado, UAL intacto | `parse-image` — UAL proporciona 3 años de historial |
| **Todo borrado** | **`carve-image` — recupera del espacio no asignado** |
| Recuperación máxima | Ambos: `parse-image` primero, luego `carve-image` sobre la misma imagen |

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Masstin — página principal | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Imágenes forenses y recuperación VSS | [parse-image](/es/tools/masstin-vss-recovery/) |
| MountPoints2 del registro | [MountPoints2](/es/artifacts/mountpoints2-lateral-movement/) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Artefactos Security.evtx | [Security.evtx](/es/artifacts/security-evtx-lateral-movement/) |
