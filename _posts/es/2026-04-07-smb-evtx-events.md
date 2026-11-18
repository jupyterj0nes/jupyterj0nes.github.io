---
layout: post
title: "SMB EVTX: Eventos forenses de movimiento lateral por SMB"
date: 2026-04-07 10:00:00 +0100
category: artifacts
section: lateral-windows
order: 30
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

### Event ID 1009 — Acceso anónimo denegado

Se genera cuando el servidor deniega el acceso anónimo (sesión nula) a un cliente. Registra un toque sin autenticar, no una conexión establecida, así que masstin lo escribe como `FAILED_LOGON`.

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

> **Correlación:** Una ráfaga de 551 seguida de un acceso exitoso a un share (un 4624 tipo 3 en Security.evtx del mismo servidor, desde la misma dirección) indica que el atacante hizo fuerza bruta o *password spraying* y acertó.

---

## SMBClient/Security

**Log:** `Microsoft-Windows-SMBClient/Security`

**Fichero:** `Microsoft-Windows-SmbClient%4Security.evtx`, en `C:\Windows\System32\winevt\Logs\`

Estos eventos se generan en la **máquina origen** (el cliente SMB que inicia las conexiones). Son fundamentales para determinar desde qué máquina el atacante accedió a los shares remotos.

### Event ID 31001 — Fallo de autenticación contra un servidor remoto

Se genera (nivel Error) cuando el cliente SMB **no consigue** autenticarse en un servidor. Es un evento de fallo: no dice que se accediera a nada. Masstin lo escribe como `FAILED_LOGON`.

| Campo | Descripción |
|-------|------------|
| Server name | Servidor contra el que se intentó la conexión |
| User name | Cuenta con la que se intentó |
| Error / Security status | Por qué falló |
| Share | El recurso que se pedía, cuando el evento lo trae (ej: `\\servidor\ADMIN$`) |

> **Indicadores de movimiento lateral:**
> - Intentos fallidos contra `ADMIN$` o `C$`: alguien probando credenciales con PsExec, Impacket o herramientas parecidas.
> - Muchos fallos contra servidores distintos en poco tiempo: prueba de credenciales en marcha.
>
> Lo valioso de este evento es el lado en el que se escribe: en la máquina **origen**. Aunque no tengas los logs del servidor atacado, aquí queda su nombre.

---

## SMBClient/Connectivity

**Log:** `Microsoft-Windows-SMBClient/Connectivity`

**Fichero:** `Microsoft-Windows-SmbClient%4Connectivity.evtx`

Este log apunta **problemas** de las conexiones SMB salientes: conexiones que no se pudieron abrir, sesiones que se cortaron y recursos que se perdieron y se recuperaron. Una conexión que va bien de principio a fin no deja nada aquí.

### Event IDs 30803 - 30808 — Conexiones que fallan, se cortan o se recuperan

El texto es el que escribe el propio Windows:

| Event ID | Texto del evento | Qué significa |
|:--------:|------------------|---------------|
| 30803 | *Failed to establish a network connection* | No se pudo abrir la conexión de red con el servidor. Es un fallo de red, no de SMB |
| 30804 | *A network connection was disconnected* | Una conexión que estaba abierta se cortó |
| 30805 | *The client lost its session to the server* | Se perdió la sesión con el servidor |
| 30806 | *The client re-established its session to the server* | La sesión perdida se recuperó |
| 30807 | *The connection to the share was lost* | Se perdió la conexión a un recurso compartido |
| 30808 | *The connection to the share was re-established* | Esa conexión al recurso se recuperó |

| Campo común | Descripción |
|-------------|------------|
| Server name | Servidor con el que se hablaba |
| Server address | Su dirección, cuando el evento la trae |
| Share name | El recurso, en 30807 y 30808 |
| Error | Motivo, en los de fallo |

> **Por qué sirven en una investigación:** aunque sean eventos de avería, cada uno nombra un servidor, y los 30807 y 30808 nombran además un recurso compartido. Un 30807 con `\\servidor\Finanzas$` prueba que esa máquina tenía ese recurso abierto en ese momento, aunque no quede ningún otro rastro.

> **Detección de reconocimiento:** muchos 30803 (no se pudo conectar) hacia direcciones distintas desde una misma máquina, en poco tiempo, es lo que deja un escaneo en busca de servidores SMB.

---

## Tabla resumen de eventos SMB

| Log | Event ID | Máquina | Descripción | Relevancia |
|-----|:--------:|:-------:|-------------|-----------|
| SMBServer/Security | 1009 | Destino | Acceso anónimo denegado | Alta — detecta enumeración |
| SMBServer/Security | 551 | Destino | Fallo de autenticación | Alta — fuerza bruta SMB |
| SMBClient/Security | 31001 | Origen | Fallo de autenticación contra un servidor | Alta — nombra el destino desde el lado origen |
| SMBClient/Connectivity | 30803 | Origen | No se pudo abrir la conexión de red | Media — muchos seguidos delatan un escaneo |
| SMBClient/Connectivity | 30804 | Origen | Conexión de red cortada | Baja — nombra el servidor |
| SMBClient/Connectivity | 30805 | Origen | Sesión con el servidor perdida | Baja — nombra el servidor |
| SMBClient/Connectivity | 30806 | Origen | Sesión con el servidor recuperada | Baja — nombra el servidor |
| SMBClient/Connectivity | 30807 | Origen | Conexión al recurso perdida | Alta — nombra el recurso que estaba abierto |
| SMBClient/Connectivity | 30808 | Origen | Conexión al recurso recuperada | Alta — nombra el recurso que estaba abierto |

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

En cada escenario, **origen** es la máquina desde la que actúa el atacante y **destino** la que recibe la conexión. Los eventos de cada lado están en ficheros distintos, de máquinas distintas.

### PsExec

1. **Destino:** 4624 tipo 3 en Security.evtx (logon de red)
2. **Destino:** 7045 en System.evtx (instalación del servicio PSEXESVC)
3. **Destino:** 1009 solo si antes hubo una sonda sin credenciales (acceso anónimo denegado)
4. **Origen:** si todo fue bien, los logs de SMBClient no apuntan nada. Puede quedar un 30807 más tarde, al perderse la conexión a `ADMIN$`

### Prueba de credenciales (CrackMapExec, Impacket)

1. **Origen:** 31001 por cada intento fallido, con el servidor y la cuenta
2. **Destino:** 551 por cada intento fallido, con la dirección del cliente
3. **Destino:** cuando una credencial acierta, 4624 tipo 3 con `LogonProcessName: NtLmSsp`
4. **Destino:** posible 7045 (servicio temporal), si después se ejecuta algo

### Escaneo y enumeración de shares

1. **Origen:** muchos 30803 hacia direcciones distintas (máquinas que no responden por SMB)
2. **Origen:** muchos 31001 contra servidores distintos (los que responden y rechazan la credencial)
3. **Destino:** muchos 1009 desde la misma dirección de origen

---

## Cómo masstin parsea los logs SMB

[Masstin](/es/tools/masstin-lateral-movement-rust/) extrae los eventos de SMBServer y SMBClient automáticamente y los pone en la timeline CSV, con la dirección de origen, el servidor, el recurso cuando lo hay y la cuenta. 1009, 551 y 31001 acaban como `FAILED_LOGON`, y los eventos 30803-30808 como `CONNECT`: no son inicios de sesión, pero dicen que esa máquina hablaba con ese servidor.

```bash
masstin -a parse -d /evidence/logs/ -o timeline.csv
```

Combinados con los eventos de Security.evtx y Terminal Services, los eventos SMB completan la visión del movimiento lateral por red, cubriendo los tres vectores principales: RDP, SMB y autenticación.

---

## Conclusión

Los logs de SMBServer y SMBClient son una fuente de evidencia forense que muchos analistas pasan por alto, centrándose únicamente en Security.evtx. Sin embargo, estos logs proporcionan detalles a nivel de protocolo que pueden revelar enumeración, fuerza bruta y acceso a shares que de otra forma quedarían ocultos.

Para integrar estos artefactos en tu análisis de movimiento lateral de forma automática, [masstin](/es/tools/masstin-lateral-movement-rust/) es la herramienta indicada.
