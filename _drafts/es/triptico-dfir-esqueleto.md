---
layout: post
title: "[[TÍTULO]] — [[técnica]] en tres actos"
date: 2026-10-07 10:00:00 +0100
category: laboratorio
lang: es
ref: lab-triptico-NN
tags: [dfir, ataque, hardening, forense, active-directory]
description: "Una técnica, tres actos: la ejecutamos, la mitigamos y leemos el rastro en crudo sobre el laboratorio."
comments: true
---

<!--
  ESQUELETO / BORRADOR. Rellena los [[placeholders]] con tu ejecución REAL
  (comandos, capturas en /assets/img/posts/<caso>/, artefactos).
  GitHub Pages NO construye _drafts/, así que esto no se publica.
  Para publicar: mueve este archivo a _posts/es/ con la fecha real en el
  nombre (AAAA-MM-DD-slug.md) y crea el gemelo EN con el mismo `ref`.
-->

> Una técnica, tres actos. La **ejecutamos** (🔴), la **mitigamos** (🟢) y la **investigamos** (🔵) — y aprendemos a leer el rastro en crudo.

## El escenario

[[Qué laboratorio, qué hosts entran en juego, con qué usuario partimos y cuál es el objetivo. 2–3 frases. Nada de capturas sin contexto.]]

---

## Acto I · 🔴 El crimen — ataque

**Qué hacemos:** [[técnica — p.ej. Kerberoasting / NTLM relay / lateral SMB / ADCS ESC1]].

**Desde dónde:** [[host atacante y usuario comprometido — nunca el analista]].

```bash
# [[comando real]]
```

![[[descripción de la captura]]](/assets/img/posts/[[caso]]/ataque-01.png)

**Qué deja en la red:** [[qué vería —o no— un defensor en este momento]].

---

## Acto II · 🟢 La defensa — hardening

**Control aplicado:** [[LGPO / GPO / configuración concreta]].

```
# [[antes  →  después]]
```

**Qué cambia en la telemetría:**

| Señal | Antes | Después |
|-------|-------|---------|
| [[Event ID]] | [[…]] | [[…]] |
| [[…]] | [[…]] | [[…]] |

**Re-ejecución del ataque:** [[¿sigue funcionando? ¿qué cambia en el rastro que deja?]].

---

## Acto III · 🔵 La investigación — forense

Partimos de un **snapshot** del host comprometido, lo descargamos y lo analizamos **dead-box** — sin tocar el sistema vivo.

**Artefactos en crudo (sin herramientas de terceros):**

- [[clave de registro / EVTX / prefetch / UAL / …]] — qué dice y por qué importa.
- [[…]]

**Con mis herramientas:**

- `masstin` — [[grafo de movimiento lateral / timeline]].
- `boromir` — [[mecanismos de persistencia]].
- [[otras: sabonis, mftmactime, regripper…]].

**La conclusión del analista:** [[qué pasó, en una frase, con la evidencia concreta que lo prueba]].

---

### Reproducibilidad

[[Enlace al script / repo / comandos para reproducir los tres actos de cabo a rabo.]]
