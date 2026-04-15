---
layout: post
title: "Cortex XDR: Artefactos forenses de movimiento lateral"
date: 2026-04-07 13:00:00 +0100
category: artifacts
lang: es
ref: artifact-cortex-xdr
tags: [cortex-xdr, lateral-movement, dfir, masstin, edr, palo-alto]
description: "Como masstin aprovecha Cortex XDR en dos modos -- conexiones de red y recoleccion forense de EVTX -- para detectar movimiento lateral."
comments: true
---

## Cortex XDR como fuente forense

Palo Alto Cortex XDR es una plataforma EDR/XDR que proporciona visibilidad sobre la actividad de los endpoints. Para el análisis de movimiento lateral, Cortex XDR ofrece dos fuentes de datos complementarias que [masstin](/es/tools/masstin-lateral-movement-rust/) puede aprovechar:

1. **Modo de conexiones de red:** datos de conexiones de red capturados por los agentes de Cortex XDR en cada endpoint.
2. **Modo EVTX Forensics:** logs de eventos de Windows recopilados por agentes de recolección forense desplegados en los endpoints.

---

## Modo 1: Conexiones de red

### Qué captura

Los agentes de Cortex XDR registran las conexiones de red establecidas por los procesos de cada endpoint. Para movimiento lateral, el set de puertos admin que masstin consulta por defecto es:

| Puerto | Protocolo | Relevancia |
|:------:|-----------|-----------|
| 22   | SSH | Acceso remoto a servidores |
| 445  | SMB | Acceso a shares, PsExec |
| 3389 | RDP | Sesiones de escritorio remoto |
| 5985 | WinRM (HTTP)  | PowerShell Remoting |
| 5986 | WinRM (HTTPS) | PowerShell Remoting |

`--admin-ports` amplía el set para incluir 135 (RPC), 139 (NetBIOS), 1433 (MSSQL), 3306 (MySQL) y 5900 (VNC) y tener visibilidad de más rutas de pivoting. `--ignore-local` empuja el filtrado de loopback/link-local/conexiones al mismo host al lado servidor para no traer datos irrelevantes, y sobre ventanas amplias `--start-time`/`--end-time` hacen auto-paginación por bisección temporal si una ventana individual satura el cap de 1M de la API.

### Qué información se obtiene

Los eventos de red de Cortex XDR proporcionan la perspectiva del **endpoint**, complementando los logs de red (firewalls, proxies) y los EVTX. Incluyen datos como:

- Timestamp de la conexión
- IP y puerto de origen y destino
- Proceso que estableció la conexión
- Usuario bajo el que se ejecuta el proceso
- Dirección de la conexión (entrante o saliente)

> **Valor forense:** Los eventos de red de Cortex XDR te muestran no solo que hubo una conexión en un puerto de movimiento lateral, sino **qué proceso** la inició. Esto permite distinguir entre una conexión RDP legítima vía `mstsc.exe` y una conexión sospechosa desde un proceso inesperado.

### Cómo masstin obtiene estos datos

```bash
masstin -a parse-cortex --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-network.csv
```

Masstin consulta la API de Cortex XDR directamente, filtra las conexiones a puertos relevantes para movimiento lateral y genera la timeline CSV en el mismo formato normalizado que el resto de artefactos.

---

## Modo 2: EVTX Forensics (Recolección forense)

### Qué son los agentes de recolección forense de Cortex XDR

Cortex XDR permite desplegar **agentes de recolección forense** en los endpoints durante una investigación. Estos son agentes ligeros que se instalan temporalmente en las máquinas objetivo para recopilar artefactos forenses -- incluyendo archivos de Windows Event Logs (EVTX) -- y enviarlos a la nube de Cortex XDR para su análisis.

El mismo dataset de backend (`forensics_event_log`) también recibe logs subidos por el **offline collector de Cortex XDR**, así que los triages recogidos de equipos aislados o no accesibles por red y empujados al tenant se consultan por la misma ruta exacta que los recolectados remotamente por el agente forense.

Los agentes de recolección forense son especialmente útiles cuando:

- No tienes acceso directo a las máquinas comprometidas
- Necesitas recopilar evidencia de múltiples endpoints de forma centralizada
- Los logs locales pueden haber sido manipulados y necesitas una copia en la nube
- La organización ya tiene Cortex XDR desplegado y no quiere instalar herramientas adicionales

