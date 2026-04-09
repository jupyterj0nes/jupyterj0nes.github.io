---
layout: post
title: "Masstin UAL: Logs de acceso a servidor que sobreviven al borrado de eventos"
date: 2026-04-09 14:00:00 +0100
category: tools
lang: es
ref: tool-masstin-ual
tags: [masstin, ual, user-access-logging, forensics, dfir, movimiento-lateral, ese, herramientas]
description: "Como masstin parsea las bases de datos UAL (User Access Logging) de Windows Server para recuperar 3 anos de historial de acceso — incluso cuando los event logs han sido borrados."
comments: true
---

## El problema

Recoges evidencia forense de un Domain Controller. El log de seguridad ha estado rotando cada pocas horas en este servidor ocupado — o peor, el atacante lo borro. Necesitas saber quien accedio a este servidor, desde que IP y cuando. Los event logs no te lo pueden decir.

**User Access Logging (UAL)** si puede.

## Que es UAL?

User Access Logging es una funcionalidad de Windows Server (2012, 2012 R2, 2016, 2019, 2022) que **registra silenciosamente cada acceso de cliente** por rol y servicio. Almacena:

- **Usuario** (dominio\usuario)
- **Direccion IP origen**
- **Timestamps** de primer y ultimo acceso
- **Numero de accesos**
- **Rol del servidor** al que se accedio (File Server/SMB, Remote Access/RDP, DHCP, AD DS, Web Server, etc.)

La ventaja critica: **UAL retiene datos hasta 3 anos** y se almacena en bases de datos ESE separadas de los event logs. Los atacantes que borran event logs raramente conocen UAL.

### Donde se encuentra

```
C:\Windows\System32\LogFiles\Sum\
├── Current.mdb              # Ano activo (se actualiza cada 24h)
├── {GUID}.mdb               # Snapshot del ano actual
├── {GUID}.mdb               # Ano anterior
├── {GUID}.mdb               # Hace dos anos
└── SystemIdentity.mdb       # Metadatos del servidor + mapeo de roles
```

El formato es **ESE (Extensible Storage Engine)** — el mismo motor de base de datos que usa Active Directory y Exchange.

---

## Como parsea masstin UAL

