---
layout: post
title: "SMB EVTX: Eventos forenses de movimiento lateral por SMB"
date: 2026-04-07 10:00:00 +0100
category: artifacts
lang: es
ref: artifact-smb-events
tags: [evtx, smb, lateral-movement, dfir, masstin, shares, network]
description: "Guía forense de los eventos EVTX de SMBServer y SMBClient para detectar movimiento lateral mediante Server Message Block: conexiones, autenticación y acceso a shares."
comments: true
---

## SMB: el protocolo silencioso del movimiento lateral

Server Message Block (SMB) es el protocolo nativo de Windows para compartir archivos, impresoras y servicios entre máquinas en red. Por eso mismo, es uno de los vectores más utilizados en el movimiento lateral:

- **PsExec** utiliza SMB para copiar un ejecutable al share `ADMIN$` y crear un servicio remoto.
- **Herramientas de post-explotación** como Cobalt Strike, Impacket y CrackMapExec se apoyan en SMB para ejecutar comandos remotos.
- **Exfiltración de datos** a menudo se realiza copiando archivos a shares de red vía SMB.
- **Ransomware** frecuentemente se propaga cifrando shares SMB accesibles.

A diferencia de los eventos de logon en Security.evtx, los logs específicos de SMB proporcionan visibilidad sobre las **conexiones de red** a nivel de protocolo, incluyendo intentos fallidos que pueden no generar eventos en otros logs.

[Masstin](/es/tools/masstin-lateral-movement-rust/) parsea los logs de SMBServer y SMBClient para integrar esta actividad en la timeline de movimiento lateral.

---

## SMBServer/Security

**Log:** `Microsoft-Windows-SMBServer/Security`

Estos eventos se generan en la **máquina destino** (el servidor SMB que recibe las conexiones).

### Event ID 1009 — Intento de conexión SMB

Se genera cuando un cliente intenta establecer una conexión SMB con el servidor. Este evento registra la fase inicial del protocolo, antes de la autenticación.

| Campo | Descripción |
|-------|------------|
| ClientName | Nombre o IP del equipo que intenta conectar |
| ServerName | Nombre del servidor destino |
| ShareName | Share al que se intenta acceder |

> **Valor forense:** Un volumen inusual de 1009 desde una misma IP hacia múltiples shares puede indicar **enumeración de shares** — una técnica común de reconocimiento previo al movimiento lateral.

### Event ID 551 — Fallo de autenticación SMB

Se genera cuando la autenticación SMB falla. Esto es distinto del 4625 de Security.evtx: el 551 es específico del protocolo SMB y puede capturar fallos que no se registran en otros logs.

| Campo | Descripción |
|-------|------------|
| ClientName | Equipo origen del intento |
| UserName | Cuenta con la que se intentó autenticar |
| Status | Código de error (similar a los Sub Status del 4625) |

> **Correlación:** Una ráfaga de 551 seguida de un acceso exitoso a un share (visible en el Event ID 31001 de SMBClient o en un 4624 tipo 3) indica que el atacante realizó fuerza bruta o password spraying exitoso.

---

## SMBClient/Security

**Log:** `Microsoft-Windows-SMBClient/Security`

Estos eventos se generan en la **máquina origen** (el cliente SMB que inicia las conexiones). Son fundamentales para determinar desde qué máquina el atacante accedió a los shares remotos.

### Event ID 31001 — Conexión a share remoto

Se genera cuando el cliente SMB conecta exitosamente a un share de red.

| Campo | Descripción |
|-------|------------|
| ServerName | Servidor al que se conectó |
| ShareName | Nombre del share accedido (ej: `\\servidor\ADMIN$`, `\\servidor\C$`) |
| UserName | Cuenta utilizada para la conexión |
| Reason | Motivo/resultado de la conexión |

> **Indicadores de movimiento lateral:**
> - Acceso a `ADMIN$` o `C$`: típico de PsExec, Impacket y herramientas similares.
> - Acceso a shares no estándar desde cuentas inesperadas: posible exfiltración.
> - Múltiples conexiones a shares de diferentes servidores en corto tiempo: movimiento lateral activo.

---

## SMBClient/Connectivity

**Log:** `Microsoft-Windows-SMBClient/Connectivity`

Este log registra el estado de las conexiones SMB salientes y proporciona información de diagnóstico sobre la conectividad de red.

### Event IDs 30803 - 30808 — Estado de conectividad y acceso a shares

Estos eventos cubren diferentes aspectos de la conectividad SMB:

| Event ID | Descripción | Relevancia forense |
|:--------:|-------------|-------------------|
| 30803 | Conexión TCP al servidor SMB establecida | Confirma conectividad de red |
| 30804 | Fallo en conexión TCP al servidor SMB | El servidor no responde en el puerto 445 |
| 30805 | Negociación de protocolo SMB completada | Versión de SMB acordada (SMBv1, v2, v3) |
| 30806 | Fallo en negociación de protocolo | Incompatibilidad de versiones o configuración |
| 30807 | Sesión SMB establecida exitosamente | Autenticación y sesión activa |
| 30808 | Fallo al establecer sesión SMB | Error de autenticación a nivel de protocolo |