### Qué logs recopilan

La query de masstin cubre todo el set de eventos de movimiento lateral de `parse-windows`, repartido en diez proveedores de Windows Event Log:

- **Security** -- logons (4624/4625/4648), logoffs (4634/4647), Kerberos (4768/4769/4770/4771), NTLM (4776), session reconnect/disconnect (4778/4779), acceso a shares (5140)
- **TerminalServices-LocalSessionManager/Operational** -- ciclo de vida de sesiones RDP (21, 22, 24, 25)
- **TerminalServices-RemoteConnectionManager/Operational** -- conexiones RDP entrantes (1149)
- **TerminalServices-RDPClient/Operational** -- RDP saliente (1024, 1102)
- **RemoteDesktopServices-RdpCoreTS/Operational** -- transporte RDP (131)
- **SMBServer/Security** -- logons SMB lado servidor (1009, 551)
- **SmbClient/Security** y **SMBClient/Connectivity** -- SMB cliente (31001, 30803-30808)
- **WinRM/Operational** -- inicio de sesión PowerShell Remoting (6)
- **WMI-Activity/Operational** -- WMI remoto (5858)

La extracción por regex sobre el campo `message` localizado incluye variantes en inglés, español, alemán, francés e italiano, y hace auto-paginación por bisección temporal si una ventana individual satura el cap de 1M de la API.

### Cómo masstin obtiene estos datos

```bash
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-evtx.csv
```

Masstin consulta los logs recopilados por los agentes forenses y extrae los eventos de movimiento lateral, generándolos en el mismo formato CSV normalizado.

> **Ventaja práctica:** En lugar de tener que acceder físicamente a cada máquina o desplegar herramientas de triage como KAPE, puedes aprovechar la infraestructura de Cortex XDR existente para recopilar los EVTX de forma remota y centralizada, y luego analizarlos con masstin.

---

## Comparación de modos

| Aspecto | Conexiones de red | EVTX Forensics |
|---------|------------------|----------------|
| **Fuente de datos** | Eventos de red capturados por agentes Cortex | Logs EVTX recopilados por el agente forense o subidos por el offline collector |
| **Qué aporta** | Conexiones por proceso a puertos admin | Eventos completos de Windows Event Logs |
| **Puertos/Event IDs** | 22, 445, 3389, 5985, 5986 por defecto; `--admin-ports` añade 135, 139, 1433, 3306, 5900 | 32 event IDs repartidos en 10 proveedores (Security, TS-LSM/RCM/RDPClient/RdpCoreTS, SMB Server/Client/Connectivity, WinRM, WMI-Activity) |
| **Acción masstin** | `parse-cortex` | `parse-cortex-evtx-forensics` |
| **Cuándo usarlo** | Complementar EVTX con datos de red del endpoint | Cuando no tienes acceso directo a los EVTX |

---

## Flujo de trabajo integrado

El flujo de trabajo recomendado cuando tienes Cortex XDR disponible:

| Paso | Acción | Fuente |
|:----:|--------|--------|
| 1 | Desplegar agentes de recolección forense en endpoints clave | Cortex XDR |
| 2 | Obtener conexiones de red vía API | `parse-cortex` |
| 3 | Obtener EVTX forenses recopilados | `parse-cortex-evtx-forensics` |
| 4 | Complementar con EVTX nativos si están disponibles | `parse` |
| 5 | Unificar todo en una sola timeline | `merge` |
| 6 | Visualizar en Neo4j | `load` |

Los datos de ambos modos de Cortex XDR se integran en la timeline con los mismos campos normalizados que los EVTX nativos, permitiendo correlacionar una conexión de red vista por Cortex con un logon registrado en Security.evtx.

---

## Conclusión

Cortex XDR proporciona dos fuentes complementarias de datos forenses para movimiento lateral. Las conexiones de red te dan la perspectiva de qué procesos están comunicándose por puertos sospechosos, mientras que la recolección forense de EVTX te da acceso a los Windows Event Logs completos sin necesidad de acceder físicamente a cada máquina.

[Masstin](/es/tools/masstin-lateral-movement-rust/) integra ambas fuentes en una sola timeline, permitiendo combinarlas con EVTX nativos, datos de Winlogbeat y logs de Linux para obtener una visión completa del movimiento lateral.
