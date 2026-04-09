---
layout: post
title: "Winlogbeat: Artefactos forenses de movimiento lateral en formato JSON"
date: 2026-04-07 12:00:00 +0100
category: artifacts
lang: es
ref: artifact-winlogbeat
tags: [winlogbeat, lateral-movement, dfir, masstin, siem, elastic, json]
description: "Como aprovechar los logs de Winlogbeat en formato JSON para detectar movimiento lateral, y como masstin parsea estos artefactos."
comments: true
---

## Más allá del EVTX nativo: logs reenviados al SIEM

En un entorno empresarial real, los artefactos forenses no siempre están disponibles en su formato nativo. Los Windows Event Logs se reenvían a SIEMs mediante agentes como **Winlogbeat**, transformándolos a formato JSON. Para un analista forense, saber parsear estos formatos es tan importante como conocer los Event IDs nativos.

De nada sirve saber que el 4624 indica un logon si no puedes extraerlo de un JSON de Winlogbeat cuando los EVTX originales ya no están disponibles.

[Masstin](/es/tools/masstin-lateral-movement-rust/) soporta Winlogbeat JSON como fuente de entrada, permitiendo integrar logs reenviados en la misma timeline de movimiento lateral.

---

## ¿Qué es Winlogbeat?

Winlogbeat es un agente ligero de Elastic que reenvía Windows Event Logs a Elasticsearch, Logstash u otros destinos. Convierte cada evento EVTX a un documento JSON estructurado, manteniendo todos los campos del evento original pero reorganizándolos en la jerarquía de campos del Elastic Common Schema (ECS).

---

## Estructura del JSON de Winlogbeat

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

---

## Campos clave para movimiento lateral

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

---

## Cómo masstin parsea Winlogbeat

Masstin reconoce automáticamente los archivos JSON de Winlogbeat y extrae los campos relevantes para movimiento lateral. El formato JSON puede venir en dos variantes:

1. **NDJSON (Newline Delimited JSON):** Un documento JSON por línea, típico de exportaciones de Elasticsearch.
2. **JSON array:** Un array de documentos, menos común pero soportado.

```bash
masstin -a parser-elastic -d /ruta/con/winlogbeat/ -o timeline.csv
```

Masstin mapea los campos ECS/Winlogbeat a su formato normalizado interno, por lo que los eventos de Winlogbeat aparecen en la timeline con la misma estructura que los parseados directamente desde EVTX.

> **Ventaja práctica:** Cuando no tienes acceso a los EVTX originales (rotados, eliminados o inaccesibles), los datos reenviados por Winlogbeat a Elasticsearch pueden ser tu única fuente de eventos. Masstin te permite trabajar con ellos directamente.

---

## Escenarios comunes con Winlogbeat

| Escenario | Qué hacer |
|-----------|----------|
| EVTX originales disponibles | Parsear directamente con masstin -- más eficiente |
| Solo datos en Elasticsearch | Exportar como NDJSON y parsear con masstin |
| EVTX parcialmente rotados | Combinar EVTX disponibles + export de Winlogbeat para completar gaps |
| Investigación retroactiva | Los datos de Winlogbeat en el SIEM pueden cubrir meses de retención |

---

## Tabla resumen

| Fuente | Formato | Qué aporta | Limitaciones |
|--------|---------|-----------|-------------|
| EVTX nativo | Binario (.evtx) | Datos completos, todos los campos | Requiere acceso a la máquina, rotación de logs |
| Winlogbeat | JSON (NDJSON) | Retención extendida en SIEM | Puede faltar contexto si no se reenvían todos los campos |

---

## Conclusión

En una investigación real, raramente tienes la suerte de tener todos los EVTX originales de todas las máquinas. Los logs reenviados por Winlogbeat pueden ser la diferencia entre tener visibilidad o tener puntos ciegos.

[Masstin](/es/tools/masstin-lateral-movement-rust/) está diseñado para trabajar con esta realidad, aceptando exportaciones JSON de Winlogbeat y unificándolas en la misma timeline de movimiento lateral que los EVTX nativos.