| Campo común | Descripción |
|-------------|------------|
| ServerName | Servidor al que se intentó conectar |
| ShareName | Share solicitado (cuando aplica) |
| Reason / ErrorCode | Motivo del fallo (cuando aplica) |

> **Secuencia forense:** Para una conexión SMB exitosa, esperarías ver: 30803 (TCP OK) → 30805 (negociación OK) → 30807 (sesión OK). Si faltan pasos intermedios, algo falló.

> **Detección de reconocimiento:** Múltiples 30804 (fallos TCP) hacia diferentes IPs en el puerto 445 desde una misma máquina indican escaneo de red buscando servidores SMB accesibles.

---

## Tabla resumen de eventos SMB

| Log | Event ID | Máquina | Descripción | Relevancia |
|-----|:--------:|:-------:|-------------|-----------|
| SMBServer/Security | 1009 | Destino | Intento de conexión | Alta — detecta enumeración |
| SMBServer/Security | 551 | Destino | Fallo de autenticación | Alta — fuerza bruta SMB |
| SMBClient/Security | 31001 | Origen | Conexión a share exitosa | Alta — confirma acceso remoto |
| SMBClient/Connectivity | 30803 | Origen | TCP establecido | Media — confirma conectividad |
| SMBClient/Connectivity | 30804 | Origen | TCP fallido | Media — detecta escaneo |
| SMBClient/Connectivity | 30805 | Origen | Negociación SMB exitosa | Media — versión de protocolo |
| SMBClient/Connectivity | 30806 | Origen | Negociación SMB fallida | Baja — problemas de compatibilidad |
| SMBClient/Connectivity | 30807 | Origen | Sesión SMB establecida | Alta — acceso confirmado |
| SMBClient/Connectivity | 30808 | Origen | Sesión SMB fallida | Media-Alta — fallo de auth |

---

## Correlación con otros artefactos

Los eventos SMB no viven aislados. Para una investigación completa, correlaciónalos con:

| Artefacto | Evento | Qué aporta |
|-----------|--------|-----------|
| Security.evtx | 4624 tipo 3 | Confirma logon de red exitoso (a menudo causado por SMB) |
| Security.evtx | 4625 | Logon fallido — puede correlacionarse con 551 del SMBServer |
| Security.evtx | 4648 | Credenciales explícitas — RunAs previo a conexión SMB |
| System.evtx | 7045 | Instalación de servicio — PsExec crea un servicio tras copiar vía SMB |
| Prefetch | `psexesvc.exe` | Confirma ejecución de PsExec en el destino |

---

## Escenarios de ataque comunes

### PsExec

1. **Origen:** 31001 hacia `\\victima\ADMIN$` (copia del ejecutable)
2. **Destino:** 1009 (conexión recibida)
3. **Destino:** 4624 tipo 3 (logon de red)
4. **Destino:** 7045 (instalación de servicio PSEXESVC)

### CrackMapExec / Impacket SMBExec

1. **Origen:** 30803 → 30805 → 30807 (conexión TCP, negociación, sesión)
2. **Origen:** 31001 hacia `\\victima\ADMIN$` o `\\victima\IPC$`
3. **Destino:** 4624 tipo 3 con `LogonProcessName: NtLmSsp`
4. **Destino:** Posible 7045 (servicio temporal)

### Enumeración de shares

1. **Origen:** Múltiples 30803 hacia diferentes IPs (escaneo puerto 445)
2. **Origen:** Múltiples 31001 hacia diferentes shares del mismo servidor
3. **Destino:** Múltiples 1009 desde la misma IP origen

---

## Cómo masstin parsea los logs SMB

[Masstin](/es/tools/masstin-lateral-movement-rust/) extrae los eventos de SMBServer y SMBClient automáticamente y los normaliza en la timeline CSV, incluyendo IP de origen, share accedido, cuenta utilizada y resultado de la conexión.

```bash
masstin -a parse-windows -d /evidence/logs/ -o timeline.csv
```

Combinados con los eventos de Security.evtx y Terminal Services, los eventos SMB completan la visión del movimiento lateral por red, cubriendo los tres vectores principales: RDP, SMB y autenticación.

---

## Conclusión

Los logs de SMBServer y SMBClient son una fuente de evidencia forense que muchos analistas pasan por alto, centrándose únicamente en Security.evtx. Sin embargo, estos logs proporcionan detalles a nivel de protocolo que pueden revelar enumeración, fuerza bruta y acceso a shares que de otra forma quedarían ocultos.

Para integrar estos artefactos en tu análisis de movimiento lateral de forma automática, [masstin](/es/tools/masstin-lateral-movement-rust/) es la herramienta indicada.
