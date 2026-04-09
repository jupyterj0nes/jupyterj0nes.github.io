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

Los agentes de Cortex XDR registran las conexiones de red establecidas por los procesos de cada endpoint. Para movimiento lateral, los puertos más relevantes son:

| Puerto | Protocolo | Relevancia |
|:------:|-----------|-----------|
| 3389 | RDP | Sesiones de escritorio remoto |
| 445 | SMB | Acceso a shares, PsExec, WMI |
| 22 | SSH | Acceso remoto a servidores |

Masstin consulta la API de Cortex XDR para obtener datos de conexiones de red en estos puertos, extrayendo información sobre qué máquinas se conectaron entre sí, cuándo y a través de qué protocolos.

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

Los agentes de recolección forense son especialmente útiles cuando:

- No tienes acceso directo a las máquinas comprometidas
- Necesitas recopilar evidencia de múltiples endpoints de forma centralizada
- Los logs locales pueden haber sido manipulados y necesitas una copia en la nube
- La organización ya tiene Cortex XDR desplegado y no quiere instalar herramientas adicionales

### Qué logs recopilan

Los agentes de recolección forense capturan los Windows Event Logs de los endpoints, incluyendo los logs más relevantes para movimiento lateral:

- **Security.evtx** -- logons, autenticaciones, Kerberos, NTLM
- **TerminalServices-LocalSessionManager** -- sesiones RDP
- **SMBServer/Security** y **SMBClient/Security** -- conexiones SMB
- **System.evtx** -- instalación de servicios remotos

Una vez recopilados, estos logs quedan disponibles en la plataforma de Cortex XDR y pueden ser consultados.

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
| **Fuente de datos** | Eventos de red capturados por agentes Cortex | Logs EVTX recopilados por agentes forenses |
| **Qué aporta** | Conexiones por proceso a puertos clave | Eventos completos de Windows Event Logs |
| **Puertos/Event IDs** | 3389, 445, 22 | 4624, 4625, 4648, 21, 22, 7045, etc. |
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
