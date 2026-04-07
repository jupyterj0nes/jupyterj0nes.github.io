---
layout: post
title: "Winlogbeat y Cortex XDR: Artefactos forenses de movimiento lateral"
date: 2026-04-07 12:00:00 +0100
category: artifacts
lang: es
ref: artifact-winlogbeat-cortex
tags: [winlogbeat, cortex-xdr, lateral-movement, dfir, masstin, siem, xql, json]
description: "Cómo aprovechar los logs de Winlogbeat en formato JSON y los eventos de red y EVTX de Cortex XDR para detectar movimiento lateral, y cómo masstin parsea estos artefactos."
comments: true
---

## Más allá del EVTX nativo: logs reenviados y EDR

En un entorno empresarial real, los artefactos forenses no siempre están disponibles en su formato nativo. Los Windows Event Logs se reenvían a SIEMs mediante agentes como **Winlogbeat**, transformándolos a formato JSON. Las plataformas EDR como **Cortex XDR** capturan sus propios eventos de red y pueden exportar datos forenses en formatos propietarios.

Para un analista forense, saber parsear estos formatos es tan importante como conocer los Event IDs nativos. De nada sirve saber que el 4624 indica un logon si no puedes extraerlo de un JSON de Winlogbeat o de una consulta XQL de Cortex XDR.

[Masstin](/es/tools/masstin-lateral-movement-rust/) soporta ambos formatos, permitiendo integrar logs reenviados y datos de EDR en la misma timeline de movimiento lateral.

---

## Winlogbeat: EVTX en formato JSON

### Qué es Winlogbeat

Winlogbeat es un agente ligero de Elastic que reenvía Windows Event Logs a Elasticsearch, Logstash u otros destinos. Convierte cada evento EVTX a un documento JSON estructurado, manteniendo todos los campos del evento original pero reorganizándolos en la jerarquía de campos del Elastic Common Schema (ECS).

### Estructura del JSON de Winlogbeat

Un evento 4624 de Security.evtx en formato Winlogbeat tiene esta estructura:

```json
{
  "@timestamp": "2026-04-07T14:23:01.000Z",
  "event": {
    "code": "4624",
    "provider": "Microsoft-Windows-Security-Auditing",
    "action": "logged-in"
  },
  "winlog": {
    "event_id": 4624,
    "channel": "Security",
    "computer_name": "SERVER01.domain.com",
    "event_data": {
      "TargetUserName": "admin",
      "TargetDomainName": "DOMAIN",
      "LogonType": "3",
      "IpAddress": "10.0.1.50",
      "IpPort": "52341",
      "LogonProcessName": "NtLmSsp",
      "AuthenticationPackageName": "NTLM",
      "WorkstationName": "WKS01"
    }
  },
  "host": {
    "name": "SERVER01"
  },
  "source": {
    "ip": "10.0.1.50",
    "port": 52341
  },
  "user": {
    "name": "admin",
    "domain": "DOMAIN"
  }
}
```

### Campos clave para movimiento lateral

| Campo Winlogbeat | Campo EVTX original | Uso forense |
|-----------------|---------------------|------------|
| `winlog.event_id` | Event ID | Identificar el tipo de evento |
| `winlog.event_data.TargetUserName` | TargetUserName | Cuenta autenticada |
| `winlog.event_data.LogonType` | LogonType | Tipo 3 (red), tipo 10 (RDP) |
| `winlog.event_data.IpAddress` | IpAddress | IP de origen |
| `winlog.computer_name` | Computer | Máquina destino |
| `winlog.event_data.AuthenticationPackageName` | AuthenticationPackageName | NTLM vs Kerberos |
| `winlog.event_data.WorkstationName` | WorkstationName | Nombre de máquina origen (NTLM) |
| `@timestamp` | TimeCreated | Timestamp del evento |

### Cómo masstin parsea Winlogbeat

Masstin reconoce automáticamente los archivos JSON de Winlogbeat y extrae los campos relevantes para movimiento lateral. El formato JSON puede venir en dos variantes:

1. **NDJSON (Newline Delimited JSON):** Un documento JSON por línea, típico de exportaciones de Elasticsearch.
2. **JSON array:** Un array de documentos, menos común pero soportado.

