---
layout: post
title: "Parsers custom de masstin: un YAML por fabricante, una timeline para todo"
date: 2026-04-15 07:00:00 +0100
category: tools
lang: es
ref: tool-masstin-custom-parsers
tags: [masstin, custom-parsers, yaml, vpn, firewall, proxy, dfir, herramientas]
description: "La nueva acción parse-custom de masstin convierte cualquier log de VPN, firewall o proxy en entradas de la timeline unificada de movimiento lateral — solo hay que escribir un fichero YAML. Recorrido del esquema, la biblioteca de reglas pre-hechas y un parser para Palo Alto GlobalProtect investigado a fondo como primera entrada."
comments: true
---

## El problema del parseo por fabricante

Todo caso DFIR acaba tropezando con el mismo punto de fricción. La parte Windows es manejable — EVTX, UAL, prefetch, registro, todo formato bien definido. La parte Linux es un poco más sucia pero aún acotada — auth.log, secure, wtmp, audit. Y luego viene el resto: Palo Alto GlobalProtect, Cisco AnyConnect, Fortinet SSL-VPN, Checkpoint, OpenVPN, Squid, Cloudflare Access, ZScaler, cualquier firewall hardware, cualquier VPN cloud. Cada uno con su formato de log, sus convenciones, sus rarezas, y escribir un parser dedicado por fabricante es una batalla perdida.

La respuesta de masstin es `parse-custom`: una nueva acción que parsea **cualquier log de texto** usando **ficheros YAML de reglas**. Un fichero por formato de fabricante. Una biblioteca de reglas pre-hechas que crece con el tiempo. Dentro de cada fichero, una lista de sub-parsers maneja los distintos tipos de línea que emite el mismo producto. La salida es la misma timeline CSV de 14 columnas que masstin usa en todas partes, así que un chunk EVTX carved de un desktop, un brute-force SSH en Linux y un login VPN de GlobalProtect aparecen lado a lado, listos para visualización en grafo y reconstrucción temporal de la ruta del atacante.

Este post recorre el diseño, el esquema, y la primera regla que se publica con la biblioteca: un parser para Palo Alto GlobalProtect completamente investigado, construido a partir de la documentación oficial de Palo Alto Networks y validado contra líneas de log reales.

---

## Decisiones de diseño

El esquema es deliberadamente **aburrido**: YAML plano, cuatro bloques por parser, sustitución de strings para el mapeo de salida. Explícitamente descartamos:

- **Embeber un lenguaje de scripting** (Lua, Python). Máxima flexibilidad, pero rompe la premisa de "fácil para usuarios". Si necesitas código, probablemente la decisión correcta es contribuir un parser nativo a masstin.
- **Grok / Logstash patterns.** Elegante pero añade una curva de aprendizaje encima del regex plano. Cualquiera que haya tocado una regla Sigma ya entiende YAML + substrings + regex.
- **Un mapeo columna a columna del tipo `columna_3 = source_ip`.** Demasiado limitado — los logs reales tienen 4-6 tipos de línea distintos por producto, cada uno con su forma. Necesitamos varios sub-parsers por fichero.

Lo que mantuvimos:

- **Un fichero por combinación fabricante+formato.** `palo-alto-globalprotect.yaml` cubre el formato legacy del SYSTEM log. Un fichero separado cubrirá el log type dedicado `globalprotect` de PAN-OS 9.1+ cuando esté listo. Mezclar dos formatos en un mismo fichero es una trampa.
- **El primer match gana.** Dentro de un fichero, los parsers se prueban en orden. El primero que reclama una línea produce exactamente un record y pasa a la siguiente. Barato, predecible, fácil de razonar.
- **Las líneas rechazadas son ciudadanas de primera clase.** Cualquier línea que nada matchea va a un log de rechazos. `--dry-run` te muestra las primeras para que veas qué le falta a tu regla. `--debug` conserva una muestra junto al CSV de salida para análisis post-mortem.
- **Cuatro extractores cubren el mundo real.** CSV para logs tabulares (Palo Alto, muchos exports cloud). Keyvalue para logs `key=value` (Fortinet, formatos tipo CEF-lite). Regex para prosa libre (OpenVPN, syslog legacy). JSON está planificado para v2.

