---
layout: post
title: "Neo4j y Cypher: Visualización de movimiento lateral con masstin"
date: 2026-04-07 05:00:00 +0100
category: tools
lang: es
ref: tool-masstin-neo4j
tags: [masstin, neo4j, cypher, grafos, lateral-movement, visualization, herramientas]
description: "Guía completa de visualización de movimiento lateral en Neo4j con masstin: queries Cypher para filtrado temporal, cuentas de servicio, usuarios específicos y detección de pivots."
comments: true
---

## Por qué visualizar en grafos

Cuando tienes 50 máquinas, miles de logons y necesitas encontrar por dónde se movió el atacante, un CSV no es suficiente. Necesitas ver las **relaciones** — qué máquina se conectó a cuál, con qué usuario, y cuándo.

Neo4j convierte la timeline de [masstin](/es/tools/masstin-lateral-movement-rust/) en un grafo interactivo donde cada máquina es un nodo y cada conexión lateral es una arista. Esto te permite ver patrones que en una tabla serían invisibles.

---

## Transformaciones de datos

Antes de escribir queries, es importante entender que masstin aplica transformaciones al cargar datos en Neo4j, debido a restricciones del lenguaje Cypher:

| Carácter original | Transformación | Ejemplo |
|-------------------|----------------|---------|
| Puntos (`.`) | Reemplazados por `_` | `10.10.1.50` → `10_10_1_50` |
| Guiones (`-`) | Reemplazados por `_` | `SRV-FILE01` → `SRV_FILE01` |
| Espacios | Reemplazados por `_` | |
| Minúsculas | Convertidas a MAYÚSCULAS | `adm_domain` → `ADM_DOMAIN` |
| `@` y posteriores | Eliminados | `user@domain` → `USER` |

Tenlo en cuenta al escribir tus queries — usa siempre los valores transformados.

---

## El poder del filtrado temporal

Esta es la característica más valiosa de la visualización con masstin y Neo4j.

Masstin agrupa las conexiones por máquina origen, máquina destino, usuario y tipo de logon, y almacena la **fecha más antigua** de cada grupo. Esto significa que cuando filtras por rango temporal, **automáticamente eliminas todas las conexiones que ya existían antes de ese periodo**.

¿Por qué es esto tan importante? En una respuesta ante incidentes, la red está llena de movimiento lateral legítimo: cuentas de servicio, administradores haciendo su trabajo, usuarios accediendo a recursos compartidos. Todo ese ruido ha estado ahí durante meses. Pero las conexiones del atacante son **nuevas**.

Al filtrar por el periodo en el que sospechas que comenzó el ataque, todo el ruido histórico desaparece y solo quedan las conexiones que se vieron **por primera vez** en esa ventana temporal. En cuestión de segundos pasas de un grafo ilegible a un mapa claro del movimiento del atacante.

---

## Queries Cypher

### Ver todo el movimiento lateral

```cypher
MATCH (h1:host)-[r]->(h2:host)
RETURN h1, r, h2
```

### Filtrar por rango temporal

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-13T00:00:00.000000000Z")
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Excluir cuentas de máquina y conexiones sin usuario

Las cuentas de máquina (terminadas en `$`) y las conexiones sin usuario resuelto (`NO_USER`) generan mucho ruido. Filtrarlas te deja solo movimiento lateral iniciado por personas:

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-13T00:00:00.000000000Z")
  AND NOT r.target_user_name ENDS WITH '$'
  AND NOT r.target_user_name = 'NO_USER'
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Solo conexiones RDP (logon type 10)

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-13T00:00:00.000000000Z")
  AND NOT r.target_user_name ENDS WITH '$'
  AND r.logon_type = '10'
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Solo conexiones de red (logon type 3 — SMB, PsExec, WMI)

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-13T00:00:00.000000000Z")
  AND NOT r.target_user_name ENDS WITH '$'
  AND r.logon_type = '3'
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Cuentas de servicio por convención de nombres

Si tu organización usa un prefijo para cuentas de servicio (ej: `SVC_`):

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-10T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-14T00:00:00.000000000Z")
  AND (
    r.target_user_name STARTS WITH 'SVC'
    OR r.subject_user_name STARTS WITH 'SVC'
  )
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Filtrar por usuarios, máquinas e IPs específicas

Cuando ya has identificado cuentas o máquinas sospechosas, esta query traza su actividad completa. Recuerda usar los valores transformados (guiones bajos, mayúsculas):

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE datetime(r.time) >= datetime("2026-03-12T00:00:00.000000000Z")
  AND datetime(r.time) <= datetime("2026-03-13T00:00:00.000000000Z")
  AND NOT r.target_user_name ENDS WITH '$'
  AND NOT r.target_user_name = 'NO_USER'
  AND r.logon_type IN ['3', '10']
  AND (
    (h1.name = 'WS_HR02' OR h2.name = 'WS_HR02')
    OR r.target_user_name IN ['ADM_DOMAIN', 'M_LOPEZ']
    OR r.subject_user_name IN ['ADM_DOMAIN', 'M_LOPEZ']
    OR r.src_ip IN ['10_99_88_77', '10_10_1_80']
  )
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Rastrear a un usuario concreto

```cypher
MATCH (h1:host)-[r]->(h2:host)
WHERE r.target_user_name = 'ADM_DOMAIN'
RETURN h1, r, h2
ORDER BY datetime(r.time)
```

### Nodos más conectados (objetivos o puntos de pivoting)

Identifica qué máquinas tienen más conexiones entrantes:

```cypher
MATCH (h1:host)-[r]->(h2:host)
RETURN h2.name AS target, COUNT(r) AS connections
ORDER BY connections DESC
LIMIT 10
```