Masstin usa [libesedb](https://github.com/libyal/libesedb) (la libreria forense ESE de Joachim Metz, mismo autor que libvshadow) para leer bases de datos UAL directamente — incluyendo **bases de datos dirty** que estaban en uso cuando se capturo la imagen. Sin reparacion, sin esentutl.

### Que extrae masstin

De la tabla **CLIENTS** en cada fichero `.mdb`:

| Campo UAL | Columna masstin | Descripcion |
|-----------|----------------|-------------|
| `LastAccess` | `time_created` | Timestamp del acceso mas reciente |
| `InsertDate` | `time_created` | Timestamp del primer acceso (segunda entrada) |
| `AuthenticatedUserName` | `target_user_name` + `target_domain_name` | Separado por `\` |
| `Address` | `src_ip` | IPv4, IPv6 o localhost (binario → legible) |
| Role (via `RoleGuid`) | `event_id` | Mapeado a protocolo: SMB, RDP, HTTP, LDAP, etc. |
| Hostname servidor | `dst_computer` | De `SystemIdentity.mdb` → tabla `SYSTEM_IDENTITY` |
| `TotalAccesses` | `detail` | Incluido como numero de accesos |

Cada registro UAL produce **dos entradas en la timeline**: una para el primer acceso (`InsertDate`) y otra para el mas reciente (`LastAccess`). Esto da dos puntos de anclaje en la linea temporal.

### Mapeo de rol a protocolo

| Rol UAL | `event_id` masstin | Significado |
|---------|-------------------|-------------|
| File Server | `SMB` | Acceso a shares SMB, named pipes (PsExec, sc.exe) |
| Remote Access | `RDP` | Conexiones Remote Desktop |
| Web Server | `HTTP` | Acceso al servidor web IIS |
| FTP Server | `HTTP` | Conexiones FTP |
| Active Directory Domain Services | `LDAP` | Autenticacion y consultas AD |
| Active Directory Certificate Services | `CERT` | Solicitud de certificados |
| DHCP Server | `DHCP` | Solicitudes de lease DHCP |
| DNS Server | `DNS` | Consultas DNS |
| Print and Document Services | `PRINT` | Acceso al servidor de impresion |
| Otros roles | `UAL` | Acceso UAL generico |

---

## Uso

### Deteccion automatica

Cuando masstin escanea un arbol de directorios (con `-d`), busca automaticamente bases de datos UAL en `Windows\System32\LogFiles\Sum\` y en cualquier subdirectorio que contenga ficheros `.mdb`:

```bash
# Apunta a la raiz de la evidencia — masstin encuentra EVTX + UAL automaticamente
masstin -a parse-windows -d /evidence/C_drive/ -o timeline.csv

# Apunta directamente a la carpeta Sum
masstin -a parse-windows -d /evidence/Windows/System32/LogFiles/Sum/ -o timeline.csv
```

### Ficheros directos

Tambien puedes pasar ficheros `.mdb` individuales con `-f`:

```bash
masstin -a parse-windows -f Current.mdb -f SystemIdentity.mdb -o timeline.csv
```

> **Consejo:** Incluye siempre `SystemIdentity.mdb` cuando uses `-f` — contiene los mapeos de nombres de rol y el hostname del servidor.

### Desde imagenes forenses

Con `parse-image-windows`, las bases de datos UAL se extraen del filesystem NTFS automaticamente junto con los ficheros EVTX:

```bash
masstin -a parse-image-windows -f DC01.e01 -o timeline.csv
```

Esto extrae EVTX + UAL del volumen live y de todos los snapshots VSS.

### Desde volumenes montados

```bash
masstin -a parse-image-windows -d D: -o timeline.csv
```

---

## Analisis forense con UAL

### Cuando los event logs no estan

UAL es tu respaldo cuando Security.evtx ha rotado o ha sido borrado. Si el atacante uso PsExec, monto shares de ficheros o accedio a servicios via SMB, el rol **File Server** lo habra registrado — con la IP origen, usuario y timestamps de los ultimos anos.

### Analisis de frecuencia

UAL registra el **numero total de accesos** para cada combinacion usuario/IP/rol por ano. Un usuario con `TotalAccesses: 2` en un Domain Controller donde los administradores tipicamente muestran miles de accesos es sospechoso. Combinado con timestamps alrededor del marco temporal del incidente, es evidencia solida de movimiento lateral.

### Correlacion con otros artefactos

Las entradas UAL en la timeline de masstin se situan junto a eventos EVTX, logs Linux y datos EDR. Cuando ves una entrada UAL `SMB` desde una IP que tambien aparece en Security.evtx 4624 Type 3, tienes corroboracion. Cuando el EVTX no esta pero el registro UAL permanece, sigues teniendo la evidencia del acceso.

### Rastreando hacia atras hasta el paciente cero

Si conoces un usuario comprometido, busca la timeline UAL en todos los servidores. Las direcciones IP origen revelan que maquinas uso el atacante como trampolines. Sigue las IPs hacia atras en la timeline para encontrar el host inicial.

---

## Detalles tecnicos

### Manejo de bases de datos ESE

Masstin usa `libesedb` (via bindings FFI en Rust) para leer bases de datos ESE. Es la misma libreria C usada por herramientas forenses como `esedbexport` y mantenida por Joachim Metz (autor de libvshadow, libewf y muchas otras librerias forenses).

**Bases de datos dirty**: Las bases de datos ESE capturadas de sistemas en ejecucion tipicamente estan en estado "dirty shutdown". A diferencia de herramientas que requieren `esentutl.exe /p` para repararlas primero, libesedb lee bases de datos dirty nativamente como libreria forense. Sin paso de reparacion.

### Deduplicacion

Cuando multiples ficheros `.mdb` contienen el mismo registro (ej. `Current.mdb` y el snapshot anual `{GUID}.mdb`), la deduplicacion de Polars en masstin elimina los duplicados automaticamente — igual que hace con eventos EVTX del volumen live y snapshots VSS.

### Formato de timestamps

UAL almacena timestamps como valores Windows FILETIME (64 bits, intervalos de 100 nanosegundos desde 1601-01-01). Masstin los convierte a formato `YYYY-MM-DD HH:MM:SS` UTC, consistente con todas las demas entradas de la timeline.

---

## Comparacion con otras herramientas UAL

| Funcionalidad | SumECmd | KStrike | **masstin** |
|---------------|:---:|:---:|:---:|
| Parsear tabla CLIENTS | Si | Si | **Si** |
| Parsear SystemIdentity | Si | Si | **Si** |
| Mapear RoleGuid a nombres | Si | Si | **Si** |
| Manejar bases de datos dirty | No (necesita esentutl) | No (necesita esentutl) | **Si (nativo)** |
| Fusionar con timeline EVTX | No | No | **Si** |
| Extraer de imagenes E01 | No | No | **Si** |
| Extraer de snapshots VSS | No | No | **Si** |
| Extraer de volumenes montados | No | No | **Si** |
| Visualizacion en grafo | No | No | **Si** |
| Multiplataforma | Solo Windows (.NET) | Python | **Windows/Linux/macOS** |

---

## Referencias

- [Microsoft: Get Started with User Access Logging](https://learn.microsoft.com/en-us/windows-server/administration/user-access-logging/get-started-with-user-access-logging)
- [CrowdStrike: User Access Logging Overview](https://www.crowdstrike.com/en-us/blog/user-access-logging-ual-overview/)
- [The DFIR Spot: Investigating Server Access with UAL](https://www.thedfirspot.com/post/sum-ual-investigating-server-access-with-user-access-logging)
- [SumECmd de Eric Zimmerman](https://github.com/EricZimmerman/Sum)
- [KStrike de Brian Moran](https://github.com/brimorlabs/KStrike)
- [libesedb de Joachim Metz](https://github.com/libyal/libesedb)
