---
layout: hub
title: "Herramientas"
description: "Herramientas DFIR propias: una pregunta por herramienta, el mismo formato de timeline en todas."
lang: es
ref: tools
permalink: /es/tools/
groups:
  - title: "masstin — quién inició sesión dónde"
    section: masstin
    anchor: masstin
    text: "Todos los logins de una red (Windows, Linux, macOS, EDR) en una sola timeline, un hunt estadístico encima y una ventana propia para verlo. [Todo sobre masstin →](/es/tools/masstin/)"
  - title: "Leer la evidencia"
    section: masstin-read
    anchor: read
    sub: true
  - title: "Recuperar lo borrado"
    section: masstin-recover
    anchor: recover
    sub: true
  - title: "El visor"
    section: masstin-viewer
    anchor: viewer
    sub: true
  - title: "Cazar"
    section: masstin-hunt
    anchor: hunt
    sub: true
  - title: "Bases de datos de grafos"
    section: masstin-graph
    anchor: graph
    sub: true
  - title: "Referencia"
    section: masstin-ref
    anchor: ref
    sub: true
  - title: "caarea — qué se ejecutó"
    section: caarea
    anchor: caarea
    text: "Cada ejecución de programa en Windows y Linux, de más de 60 fuentes, con la genealogía de procesos reconstruida."
    links:
      - title: "El código y la documentación, en GitHub"
        url: "https://github.com/jupyterj0nes/caarea"
  - title: "faramir — qué persiste"
    section: faramir
    anchor: faramir
    text: "Cada mecanismo de arranque, secuestro y puerta trasera, vivo o borrado: 52 técnicas en Windows y las de Linux."
    links:
      - title: "El código y la documentación, en GitHub"
        url: "https://github.com/jupyterj0nes/faramir"
  - title: "allymacb — qué hizo el sistema de ficheros"
    section: allymacb
    anchor: allymacb
    text: "La timeline MACB de NTFS, ext4 y XFS, con detección de timestomping y recuperación de registros borrados."
    links:
      - title: "El código y la documentación, en GitHub"
        url: "https://github.com/jupyterj0nes/allymacb"
  - title: "etcdump — cómo estaba configurado un Linux"
    section: etcdump
    anchor: etcdump
    text: "La configuración de cada raíz Linux de una imagen o un triage, como texto y como timeline, con 51 reglas."
    links:
      - title: "El código y la documentación, en GitHub"
        url: "https://github.com/jupyterj0nes/etcdump"
  - title: "Las piezas comunes"
    section: common
    anchor: common
    text: "Las bibliotecas que comparten todas las herramientas."
    links:
      - title: "evidencefs"
        url: "https://github.com/jupyterj0nes/evidencefs"
        text: "Un solo lector para imágenes, volúmenes, shadow copies, triages y archivos."
      - title: "blockcarve"
        url: "https://github.com/jupyterj0nes/blockcarve"
        text: "El carving por bloques que usan todas, con validadores de estructura."
      - title: "dirtyhive"
        url: "https://github.com/jupyterj0nes/dirtyhive"
        text: "Hives de registro sucios: transaction logs aplicados y claves borradas recuperadas."
  - title: "En preparación"
    anchor: soon
    text: "Herramientas terminadas o casi, todavía sin publicar."
    soon:
      - title: "agentc00pr — el banco de trabajo del caso"
      - title: "opentrail — qué se abrió"
      - title: "exfilter — qué salió de la máquina"
      - title: "webfoot — qué hizo en el navegador"
      - title: "hivedump — el registro entero como timeline"
      - title: "hostsweep — YARA, IOC y Sigma sobre la evidencia"
      - title: "lunarrust — triage de sistemas Unix por CVE"
  - title: "Anteriores y contribuidas"
    section: legacy
    anchor: legacy
---

Cada herramienta de aquí responde a una sola pregunta de una investigación, y todas escriben el mismo tipo de timeline: un CSV de 19 columnas en UTC, con las mismas cinco columnas finales para lo que encuentra el hunt y lo que anota el analista. Por eso se pueden leer juntas.

| Pregunta | Herramienta |
|---|---|
| ¿Quién inició sesión dónde? | **masstin** |
| ¿Qué se ejecutó? | **caarea** |
| ¿Qué persiste? | **faramir** |
| ¿Qué hizo el sistema de ficheros? | **allymacb** |
| ¿Cómo estaba configurado ese Linux? | **etcdump** |
