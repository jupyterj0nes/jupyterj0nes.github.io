---
layout: post
title: "Masstin: Análisis de movimiento lateral a la velocidad de Rust"
date: 2026-04-06 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin
tags: [masstin, lateral-movement, rust, neo4j, evtx, herramientas]
description: "Masstin es una herramienta DFIR escrita en Rust que parsea más de 10 tipos de artefactos forenses y genera timelines unificadas de movimiento lateral, con integración directa en Neo4j."
comments: true
---

## El problema

Estás en medio de una respuesta ante incidentes. Tienes 50 máquinas comprometidas, cada una con sus logs de eventos rotados, el SIEM solo reenvió una fracción de los eventos, y necesitas reconstruir cómo se movió el atacante por la red. **Ahora.**

Las herramientas genéricas te dan demasiado ruido. Revisar EVTX a mano es inviable. Necesitas algo que extraiga *solo* el movimiento lateral de todos esos artefactos, los unifique en una timeline y te permita visualizar las relaciones entre máquinas.

Para eso existe **masstin**.

## ¿Qué es Masstin?

Masstin es una herramienta DFIR escrita en **Rust** que parsea más de 10 tipos de artefactos forenses y los fusiona en una **timeline cronológica unificada en CSV**, centrada exclusivamente en el movimiento lateral. Es la evolución de [sabonis](/es/tools/sabonis-pivoting-lateral-movement/), reescrita desde cero para conseguir un rendimiento ~90% superior.

- **Repositorio:** [github.com/jupyterj0nes/masstin](https://github.com/jupyterj0nes/masstin)
- **Licencia:** GPLv3
- **Plataformas:** Windows y Linux (binarios precompilados, sin dependencias)

## Artefactos soportados

Masstin parsea los siguientes tipos de Windows Event Logs (.evtx):

| Event Log | Event IDs relevantes | Qué detecta |
|-----------|---------------------|-------------|
| Security.evtx | 4624, 4625, 4648 | Logons, logons fallidos, logons explícitos |
| TerminalServices-LocalSessionManager | 21, 22, 23, 24, 25 | Sesiones RDP entrantes/salientes |
| SMBServer | Conexiones SMB | Acceso a shares de red |
| SMBClient | Conexiones SMB salientes | Movimiento lateral via SMB |
| System.evtx | 7045 | Instalación de servicios remotos |
| WinRM | Conexiones WinRM | Ejecución remota via PowerShell |
| PowerShell | Script blocks, módulos | Ejecución remota de scripts |

## Uso

### Parseo: generar la timeline CSV

```bash
# Parsear un directorio con artefactos de múltiples máquinas
masstin -a parse -d /evidence/machine1/logs -d /evidence/machine2/logs -o timeline.csv

# Parsear archivos EVTX individuales
masstin -a parse -f Security.evtx -f System.evtx -o timeline.csv

# Sobrescribir output existente
masstin -a parse -d /evidence/ -o timeline.csv --overwrite
```

### Carga en Neo4j: visualización en grafos

```bash
masstin -a load -f timeline.csv --database localhost:7687 --user neo4j
```

### Formato del CSV de salida

Cada fila del CSV contiene:

| Campo | Descripción |
|-------|-------------|
| `timestamp` | Marca temporal del evento |
| `dest_computer` | Máquina de destino |
| `event_id` | ID del evento de Windows |
| `username` | Usuario que realizó la acción |
| `domain` | Dominio del usuario |
| `logon_type` | Tipo de logon (3=red, 10=RDP, etc.) |
| `src_computer` | Máquina de origen |
| `src_ip` | IP de origen |
| `log_filename` | Archivo de log de origen |

## Características clave

### Resolución automática IP → Hostname

Masstin analiza la frecuencia de asociaciones IP-hostname en los propios logs para resolver automáticamente las IPs a nombres de máquina, sin necesidad de un DNS externo.

### Agrupación de conexiones

Para reducir el ruido en investigaciones con miles de eventos, masstin agrupa conexiones repetitivas entre las mismas máquinas, permitiéndote ver los patrones sin ahogarte en datos.

### Consultas Cypher pre-construidas

El repositorio incluye consultas Cypher listas para usar en Neo4j que permiten:

- Visualizar el grafo completo de movimiento lateral
- Identificar máquinas con más conexiones entrantes (posibles objetivos)
- Detectar patrones de movimiento anómalos
- Rastrear la progresión de un usuario/atacante concreto

## ¿Por qué Rust?

| Aspecto | Python (sabonis) | Rust (masstin) |
|---------|------------------|----------------|
| Rendimiento | Base | ~90% más rápido |
| Dependencias | Python + libs | Ninguna (binario estático) |
| Despliegue | Instalar Python + pip | Copiar binario |
| Artefactos | 7+ tipos | 10+ tipos |
| Neo4j | Exporta CSV manual | Subida directa |
| Resolución IP | Manual | Automática |

En investigaciones con decenas de máquinas y GBs de logs, la diferencia de rendimiento no es un lujo — es una necesidad.

## Próximos posts

En futuros artículos detallaremos:

- Guía de instalación paso a paso
- Deep dive en cada tipo de artefacto soportado
- Configuración de Neo4j para visualización
- Consultas Cypher avanzadas para investigaciones complejas
- Caso práctico: reconstruyendo un ataque de ransomware con masstin
