---
layout: post
title: "Terminal Services EVTX: Rastreo forense de sesiones RDP"
date: 2026-04-07 09:00:00 +0100
category: artifacts
section: lateral-windows
order: 20
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

**Fichero:** `Microsoft-Windows-TerminalServices-LocalSessionManager%4Operational.evtx`, en `C:\Windows\System32\winevt\Logs\`. Los demás logs de este artículo están en la misma carpeta, con el nombre del canal y `%4` en lugar de la barra.

Este es el log más valioso para rastrear sesiones RDP en la máquina destino. Registra cada fase del ciclo de vida de la sesión.

### Event ID 21 — Logon de sesión exitoso

Se genera cuando se abre una sesión y se crea correctamente. Ojo: también lo escribe una sesión abierta en la consola física de la máquina. Se distinguen por el campo de origen, que en ese caso dice `LOCAL` en vez de una dirección.

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

### Event ID 1102 — Conexión RDP saliente con dirección

El cliente escribe: *The client has initiated a multi-transport connection to the server*, seguido de la **dirección** del servidor. Acompaña al 1024 en una conexión saliente, y entre los dos dan el nombre y la dirección del destino.

**No lo confundas con el 1102 de Security.evtx.** Allí ese mismo número significa «se borró el log de auditoría». Son dos eventos distintos que comparten número porque están en logs distintos. Antes de interpretar un Event ID, mira siempre de qué log viene.

---

## RemoteConnectionManager (Operational)

**Log:** `Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational`

### Event ID 1149 — Autenticación de usuario aceptada

El texto del evento es *Remote Desktop Services: User authentication succeeded*. Se escribe en la máquina destino cuando el servicio de escritorio remoto acepta una conexión con un nombre de usuario.

| Campo | Descripción |
|-------|------------|
| User | Cuenta con la que se conectó |
| Domain | Dominio proporcionado |
| Source Network Address | IP de origen |

Masstin lo escribe como `SUCCESSFUL_LOGON`.

> **Cómo leerlo con cuidado:** a pesar de su nombre, un 1149 no demuestra por sí solo que se abriera un escritorio. Dice que la conexión llegó y que la autenticación de red se aceptó. Para afirmar que hubo sesión, busca a continuación el **21** de LocalSessionManager y el **4624 tipo 10** de Security.evtx. Un 1149 sin ninguno de los dos es una conexión que no llegó a convertirse en sesión.
>
> Su gran valor es que este log rota mucho menos que Security.evtx: a menudo conserva la dirección de origen de conexiones de hace meses.

---

## RdpCoreTS (Operational)

**Log:** `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS/Operational`

### Event ID 131 — Conexión aceptada

El texto es *The server accepted a new TCP connection from client*, con la dirección y el puerto del cliente. Se escribe en el destino en cuanto llega la conexión, **antes de cualquier autenticación**.

| Campo | Descripción |
|-------|------------|
| ConnType | TCP o UDP |
| ClientIP | Dirección y puerto del cliente que se conecta |

> **Relevancia:** es el único de estos eventos que queda aunque nadie llegue a escribir un usuario. Un escaneo o una fuerza bruta contra RDP dejan aquí la dirección de origen, sin cuenta. Masstin lo escribe como `CONNECT`.

### Event ID 140 — Usuario o contraseña incorrectos

El texto es *A connection from the client computer with an IP address of … failed because the user name or password is not correct*. Es el fallo de autenticación de red visto desde el destino, con la dirección del cliente. Masstin lo escribe como `FAILED_LOGON`.

---

## Tabla resumen de eventos Terminal Services

| Log | Event ID | Máquina | Descripción | Relevancia |
|-----|:--------:|:-------:|-------------|-----------|
| LocalSessionManager | 21 | Destino | Logon de sesión | Alta — confirma sesión RDP establecida |
| LocalSessionManager | 22 | Destino | Inicio del shell | Media — confirma escritorio activo |
| LocalSessionManager | 24 | Destino | Desconexión | Media — sesión aún activa |
| LocalSessionManager | 25 | Destino | Reconexión | Alta — posible cambio de origen |
| RDPClient | 1024 | Origen | Conexión saliente (nombre del destino) | Alta — dice a dónde se conectó esta máquina |
| RDPClient | 1102 | Origen | Conexión saliente (dirección del destino) | Alta — completa al 1024 |
| RemoteConnectionManager | 1149 | Destino | Autenticación aceptada | Alta — conserva el origen durante meses |
| RdpCoreTS | 131 | Destino | Conexión aceptada, sin autenticar | Media — dirección de origen de escaneos |
| RdpCoreTS | 140 | Destino | Usuario o contraseña incorrectos | Alta — fuerza bruta por RDP |

---

## Reconstrucción de una sesión RDP completa

Para reconstruir una sesión RDP de principio a fin, correlaciona los eventos en este orden. Los que dicen Security.evtx están en otro fichero, `Security.evtx`, de la misma máquina destino:

1. **131** (RdpCoreTS) — Llega la conexión: dirección de origen
2. **1149** (RemoteConnectionManager) — Autenticación aceptada: cuenta y dirección
3. **4624 tipo 10** (Security.evtx) — Inicio de sesión
4. **21** (LocalSessionManager) — Sesión creada
5. **22** (LocalSessionManager) — Escritorio arrancado
6. *...actividad del atacante...*
7. **24** (LocalSessionManager) — Desconexión
8. **25** (LocalSessionManager) — Posible reconexión
9. **4779** (Security.evtx) — Desconexión RDP registrada
10. **4647/4634** (Security.evtx) — Cierre de sesión

En la máquina **origen**, busca el **1024** y el **1102** (RDPClient) para confirmar desde dónde se inició la conexión.

---

## Cómo masstin procesa Terminal Services

[Masstin](/es/tools/masstin-lateral-movement-rust/) lee estos cuatro logs automáticamente: los Event IDs 21, 22, 24 y 25 de LocalSessionManager, el 1149 de RemoteConnectionManager, el 1024 y el 1102 de RDPClient y el 131 y el 140 de RdpCoreTS. Los integra en la timeline CSV junto con los eventos de Security.evtx y otros artefactos.

```bash
masstin -a parse -d /evidence/logs/ -o timeline.csv
```

Esto te permite ver en una sola vista cronológica cómo el atacante se movió vía RDP entre diferentes máquinas, correlacionando orígenes y destinos sin tener que abrir cada EVTX individualmente.

---

## Conclusión

Los logs de Terminal Services son imprescindibles para cualquier investigación que involucre RDP. Mientras que Security.evtx te da los logons, estos logs especializados te proporcionan el contexto completo: quién intentó conectar (incluso sin éxito), cuándo se inició el shell, cuándo se desconectó y desde dónde reconectó.

Para procesar estos artefactos de forma masiva y correlacionarlos con el resto de evidencias de movimiento lateral, usa [masstin](/es/tools/masstin-lateral-movement-rust/).
