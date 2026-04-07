---
layout: post
title: "Terminal Services EVTX: Rastreo forense de sesiones RDP"
date: 2026-04-07 09:00:00 +0100
category: artifacts
lang: es
ref: artifact-terminal-services
tags: [evtx, rdp, terminal-services, lateral-movement, dfir, masstin, remote-desktop]
description: "Análisis forense de los logs de Terminal Services en Windows: LocalSessionManager, RDPClient, RemoteConnectionManager y RdpCoreTS para reconstruir sesiones RDP de movimiento lateral."
comments: true
---

## RDP como vector de movimiento lateral

El Protocolo de Escritorio Remoto (RDP) es una de las herramientas legítimas más abusadas por los atacantes para moverse lateralmente dentro de una red comprometida. A diferencia de técnicas como PsExec o WMI, RDP proporciona al atacante un escritorio completo, lo que le permite operar con comodidad, ejecutar herramientas con interfaz gráfica y pasar más desapercibido al mezclarse con la actividad administrativa normal.

Windows registra la actividad RDP en varios logs de eventos especializados bajo el paraguas de **Terminal Services**. Mientras que Security.evtx captura los logons tipo 10, los logs de Terminal Services proporcionan detalles adicionales sobre el ciclo de vida completo de la sesión: conexión, autenticación, inicio del shell, desconexión y cierre.

[Masstin](/es/tools/masstin-lateral-movement-rust/) parsea estos logs automáticamente para reconstruir las sesiones RDP como parte de la timeline de movimiento lateral.

---

## LocalSessionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-LocalSessionManager/Operational`

Este es el log más valioso para rastrear sesiones RDP en la máquina destino. Registra cada fase del ciclo de vida de la sesión.

### Event ID 21 — Logon de sesión exitoso

Se genera cuando un usuario inicia sesión de forma remota y la sesión se crea correctamente.

| Campo | Descripción |
|-------|------------|
| User | Cuenta que inició sesión (DOMINIO\usuario) |
| SessionID | Identificador numérico de la sesión |
| Source Network Address | **IP del equipo origen** — dato clave para movimiento lateral |

> **Contexto forense:** Este evento confirma que la sesión RDP se estableció completamente, no solo que hubo un intento de conexión.

### Event ID 22 — Inicio del shell

Se genera cuando el shell gráfico (explorer.exe) se inicia dentro de la sesión RDP. Esto confirma que el usuario tiene un escritorio activo.

| Campo | Descripción |
|-------|------------|
| User | Cuenta de la sesión |
| SessionID | ID de sesión |
| Source Network Address | IP de origen |

> **Tip:** Si ves un 21 sin un 22 posterior, la sesión se creó pero el shell no llegó a iniciar. Puede indicar una sesión automatizada o un fallo en la conexión.

### Event ID 24 — Sesión desconectada

Se genera cuando la sesión RDP se desconecta sin cerrar sesión. La sesión permanece activa en el servidor, consumiendo recursos y potencialmente ejecutando procesos del atacante.

| Campo | Descripción |
|-------|------------|
| User | Cuenta de la sesión |
| SessionID | ID de sesión |

> **Relevancia:** Los atacantes frecuentemente desconectan las sesiones RDP en lugar de cerrarlas, para poder reconectar más tarde sin volver a autenticarse.

### Event ID 25 — Reconexión de sesión

Se genera cuando un usuario se reconecta a una sesión previamente desconectada.

| Campo | Descripción |
|-------|------------|
| User | Cuenta reconectada |
| SessionID | ID de sesión |
| Source Network Address | IP desde la que se reconecta (puede ser diferente a la original) |

> **Investigación:** Compara la IP del evento 21 original con la del evento 25. Si son diferentes, alguien reconectó a la sesión desde otra máquina — posible indicador de que las credenciales fueron comprometidas.

---

## TerminalServices-RDPClient (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RDPClient/Operational`

Este log se genera en la **máquina origen** (el cliente RDP), no en el destino. Es fundamental para identificar desde qué máquina el atacante inició la conexión RDP.

### Event ID 1024 — Inicio de conexión RDP saliente

Se genera cuando el cliente RDP (mstsc.exe u otro) inicia una conexión hacia un servidor remoto.

| Campo | Descripción |
|-------|------------|
| Value | Hostname o IP del servidor destino |

> **Importancia forense:** Este evento en una workstation comprometida te dice a qué otras máquinas se conectó el atacante vía RDP. Es la perspectiva del **origen**, complementaria al Event ID 21 en el destino.

### Event ID 1102 — Clearing de log de auditoría