```bash
masstin parse -i /ruta/con/winlogbeat/*.json -o timeline.csv
```

Masstin mapea los campos ECS/Winlogbeat a su formato normalizado interno, por lo que los eventos de Winlogbeat aparecen en la timeline con la misma estructura que los parseados directamente desde EVTX.

> **Ventaja práctica:** Cuando no tienes acceso a los EVTX originales (rotados, eliminados o inaccesibles), los datos reenviados por Winlogbeat a Elasticsearch pueden ser tu única fuente de eventos. Masstin te permite trabajar con ellos directamente.

### Escenarios comunes con Winlogbeat

| Escenario | Qué hacer |
|-----------|----------|
| EVTX originales disponibles | Parsear directamente con masstin — más eficiente |
| Solo datos en Elasticsearch | Exportar como NDJSON y parsear con masstin |
| EVTX parcialmente rotados | Combinar EVTX disponibles + export de Winlogbeat para completar gaps |
| Investigación retroactiva | Los datos de Winlogbeat en el SIEM pueden cubrir meses de retención |

---

## Cortex XDR: Eventos de red

### Qué captura Cortex XDR

Palo Alto Cortex XDR es una plataforma EDR/XDR que, entre otras capacidades, registra **eventos de red** de cada endpoint donde tiene un agente instalado. Estos eventos incluyen conexiones entrantes y salientes con detalles de IP, puerto, proceso y usuario.

Para movimiento lateral, los puertos más relevantes son:

| Puerto | Protocolo | Relevancia |
|:------:|-----------|-----------|
| 3389 | RDP | Sesiones de escritorio remoto |
| 445 | SMB | Acceso a shares, PsExec, WMI |
| 22 | SSH | Acceso remoto a servidores Linux |
| 5985/5986 | WinRM | Ejecución remota vía PowerShell |
| 135 | RPC/DCOM | WMI remoto, DCOM lateral |

### Eventos de red de Cortex XDR

Los eventos de red de Cortex XDR registran cada conexión de red establecida por los procesos del endpoint:

| Campo | Descripción |
|-------|------------|
| Timestamp | Momento de la conexión |
| Source IP | IP del equipo que inicia la conexión |
| Source Port | Puerto efímero del equipo origen |
| Destination IP | IP del equipo destino |
| Destination Port | Puerto del servicio (3389, 445, 22, etc.) |
| Process Name | Proceso que estableció la conexión (ej: `mstsc.exe`, `svchost.exe`) |
| User | Usuario bajo el que se ejecuta el proceso |
| Action | Conexión establecida, bloqueada, etc. |
| Direction | Entrante o saliente |

> **Valor forense:** Los eventos de red de Cortex XDR proporcionan la perspectiva del **endpoint**, complementando los logs de red (firewalls, proxies) y los EVTX. Te muestran no solo que hubo una conexión, sino **qué proceso** la inició.

### Filtrado por puertos de movimiento lateral

Para extraer solo las conexiones relevantes para movimiento lateral:

```
# Conexiones RDP salientes
destination_port = 3389 AND direction = "outbound"

# Conexiones SMB salientes
destination_port = 445 AND direction = "outbound"

# Conexiones SSH salientes
destination_port = 22 AND direction = "outbound"
```

### Cómo masstin parsea eventos de red de Cortex XDR

Masstin acepta exportaciones de eventos de red de Cortex XDR y filtra automáticamente las conexiones a puertos relevantes para movimiento lateral:

```bash
masstin parse -i /ruta/cortex_network_events.csv -o timeline.csv
```

Los eventos se integran en la timeline con los mismos campos normalizados, permitiendo correlacionar una conexión de red vista por Cortex XDR con un logon registrado en Security.evtx o un evento de sesión en Terminal Services.

---

## Cortex XDR: EVTX Forensics vía XQL

### Qué es XQL

XQL (XDR Query Language) es el lenguaje de consultas de Cortex XDR. Permite buscar eventos almacenados en la plataforma, incluyendo eventos de Windows forwarded por el agente de Cortex.

### Consultas XQL para movimiento lateral

#### Logons de red exitosos (4624 tipo 3)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 4624
  AND action_evtlog_data_fields->LogonType = "3"