---

## El esquema de un vistazo

```yaml
meta:
  vendor: "Palo Alto Networks"
  product: "GlobalProtect (VPN)"
  reference_url: "https://docs.paloaltonetworks.com/..."

prefilter:           # vía rápida opcional antes del matching por parser
  contains_any: ["globalprotectgateway-", "globalprotectportal-"]

parsers:
  - name: "gp-gateway-auth-succ"
    match:
      contains: ["globalprotectgateway-auth-succ"]
    extract:
      type: csv
      delimiter: ","
      quote: '"'
      fields_by_index:
        6: generated_time
        9: gateway_name
        14: description
    sub_extract:
      field: description
      strip_before: ". "
      type: keyvalue
      pair_separator: ","
      kv_separator: ":"
      trim: true
    map:
      time_created:       "${generated_time}"
      computer:           "${gateway_name}"
      event_type:         "SUCCESSFUL_LOGON"
      event_id:           "GP-GW-AUTH-SUCC"
      subject_user_name:  "${User name}"
      workstation_name:   "${Login from}"
      ip_address:         "${Login from}"
      logon_type:         "VPN"
      filename:           "${__source_file}"
      detail:             "GlobalProtect gateway auth OK | user=${User name} from=${Login from} auth=${Auth type}"
```

Cuatro bloques por parser:

- **`match`** — qué líneas reclama este parser. Combina `contains`, `contains_any` y `regex`.
- **`extract`** — cómo sacar campos de la línea matcheada. Elige uno de `csv`, `regex`, `keyvalue`.
- **`sub_extract`** — segunda pasada opcional sobre un campo ya extraído. Esencial para formatos anidados como Palo Alto, donde la forma exterior es CSV pero los datos interesantes de usuario/IP viven dentro de uno de los campos exteriores como una frase narrativa seguida de `Key: value, Key: value`.
- **`map`** — rellena las 14 columnas de `LogData` usando sustitución `${variable}`. Lo desconocido se queda vacío. Cualquier texto puede embeberse en cualquier campo.

Eso es todo. Todo lo demás (prefilter, strip_before, las variables especiales `${__source_file}` / `${__line_number}`) es azúcar de conveniencia sobre esos cuatro bloques.

