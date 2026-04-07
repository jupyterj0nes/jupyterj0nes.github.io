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

## Mas alla del EVTX nativo: logs reenviados al SIEM

En un entorno empresarial real, los artefactos forenses no siempre estan disponibles en su formato nativo. Los Windows Event Logs se reenvian a SIEMs mediante agentes como **Winlogbeat**, transformandolos a formato JSON. Para un analista forense, saber parsear estos formatos es tan importante como conocer los Event IDs nativos.

De nada sirve saber que el 4624 indica un logon si no puedes extraerlo de un JSON de Winlogbeat cuando los EVTX originales ya no estan disponibles.

[Masstin](/es/tools/masstin-lateral-movement-rust/) soporta Winlogbeat JSON como fuente de entrada, permitiendo integrar logs reenviados en la misma timeline de movimiento lateral.

---

## Que es Winlogbeat

Winlogbeat es un agente ligero de Elastic que reenvia Windows Event Logs a Elasticsearch, Logstash u otros destinos. Convierte cada evento EVTX a un documento JSON estructurado, manteniendo todos los campos del evento original pero reorganizandolos en la jerarquia de campos del Elastic Common Schema (ECS).

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
| `winlog.computer_name` | Computer | Maquina destino |
| `winlog.event_data.AuthenticationPackageName` | AuthenticationPackageName | NTLM vs Kerberos |
| `winlog.event_data.WorkstationName` | WorkstationName | Nombre de maquina origen (NTLM) |
| `@timestamp` | TimeCreated | Timestamp del evento |

---

## Como masstin parsea Winlogbeat

Masstin reconoce automaticamente los archivos JSON de Winlogbeat y extrae los campos relevantes para movimiento lateral. El formato JSON puede venir en dos variantes:

1. **NDJSON (Newline Delimited JSON):** Un documento JSON por linea, tipico de exportaciones de Elasticsearch.
2. **JSON array:** Un array de documentos, menos comun pero soportado.

```bash
masstin -a parser-elastic -d /ruta/con/winlogbeat/ -o timeline.csv
```

Masstin mapea los campos ECS/Winlogbeat a su formato normalizado interno, por lo que los eventos de Winlogbeat aparecen en la timeline con la misma estructura que los parseados directamente desde EVTX.

> **Ventaja practica:** Cuando no tienes acceso a los EVTX originales (rotados, eliminados o inaccesibles), los datos reenviados por Winlogbeat a Elasticsearch pueden ser tu unica fuente de eventos. Masstin te permite trabajar con ellos directamente.

---

## Escenarios comunes con Winlogbeat

| Escenario | Que hacer |
|-----------|----------|
| EVTX originales disponibles | Parsear directamente con masstin -- mas eficiente |
| Solo datos en Elasticsearch | Exportar como NDJSON y parsear con masstin |
| EVTX parcialmente rotados | Combinar EVTX disponibles + export de Winlogbeat para completar gaps |
| Investigacion retroactiva | Los datos de Winlogbeat en el SIEM pueden cubrir meses de retencion |

---

## Tabla resumen

| Fuente | Formato | Que aporta | Limitaciones |
|--------|---------|-----------|-------------|
| EVTX nativo | Binario (.evtx) | Datos completos, todos los campos | Requiere acceso a la maquina, rotacion de logs |
| Winlogbeat | JSON (NDJSON) | Retencion extendida en SIEM | Puede faltar contexto si no se reenvian todos los campos |

---

## Conclusion

En una investigacion real, raramente tienes la suerte de tener todos los EVTX originales de todas las maquinas. Los logs reenviados por Winlogbeat pueden ser la diferencia entre tener visibilidad o tener puntos ciegos.

[Masstin](/es/tools/masstin-lateral-movement-rust/) esta disenado para trabajar con esta realidad, aceptando exportaciones JSON de Winlogbeat y unificandolas en la misma timeline de movimiento lateral que los EVTX nativos.