Aunque este Event ID tiene el mismo número en Security.evtx, en el contexto de RDPClient indica que el log de auditoría fue limpiado. Si un atacante borra este log, es un indicador de anti-forensics.

---

## RemoteConnectionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational`

### Event ID 1149 — Conexión RDP recibida

Se genera en la máquina destino cuando se recibe una conexión RDP, **antes de la autenticación**. Es decir, este evento indica que alguien intentó conectar, independientemente de si las credenciales eran correctas.

| Campo | Descripción |
|-------|------------|
| User | Cuenta con la que se intentó conectar |
| Domain | Dominio proporcionado |
| Source Network Address | IP de origen |

> **Valor forense clave:** Un 1149 sin un 21 posterior indica un intento de conexión RDP fallido. Esto es muy útil para detectar reconocimiento o fuerza bruta por RDP, especialmente cuando los 4625 de Security.evtx no están disponibles.

---

## RdpCoreTS (Operational)

**Log:** `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS/Operational`

### Event ID 131 — Negociación de seguridad del transporte

Se genera durante la fase de negociación TLS/NLA de la conexión RDP. Registra el protocolo de seguridad acordado entre cliente y servidor.

| Campo | Descripción |
|-------|------------|
| ClientIP | IP del cliente que se conecta |
| SecurityProtocol | Protocolo negociado (TLS, CredSSP/NLA, etc.) |

> **Relevancia:** Las conexiones con seguridad reducida (sin NLA) pueden indicar configuraciones inseguras o ataques de downgrade.

---

## Tabla resumen de eventos Terminal Services

| Log | Event ID | Máquina | Descripción | Relevancia |
|-----|:--------:|:-------:|-------------|-----------|
| LocalSessionManager | 21 | Destino | Logon de sesión | Alta — confirma sesión RDP establecida |
| LocalSessionManager | 22 | Destino | Inicio del shell | Media — confirma escritorio activo |
| LocalSessionManager | 24 | Destino | Desconexión | Media — sesión aún activa |
| LocalSessionManager | 25 | Destino | Reconexión | Alta — posible cambio de origen |
| RDPClient | 1024 | Origen | Conexión saliente | Alta — identifica máquina origen |
| RDPClient | 1102 | Origen | Limpieza de log | Alta — anti-forensics |
| RemoteConnectionManager | 1149 | Destino | Conexión recibida (pre-auth) | Alta — incluye intentos fallidos |
| RdpCoreTS | 131 | Destino | Negociación de seguridad | Media — protocolo y IP |

---

## Reconstrucción de una sesión RDP completa

Para reconstruir una sesión RDP de principio a fin, correlaciona los eventos en este orden:

1. **1149** (RemoteConnectionManager) — Conexión recibida, IP de origen
2. **131** (RdpCoreTS) — Negociación de seguridad
3. **4624 tipo 10** (Security.evtx) — Autenticación exitosa
4. **21** (LocalSessionManager) — Sesión creada
5. **22** (LocalSessionManager) — Shell iniciado
6. *...actividad del atacante...*
7. **24** (LocalSessionManager) — Desconexión
8. **25** (LocalSessionManager) — Posible reconexión
9. **4779** (Security.evtx) — Desconexión RDP registrada
10. **4647/4634** (Security.evtx) — Logoff

En el origen, busca el **1024** (RDPClient) para confirmar qué máquina inició la conexión.

---

## Cómo masstin procesa Terminal Services

[Masstin](/es/tools/masstin-lateral-movement-rust/) parsea los logs de TerminalServices-LocalSessionManager y RemoteConnectionManager automáticamente, extrayendo los Event IDs 21, 22, 24, 25 y 1149, y los integra en la timeline unificada CSV junto con los eventos de Security.evtx y otros artefactos.

```bash
masstin -a parse-windows -d /evidence/logs/ -o timeline.csv
```

Esto te permite ver en una sola vista cronológica cómo el atacante se movió vía RDP entre diferentes máquinas, correlacionando orígenes y destinos sin tener que abrir cada EVTX individualmente.

---

## Conclusión

Los logs de Terminal Services son imprescindibles para cualquier investigación que involucre RDP. Mientras que Security.evtx te da los logons, estos logs especializados te proporcionan el contexto completo: quién intentó conectar (incluso sin éxito), cuándo se inició el shell, cuándo se desconectó y desde dónde reconectó.

Para procesar estos artefactos de forma masiva y correlacionarlos con el resto de evidencias de movimiento lateral, usa [masstin](/es/tools/masstin-lateral-movement-rust/).