La referencia completa del esquema está en [`docs/custom-parsers.md`](https://github.com/jupyterj0nes/masstin/blob/main/docs/custom-parsers.md) dentro del repo.

---

## Recorrido por la regla de Palo Alto GlobalProtect

La VPN GlobalProtect de Palo Alto es un primer objetivo natural: está ampliamente desplegada, el formato de log está documentado, y hay logs de ejemplo públicos contra los que pude validar. En realidad hay dos formatos: el **legacy** SYSTEM log (usado por la mayoría de deployments con syslog forwarding clásico) y un **nuevo** log type dedicado `globalprotect` introducido en PAN-OS 9.1 con 49+ columnas CSV separadas. La regla v1 cubre el formato legacy, porque es lo que el 90% de los deployments reales siguen produciendo. La regla del log type dedicado se publicará como un fichero separado cuando tenga líneas de ejemplo confirmadas contra las que probar.

### El formato legacy

Un evento de login de GlobalProtect en el SYSTEM log tiene este aspecto (muestra real del Palo Alto Splunk data generator):

```
1,2016/02/24 21:45:08,007200001165,SYSTEM,globalprotect,0,2016/02/24 21:40:52,,globalprotectgateway-auth-succ,VPN-GW-N,0,0,general,informational,"GlobalProtect gateway user authentication succeeded. Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise",641953,0x8000000000000000,0,0,0,0,,PA-VM
```

La forma exterior es CSV con el campo 14 entre comillas dobles. El mapeo índice-a-campo, de la página oficial de descripciones de campos syslog:

| Índice | Campo |
|---|---|
| 0 | FUTURE_USE (normalmente "1") |
| 1 | Receive Time |
| 2 | Serial Number |
| 3 | Type (`SYSTEM`) |
| 4 | Subtype (`globalprotect`) |
| 6 | Generated Time (timestamp canónico) |
| 8 | Event ID (`globalprotectgateway-auth-succ`, `-auth-fail`, `-logout-succ`, `-regist-succ`, `portal-auth-*`) |
| 9 | Nombre del objeto (gateway o portal) |
| 14 | Description (entre comillas, contiene los datos de usuario/IP como key-value interno) |

Fíjate en el campo 14. Es un campo CSV por derecho propio, pero el usuario, la IP, el tipo de autenticación y el SO viven **dentro de él**, como una frase en inglés seguida de `Key: value, Key: value`:

```
GlobalProtect gateway user authentication succeeded. Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise
```

Esto es exactamente el tipo de formato anidado para el que se diseñó `sub_extract`.

### Manejar el description anidado

Primero corremos un extract CSV que saca el description como un único string. Luego corremos un sub-extract keyvalue sobre ese string — pero no antes de **quitar la frase inicial**. Sin el strip, el splitter keyvalue vería la primera coma y trataría toda la frase hasta esa coma como una clave gigante:

```
KEY: "GlobalProtect gateway user authentication succeeded. Login from"
VAL: "216.113.183.230"
```

...y la sustitución `${Login from}` devolvería silenciosamente nada.

El fix es `strip_before: ". "` — elimina todo hasta e incluyendo el primer ". " del campo. Después del strip, el input del keyvalue queda limpio:

```
Login from: 216.113.183.230, User name: user3, Auth type: profile, Client OS version: Microsoft Windows Server 2008 R2 Enterprise
```

y el extractor keyvalue produce `Login from`, `User name`, `Auth type`, `Client OS version` como variables de contexto, listas para `${Login from}` y compañía en el map.

### Los cinco sub-parsers

La regla v1 tiene cinco parsers que cubren los eventos relevantes para tracking de movimiento lateral:

1. `gp-gateway-auth-succ` — autenticación exitosa en gateway → `SUCCESSFUL_LOGON`
2. `gp-gateway-regist-succ` — sesión establecida por completo → `SUCCESSFUL_LOGON` (variante marcada con su propio `event_id`)
3. `gp-auth-fail` — fallo de autenticación en gateway o portal → `FAILED_LOGON`
4. `gp-gateway-logout` — logout de gateway → `LOGOFF`
5. `gp-portal-auth-succ` — auth OK en portal (previo al gateway, informacional) → `SUCCESSFUL_LOGON` con `event_id=GP-PORTAL-AUTH-SUCC`

Los eventos que NO son logons (push de configuración, mensajes del agente, config release) caen intencionalmente al log de rechazos. Masstin es un tracker de movimiento lateral, no un agregador genérico de logs.

### Validación contra muestras reales

La regla se validó con `--dry-run` contra 7 líneas de ejemplo tomadas textualmente del [Palo Alto Splunk data generator](https://github.com/PaloAltoNetworks/Splunk-App-Data-Generator/blob/master/bin/data/pan_globalprotect.txt) — 4 matchearon (los eventos de logon), 3 fueron rechazadas correctamente (config push / agent message / config release):

```
[2/3] Processing 1 log file(s)...
    lines=7 matched=4 rejected=3

Custom parser summary:
  Lines read:    7
  Matched:       4 (57.1%)
  Rejected:      3
  Hits per parser:
         1 gp-gateway-regist-succ
         1 gp-gateway-logout
         1 gp-gateway-auth-succ
         1 gp-auth-fail

First matched records:
  2016/02/24 22:01:41 | LOGOFF            | user=user3         | src=              | dst=VPN-GW-N    | detail=GlobalProtect gateway logout | user=user3 reason=client logout.
  2016/02/24 21:40:52 | SUCCESSFUL_LOGON  | user=user3         | src=216.113.183.230 | dst=VPN-GW-N  | detail=GlobalProtect gateway auth OK | user=user3 from=216.113.183.230 auth=profile
  2016/02/24 21:40:28 | FAILED_LOGON      | user=Administrator | src=60.28.233.48  | dst=GP-Portal-1 | detail=GlobalProtect auth FAIL | user=Administrator from=60.28.233.48 reason=Authentication failed: Invalid username or password
  2016/02/24 22:41:24 | SUCCESSFUL_LOGON  | user=user1         | src=64.147.162.160 | dst=VPN-GW-N  | detail=GlobalProtect gateway register (session up) | user=user1 from=64.147.162.160 os=Microsoft Windows Server 2008 R2 Enterprise Edition Service Pack 1
```

IP de origen, nombre de usuario, tipo de autenticación, versión del SO — todo se puebla correctamente para cada evento de logon. Los cuatro records matcheados aterrizan en la misma CSV de 14 columnas y están listos para `load-memgraph` o `load-neo4j` como cualquier otra fuente de masstin.

---

## La biblioteca de reglas

La biblioteca inicial trae **8 reglas completas con 31 sub-parsers** cubriendo los productos VPN, firewall y proxy más habituales. Cada regla se ha investigado contra la documentación oficial del fabricante y se ha validado contra líneas de ejemplo realistas que están commiteadas junto a cada regla en `<categoría>/samples/`.

| Categoría | Regla | Parsers | Formato |
|---|---|---|---|
| VPN | [`vpn/palo-alto-globalprotect.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/palo-alto-globalprotect.yaml) | 5 | SYSTEM log subtype=globalprotect (CSV syslog legacy) |
| VPN | [`vpn/cisco-anyconnect.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/cisco-anyconnect.yaml) | 4 | `%ASA-6-113039` / `722022` / `722023` / `%ASA-4-113019` |
| VPN | [`vpn/fortinet-ssl-vpn.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/fortinet-ssl-vpn.yaml) | 3 | `type=event subtype=vpn action=tunnel-up/down/ssl-login-fail` |
| VPN | [`vpn/openvpn.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/vpn/openvpn.yaml) | 4 | Syslog libre (`Peer Connection Initiated`, `AUTH_FAILED`, `SIGTERM`) |
| Firewall | [`firewall/palo-alto-traffic.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/palo-alto-traffic.yaml) | 2 | PAN-OS TRAFFIC CSV — sesiones autenticadas vía User-ID |
| Firewall | [`firewall/cisco-asa.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/cisco-asa.yaml) | 6 | Auth AAA (`113004/5`), login permit/deny (`605004/5`), WebVPN (`716001/2`) |
| Firewall | [`firewall/fortinet-fortigate.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/firewall/fortinet-fortigate.yaml) | 4 | `type=event subtype=system\|user` admin login, user auth |
| Proxy | [`proxy/squid.yaml`](https://github.com/jupyterj0nes/masstin/blob/main/rules/proxy/squid.yaml) | 3 | `access.log` nativo — CONNECT tunnel, HTTP, TCP_DENIED |

Ejecutar la biblioteca entera contra todos los ficheros de ejemplo a la vez produce:

```
Loaded 8 rule file(s), 31 parsers total
Lines read:    46
Matched:       38 (82.6%)
Rejected:      8   ← todos rechazados intencionalmente (config-release, paquetes TLS
                     de handshake, logs de system health, DNS no autenticado,
                     peticiones de proxy anónimas)
```

Algunas decisiones de diseño interesantes que salieron al hacer el paso de stub a regla:

- **Cisco dividido en dos ficheros** — `cisco-anyconnect.yaml` cubre el ciclo de vida de sesión VPN (parent session start, SVC connect/disconnect, session disconnect con duración). `cisco-asa.yaml` cubre el camino genérico de firewall: autenticación AAA, login permit/deny de management, sesiones WebVPN de portal. Mismo flujo syslog, propósito distinto.
- **Palo Alto TRAFFIC filtra por User-ID** — los logs TRAFFIC son de volumen enorme, pero la señal de movimiento lateral solo está en las sesiones donde el firewall pudo resolver el usuario de dominio con User-ID. La regla usa un regex posicional (`[^,]+` en la coma índice 12) para exigir un `srcuser` no vacío antes de que el parser toque la línea, así el tráfico a internet y las sesiones DNS/NTP se descartan barato en la fase de match.
- **Squid usa match positivo en lugar de look-ahead negativo** — el crate `regex` de Rust es linear-time y no soporta `(?!...)`, así que en lugar de "el usuario no es `-`", las reglas dicen "el usuario empieza por carácter alfanumérico" (`[A-Za-z0-9][^\s]*`) — funcionalmente equivalente para el formato real de log.
- **Los eventos de admin de FortiGate no tienen `action=login`** — tienen `logdesc="Admin login successful"`. Descubierto durante la validación: la primera versión de la regla matcheaba cero líneas porque asumía un convenio de naming que solo aplica al subtype VPN. El fix ilustra el valor del bucle de validación con `--dry-run`.

El modelo de contribución es el mismo que las reglas Sigma: recolectar líneas de ejemplo, escribir el YAML, validar con `--dry-run`, abrir un PR añadiendo un fichero nuevo más una fila en la tabla de referencias. Guía completa en [`rules/README.md`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md).

---

## Uso

```bash
# Un fichero de regla único
masstin -a parse-custom --rules rules/vpn/palo-alto-globalprotect.yaml -f vpn.log -o timeline.csv

# Biblioteca entera — todas las reglas se prueban contra todos los logs
masstin -a parse-custom --rules rules/ -f vpn.log -f fw.log -o timeline.csv

# Dry-run: muestra primeros matches + muestras de rechazados, no escribe CSV
masstin -a parse-custom --rules rules/vpn/palo-alto-globalprotect.yaml -f vpn.log --dry-run

# Debug: conserva una muestra de líneas rechazadas junto al output
masstin -a parse-custom --rules rules/ -f vpn.log -o timeline.csv --debug
```

Apunta la salida a cualquier pipeline compatible con masstin (Neo4j, Memgraph, el merge CSV) y tus eventos VPN ahora fluyen por el mismo grafo que tu RDP Windows, tu SSH Linux y tus datos EVTX carved.

---

## Relacionado: filtrado de ruido para la timeline unificada

En cuanto empiezas a meter logs de VPN / firewall / proxy en la timeline de masstin junto con EVTX de Windows y auth.log de Linux, el output combinado crece rápido — y mucho de lo que crece es ruido. Logons de servicio desde `LOCAL SYSTEM`, intentos de RDP fallidos donde la IP de origen no se capturó, brute force desde jumpboxes ruidosos, autenticaciones de red de machine accounts (`HOST$`), y demás.

Masstin v0.12.0 incorpora cuatro flags de filtrado opt-in construidas sobre análisis real de CSVs de 178k eventos:

- **`--ignore-local`** descarta registros sin información útil de origen. La regla se basa en una tabla de verdad: un registro se mantiene siempre que `src_ip` O `src_computer` tenga señal real (la IP manda — `MSTSC|<IP-real>` se queda, `MSTSC|-` se filtra). Captura IPs de loopback, literales `LOCAL`, logon_type 5/2 de Windows con origen vacío, self-reference sin IP, y placeholders de ruido (`MSTSC`, `default_value`).
- **`--exclude-users <LIST>`** descarta registros cuyo campo de usuario matchea algún glob de la lista. Soporta match exacto, prefijo (`svc_*`), sufijo (`*$` para machine accounts), contains (`*admin*`), CSV inline y `@file.txt`.
- **`--exclude-hosts <LIST>`** misma sintaxis, matchea `src_computer` / `dst_computer`. Útil para excluir jumpboxes y hosts de monitoring conocidos.
- **`--exclude-ips <LIST>`** acepta IPs individuales, rangos CIDR (`10.0.0.0/8`, `fe80::/10`) y `@file.txt`. Crítico en casos multi-sede con docenas de subredes confiables.

Combinado con `--dry-run` obtienes un reporte de estadísticas pre-vuelo que muestra exactamente cuántos registros eliminaría cada capa del filtro, desglosado por regla, sin escribir el CSV de salida. Eso te permite validar la decisión de filtrado antes de comprometerte a una corrida larga.

Las cuatro flags aplican a todas las parser actions (`parse-windows`, `parse-linux`, `parse-image`, `parse-custom`, `parser-elastic`, `parse-cortex`, `parse-cortex-evtx-forensics`) y a `merge` — así que también puedes re-filtrar un CSV existente sin re-parsear la evidencia original.

Medidas reales contra la timeline combinada del DefCon DFIR CTF 2018 (178k eventos de FileServer + HRServer + Desktop):

```
🧹 Filter summary:
   Total records seen: 178,274
   Total kept:         110,070 (61.7%)
   Total filtered:     68,204 (38.3%)

   --ignore-local:     68,204 (38.3%)
      both_noise              67,703
      self_reference             134
      service_logon              306
      interactive_logon           21
      literal_LOCAL               39
      loopback_ip                  1
```

Documentación completa en la [sección de filtrado del README](https://github.com/jupyterj0nes/masstin#noise-filtering---ignore-local-and---exclude-).

## Qué sigue

- **Extractores v2.** JSON con selectores al estilo jq. Ya planificado.
- **Map condicional.** Predicados tipo `when: ${action} == "fail"` para que un único parser pueda manejar variantes de línea de éxito y fallo del mismo evento cuando el formato lo hace más limpio que dos parsers.
- **Más reglas.** Cisco ASA AnyConnect, Fortinet FortiGate, OpenVPN y Squid son las siguientes prioridades. Checkpoint, ZScaler, Cloudflare Access están en el backlog.
- **Log type dedicado de PAN-OS 9.1+ `globalprotect`.** Una segunda regla de Palo Alto cubriendo el formato dedicado de 49+ columnas, en cuanto pueda validarla contra muestras reales.
- **Comando de validación por regla.** `masstin -a parse-custom --validate rule.yaml` para detectar errores de esquema sin necesidad de ejecutar contra un fichero de log.

Si quieres contribuir una regla o una muestra de los logs de tu fabricante, la guía está en [`rules/README.md`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md) dentro del repo de masstin.

---

## Referencias — documentación oficial por fabricante

Cada regla de la biblioteca se ha escrito a partir de la documentación oficial del fabricante sobre el formato de log y luego validada contra líneas de ejemplo reales. Estas son las fuentes usadas en la fase de investigación:

### Palo Alto GlobalProtect (`vpn/palo-alto-globalprotect.yaml`)

- [GlobalProtect Log Fields (Palo Alto Networks oficial)](https://docs.paloaltonetworks.com/ngfw/administration/monitoring/use-syslog-for-monitoring/syslog-field-descriptions/globalprotect-log-fields)
- [Event Descriptions for the GlobalProtect Logs in PAN-OS](https://docs.paloaltonetworks.com/globalprotect/10-1/globalprotect-admin/logging-for-globalprotect-in-pan-os/event-descriptions-for-the-globalprotect-logs-in-pan-os)
- [Líneas de ejemplo — Palo Alto Splunk App Data Generator](https://github.com/PaloAltoNetworks/Splunk-App-Data-Generator/blob/master/bin/data/pan_globalprotect.txt) (usadas literalmente para la validación)

### Palo Alto TRAFFIC (`firewall/palo-alto-traffic.yaml`)

- [Traffic Log Fields — PAN-OS 11.0 (Palo Alto Networks oficial)](https://docs.paloaltonetworks.com/pan-os/11-0/pan-os-admin/monitoring/use-syslog-for-monitoring/syslog-field-descriptions/traffic-log-fields)
- [Índice de Syslog Field Descriptions](https://docs.paloaltonetworks.com/ngfw/administration/monitoring/use-syslog-for-monitoring/syslog-field-descriptions)

### Cisco AnyConnect (`vpn/cisco-anyconnect.yaml`)

- [Cisco Secure Firewall ASA Series Syslog Messages (oficial, todas las versiones)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog.html)
- [ASA Event 113039 — AnyConnect Parent Session Started (referencia ManageEngine)](https://www.manageengine.com/products/eventlog/cisco-asa-events-auditing/cisco-anyconnect-parent-session-started-113039.html)

### Cisco ASA (`firewall/cisco-asa.yaml`)

- [ASA Syslog Messages 101001–199021 (oficial)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog/syslogs1.html)
- [ASA Syslog Messages 715001–721019 (eventos WebVPN)](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/asa-syslog/syslog-messages-715001-to-721019.html)
- [Messages by Severity Level](https://www.cisco.com/c/en/us/td/docs/security/asa/syslog/b_syslog/syslogs-sev-level.html)

### Fortinet SSL VPN (`vpn/fortinet-ssl-vpn.yaml`)

- [FortiOS Log Message Reference (Fortinet oficial, latest)](https://docs.fortinet.com/document/fortigate/latest/fortios-log-message-reference)
- [Understanding VPN-related logs — FortiGate cookbook](https://docs.fortinet.com/document/fortigate/6.2.0/cookbook/834425/understanding-vpn-related-logs)
- [`LOG_ID_EVENT_SSL_VPN_USER_SSL_LOGIN_FAIL` (39426)](https://docs.fortinet.com/document/fortigate/7.6.6/fortios-log-message-reference/39426/39426-log-id-event-ssl-vpn-user-ssl-login-fail)

### Fortinet FortiGate (`firewall/fortinet-fortigate.yaml`)

- [FortiOS Log Message Reference (Fortinet oficial, latest)](https://docs.fortinet.com/document/fortigate/latest/fortios-log-message-reference)

### OpenVPN (`vpn/openvpn.yaml`)

- [OpenVPN 2.6 Reference Manual](https://openvpn.net/community-resources/reference-manual-for-openvpn-2-6/)
- [Documentación de logging de OpenVPN Access Server](https://openvpn.net/as-docs/logging.html)

### Squid proxy (`proxy/squid.yaml`)

- [Squid wiki — LogFormat feature reference](https://wiki.squid-cache.org/Features/LogFormat)
- [Squid FAQ — Log Files](https://wiki.squid-cache.org/SquidFaq/SquidLogs)
- [Directiva `logformat`](https://www.squid-cache.org/Doc/config/logformat/)

---

## Documentación relacionada

| Tema | Enlace |
|------|--------|
| Página principal de masstin | [masstin](/es/tools/masstin-lateral-movement-rust/) |
| Esquema de custom parsers | [`docs/custom-parsers.md`](https://github.com/jupyterj0nes/masstin/blob/main/docs/custom-parsers.md) |
| Biblioteca de reglas | [`rules/`](https://github.com/jupyterj0nes/masstin/tree/main/rules) |
| Tabla de referencias de la biblioteca | [`rules/README.md#references`](https://github.com/jupyterj0nes/masstin/blob/main/rules/README.md#references) |
| Formato CSV y clasificación de eventos | [Formato CSV](/es/tools/masstin-csv-format/) |
| Visualización en grafo | [Memgraph](/es/tools/memgraph-visualization/) / [Neo4j](/es/tools/neo4j-cypher-visualization/) |
