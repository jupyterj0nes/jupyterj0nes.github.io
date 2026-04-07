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

Palo Alto Cortex XDR es una plataforma EDR/XDR que proporciona visibilidad sobre la actividad de los endpoints. Para el analisis de movimiento lateral, Cortex XDR ofrece dos fuentes de datos complementarias que [masstin](/es/tools/masstin-lateral-movement-rust/) puede aprovechar:

1. **Modo de conexiones de red:** datos de conexiones de red capturados por los agentes de Cortex XDR en cada endpoint.
2. **Modo EVTX Forensics:** logs de eventos de Windows recopilados por agentes de recoleccion forense desplegados en los endpoints.

---

## Modo 1: Conexiones de red

### Que captura

Los agentes de Cortex XDR registran las conexiones de red establecidas por los procesos de cada endpoint. Para movimiento lateral, los puertos mas relevantes son:

| Puerto | Protocolo | Relevancia |
|:------:|-----------|-----------|
| 3389 | RDP | Sesiones de escritorio remoto |
| 445 | SMB | Acceso a shares, PsExec, WMI |
| 22 | SSH | Acceso remoto a servidores |

Masstin consulta la API de Cortex XDR para obtener datos de conexiones de red en estos puertos, extrayendo informacion sobre que maquinas se conectaron entre si, cuando y a traves de que protocolos.

### Que informacion se obtiene

Los eventos de red de Cortex XDR proporcionan la perspectiva del **endpoint**, complementando los logs de red (firewalls, proxies) y los EVTX. Incluyen datos como:

- Timestamp de la conexion
- IP y puerto de origen y destino
- Proceso que establecio la conexion
- Usuario bajo el que se ejecuta el proceso
- Direccion de la conexion (entrante o saliente)

> **Valor forense:** Los eventos de red de Cortex XDR te muestran no solo que hubo una conexion en un puerto de movimiento lateral, sino **que proceso** la inicio. Esto permite distinguir entre una conexion RDP legitima via `mstsc.exe` y una conexion sospechosa desde un proceso inesperado.

### Como masstin obtiene estos datos

```bash
masstin -a parse-cortex --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-network.csv
```

Masstin consulta la API de Cortex XDR directamente, filtra las conexiones a puertos relevantes para movimiento lateral y genera la timeline CSV en el mismo formato normalizado que el resto de artefactos.

---

## Modo 2: EVTX Forensics (Recoleccion forense)

### Que son los agentes de recoleccion forense de Cortex XDR

Cortex XDR permite desplegar **agentes de recoleccion forense** en los endpoints durante una investigacion. Estos son agentes ligeros que se instalan temporalmente en las maquinas objetivo para recopilar artefactos forenses -- incluyendo archivos de Windows Event Logs (EVTX) -- y enviarlos a la nube de Cortex XDR para su analisis.

Los agentes de recoleccion forense son especialmente utiles cuando:

- No tienes acceso directo a las maquinas comprometidas
- Necesitas recopilar evidencia de multiples endpoints de forma centralizada
- Los logs locales pueden haber sido manipulados y necesitas una copia en la nube
- La organizacion ya tiene Cortex XDR desplegado y no quiere instalar herramientas adicionales

### Que logs recopilan

Los agentes de recoleccion forense capturan los Windows Event Logs de los endpoints, incluyendo los logs mas relevantes para movimiento lateral:

- **Security.evtx** -- logons, autenticaciones, Kerberos, NTLM
- **TerminalServices-LocalSessionManager** -- sesiones RDP
- **SMBServer/Security** y **SMBClient/Security** -- conexiones SMB
- **System.evtx** -- instalacion de servicios remotos

Una vez recopilados, estos logs quedan disponibles en la plataforma de Cortex XDR y pueden ser consultados.

### Como masstin obtiene estos datos

```bash
masstin -a parse-cortex-evtx-forensics --cortex-url api-xxxx.xdr.xx.paloaltonetworks.com \
  --start-time "2024-08-12 00:00:00" --end-time "2024-08-14 00:00:00" \
  -o cortex-evtx.csv
```

Masstin consulta los logs recopilados por los agentes forenses y extrae los eventos de movimiento lateral, generandolos en el mismo formato CSV normalizado.

> **Ventaja practica:** En lugar de tener que acceder fisicamente a cada maquina o desplegar herramientas de triage como KAPE, puedes aprovechar la infraestructura de Cortex XDR existente para recopilar los EVTX de forma remota y centralizada, y luego analizarlos con masstin.

---

## Comparacion de modos

| Aspecto | Conexiones de red | EVTX Forensics |
|---------|------------------|----------------|
| **Fuente de datos** | Eventos de red capturados por agentes Cortex | Logs EVTX recopilados por agentes forenses |
| **Que aporta** | Conexiones por proceso a puertos clave | Eventos completos de Windows Event Logs |
| **Puertos/Event IDs** | 3389, 445, 22 | 4624, 4625, 4648, 21, 22, 7045, etc. |
| **Accion masstin** | `parse-cortex` | `parse-cortex-evtx-forensics` |
| **Cuando usarlo** | Complementar EVTX con datos de red del endpoint | Cuando no tienes acceso directo a los EVTX |

---

## Flujo de trabajo integrado

El flujo de trabajo recomendado cuando tienes Cortex XDR disponible:

| Paso | Accion | Fuente |
|:----:|--------|--------|
| 1 | Desplegar agentes de recoleccion forense en endpoints clave | Cortex XDR |
| 2 | Obtener conexiones de red via API | `parse-cortex` |
| 3 | Obtener EVTX forenses recopilados | `parse-cortex-evtx-forensics` |
| 4 | Complementar con EVTX nativos si estan disponibles | `parse` |
| 5 | Unificar todo en una sola timeline | `merge` |
| 6 | Visualizar en Neo4j | `load` |

Los datos de ambos modos de Cortex XDR se integran en la timeline con los mismos campos normalizados que los EVTX nativos, permitiendo correlacionar una conexion de red vista por Cortex con un logon registrado en Security.evtx.

---

## Conclusion

Cortex XDR proporciona dos fuentes complementarias de datos forenses para movimiento lateral. Las conexiones de red te dan la perspectiva de que procesos estan comunicandose por puertos sospechosos, mientras que la recoleccion forense de EVTX te da acceso a los Windows Event Logs completos sin necesidad de acceder fisicamente a cada maquina.

[Masstin](/es/tools/masstin-lateral-movement-rust/) integra ambas fuentes en una sola timeline, permitiendo combinarlas con EVTX nativos, datos de Winlogbeat y logs de Linux para obtener una vision completa del movimiento lateral.
