---
layout: hub
title: "Artefactos"
description: "Artefactos forenses, ordenados por la pregunta que responden."
lang: es
ref: artifacts
permalink: /es/artifacts/
groups:
  - title: "Inicios de sesión y movimiento lateral"
    anchor: lateral
    text: "Quién entró en qué máquina, desde dónde y con qué cuenta. Es lo que lee [masstin](/es/tools/masstin/)."
  - title: "Windows"
    section: lateral-windows
    sub: true
  - title: "Linux"
    section: lateral-linux
    sub: true
  - title: "macOS"
    section: lateral-macos
    sub: true
  - title: "EDR, SIEM y red"
    section: lateral-feeds
    sub: true
  - title: "Ejecución"
    section: execution
    anchor: execution
    text: "Qué programas corrieron, cuándo y lanzados por quién."
  - title: "Recuperar lo borrado (carving)"
    section: recovery
    anchor: recovery
    text: "Lo que queda cuando alguien limpió los logs."
    links:
      - title: "EVTX borrados: carving del espacio no asignado"
        url: "/tools/evtx-carving-unallocated/"
      - title: "Volume Shadow Copies: los logs de antes del borrado"
        url: "/tools/masstin-vss-recovery/"
      - title: "UAL: tres años de accesos que sobreviven al borrado de eventos"
        url: "/tools/masstin-ual/"
---

Qué deja escrito cada sistema, dónde, y qué se puede afirmar con ello. Están ordenados por la pregunta que responden, que es como se buscan en mitad de un caso.