| fields _time, agent_hostname, action_evtlog_data_fields->TargetUserName,
         action_evtlog_data_fields->IpAddress,
         action_evtlog_data_fields->AuthenticationPackageName
| sort asc _time
```

#### Logons RDP (4624 tipo 10)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 4624
  AND action_evtlog_data_fields->LogonType = "10"
| fields _time, agent_hostname, action_evtlog_data_fields->TargetUserName,
         action_evtlog_data_fields->IpAddress
| sort asc _time
```

#### Sesiones RDP (Terminal Services)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id in (21, 22, 24, 25)
  AND action_evtlog_provider_name = "Microsoft-Windows-TerminalServices-LocalSessionManager"
| fields _time, agent_hostname, action_evtlog_data_fields->User,
         action_evtlog_data_fields->Address,
         action_evtlog_event_id
| sort asc _time
```

#### Instalación de servicios remotos (7045)

```sql
dataset = xdr_data
| filter event_type = EVENT_LOG
  AND action_evtlog_event_id = 7045
| fields _time, agent_hostname, action_evtlog_data_fields->ServiceName,
         action_evtlog_data_fields->ImagePath,
         action_evtlog_data_fields->AccountName
| sort asc _time
```

#### Conexiones de red a puertos de movimiento lateral

```sql
dataset = xdr_data
| filter event_type = NETWORK
  AND action_remote_port in (3389, 445, 22, 5985)
  AND action_network_connection_type = "outgoing"
| fields _time, agent_hostname, action_remote_ip, action_remote_port,
         actor_process_image_name, actor_effective_username
| sort asc _time
```

### Exportación para masstin

Los resultados de las consultas XQL se pueden exportar como CSV o JSON desde la interfaz de Cortex XDR. Estos exports son directamente parseables por masstin:

```bash
# Exportar resultados XQL como CSV desde Cortex XDR UI
# Luego parsear con masstin
masstin parse -i /ruta/cortex_xql_export.csv -o timeline.csv
```

---

## Flujo de trabajo integrado

El flujo de trabajo recomendado cuando tienes datos de múltiples fuentes:

| Paso | Acción | Fuente |
|:----:|--------|--------|
| 1 | Recopilar EVTX nativos de máquinas con KAPE o similar | EVTX directos |
| 2 | Exportar datos de Winlogbeat desde Elasticsearch | NDJSON |
| 3 | Exportar eventos de red de Cortex XDR | CSV |
| 4 | Ejecutar consultas XQL para EVTX forwarded | CSV export |
| 5 | Parsear todo junto con masstin | Timeline unificada |
| 6 | Ingestar en Neo4j para visualización de grafos | Relaciones de movimiento |

```bash
# Todo en un solo comando
masstin parse -i /ruta/con/todos/los/artefactos/ -o timeline_completa.csv
```

Masstin detecta automáticamente el formato de cada archivo (EVTX nativo, Winlogbeat JSON, Cortex CSV) y los procesa de forma unificada.

---

## Tabla resumen

| Fuente | Formato | Qué aporta | Limitaciones |
|--------|---------|-----------|-------------|
| EVTX nativo | Binario (.evtx) | Datos completos, todos los campos | Requiere acceso a la máquina, rotación de logs |
| Winlogbeat | JSON (NDJSON) | Retención extendida en SIEM | Puede faltar contexto si no se reenvían todos los campos |
| Cortex XDR (red) | CSV | Conexiones de red por proceso | Solo endpoints con agente instalado |
| Cortex XDR (XQL) | CSV/JSON | EVTX forwarded vía el agente | Depende de la configuración de forwarding |

---

## Conclusión

En una investigación real, raramente tienes la suerte de tener todos los EVTX originales de todas las máquinas. Los logs reenviados por Winlogbeat y los datos de Cortex XDR pueden ser la diferencia entre tener visibilidad o tener puntos ciegos.

[Masstin](/es/tools/masstin-lateral-movement-rust/) está diseñado para trabajar con esta realidad, aceptando múltiples formatos de entrada y unificándolos en una sola timeline de movimiento lateral. Ya sea que tus datos vengan de EVTX nativos, exports de Elasticsearch o consultas XQL de Cortex XDR, masstin los procesa y los correlaciona en segundos.
