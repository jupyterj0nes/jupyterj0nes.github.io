---
layout: post
title: "AD DFIR Lab — Parte 8: Un Día en el Reino — Generando Dos Años de Ruido Histórico"
date: 2026-04-13 18:30:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part8
tags: [dfir, lab, active-directory, forensics, python, proxmox]
description: "Dos años de actividad corporativa sintética sobre un AD limpio, usando viaje hacia atrás en el reloj, un planner día-como-iteración, calendario español con vacaciones y eventos narrativos, tres traspiés brutales (wlms.exe shutdown, drift del reloj Linux, personas nocturnas invisibles), y una regeneración final cubriendo 7 VMs en 3 dominios."
comments: true
---

*Esta es la Parte 8 de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Convertimos un snapshot estéril `clean-ad` en `noisy-ad-2years` — un dataset que parece un dominio que lleva dos años en uso real en una empresa.*

## Por qué esta es la parte difícil

Un laboratorio DFIR con solo ataques y sin ruido de base es un juguete didáctico, no un entorno de entrenamiento. Las investigaciones reales son 95% actividad normal de usuario y un 5% de señal de ataque escondida dentro. La habilidad del cazador es *ver la señal a través del ruido*. Si los únicos eventos en un DC son los de los cuatro domain admins que sembraste y el único Kerberoast de prueba, todo destaca. Todo parece sospechoso porque no está pasando nada más.

Por eso existe la Fase 10: generar **dos años de historia corporativa simulada** por todo el bosque — logons en los DCs de cincuenta usuarios con horarios realistas, creación de ficheros en shares, historial de navegación, sesiones MSSQL, tareas programadas, prefetch, shellbags de usuario, todo lo que un dominio de dos años debería tener. Resultado final: un snapshot `noisy-ad-2years` que vive al lado de `clean-ad`.

Los dos snapshots sirven a propósitos distintos:

- **`clean-ad`** → aprender cómo se ve cada TTP aislado. Cero distracción, determinista.
- **`noisy-ad-2years`** → threat hunting realista. El mismo Kerberoast, pero ahora escondido entre 700+ días de eventos 4769 legítimos de decenas de usuarios.

## La forma del problema

Algunas restricciones que marcaron el diseño:

- **Dos años tienen que parecer dos años, no 730 copias del mismo día.** Fines de semana, festivos, puentes, vacaciones de agosto, la semana de Navidad, cierres de trimestre, nuevos hires, gente que se va, baja maternal, cambios de horario por promociones — todo visible en el EVTX resultante.
- **Idempotente y reanudable.** El run dura muchas horas y va a fallar. Kerberos va a dar timeout. Los guest agents van a colgarse. El host va a tener un hipo. Cada etapa tiene que ser crash-safe y cada relanzamiento tiene que retomar exactamente donde quedó.
- **Sin impacto en las licencias eval.** El laboratorio corre con ISOs de evaluación de Windows. Un run de 10 horas que queme 10 horas de eval es un desastre. El viaje hacia atrás en el reloj nos da esto gratis, *en teoría*.
- **Coherencia entre VMs.** Cuando la simulación dice "son las 2024-10-15 09:23" en el round N, todos los VMs deben coincidir en esa hora, porque si no los tickets Kerberos del futuro invalidan todo.

## Un día es la unidad, no "iteraciones"

Mi primer boceto fue un plan con `step_days = 4`: 182 iteraciones, cada una poniendo el reloj 4 días por delante del anterior. Más barato, sí, pero dolorosamente obvio para un analista forense:

```
Eventos Sysmon por día:
2024-04-13 → 47
2024-04-17 → 52
2024-04-21 → 49
2024-04-25 → 51
(nada en medio)
```

En el momento en que alguien haga `Group-Object { $_.TimeCreated.Date }`, el patrón periódico grita "sintético". Las empresas reales no trabajan en ráfagas de 30 segundos cada cuatro días.

Así que tiré eso a la basura y rehice el modelo alrededor de **una iteración por día de calendario**. 729 días de 2024-04-13 a 2026-04-12, todos ejecutados, cada uno con un *perfil* derivado del calendario:

```yaml
workday_high:     4 rounds, intensidad 100%   # cierres de trimestre, deadlines
workday_normal:   3 rounds,  70%              # L-V regular
workday_low:      2 rounds,  40%              # viernes por la tarde, puentes
weekend:          1 round,   10%              # backup nocturno + on-call
holiday:          1 round,    5%              # solo jobs automatizados
summer_reduced:   2 rounds,  25%              # todo agosto
winter_holidays:  1 round,   10%              # 22-dic → 02-ene
```

Cada round elige un timestamp aleatorio jittered dentro de un rango horario objetivo, con ±45 minutos de ruido, así dos días consecutivos workday_normal nunca caen a la misma hora. Dentro de un round, la actividad corre 30-60 segundos reales mientras el reloj avanza orgánicamente desde el inicio del round — así que una ráfaga de eventos recibe timestamps T, T+1s, T+3s, T+42s que parecen una sesión de usuario real en lugar de todo disparado en el mismo segundo exacto.

Crucial: **las vacaciones son presencia, no ausencia**. El día de Navidad no se salta — dispara un round a las 04:11 UTC con un único participante (el backup automatizado), produciendo un evento en el EVTX. El analista forense scrollea el timeline y ve un valle el 25 de diciembre, no un hueco. Un hueco es una red flag; un valle es realista.

Lo mismo para personas individuales. Catelyn Stark (la usuaria de RRHH) tiene baja maternal del 2025-04-20 al 2025-10-15 en su YAML de persona. Durante esos seis meses, su `active_on(date)` devuelve False y el planner emite cero participantes con su nombre en cualquier VM. Su último logon queda visible en el Security log del DC. Su vuelta aparece seis meses después. El analista corriendo `last-login-per-user.ps1` ve la historia exacta.

## El calendario español

Como la narrativa es "una empresa española", el set de festivos son los nacionales España:

```yaml
- 2024-05-01 Día del Trabajador
- 2024-08-15 Asunción
- 2024-10-12 Fiesta Nacional
- 2024-11-01 Todos los Santos
- 2024-12-06 Constitución
- 2024-12-08 Inmaculada
- 2024-12-25 Navidad
- 2025-01-01 Año Nuevo
- 2025-01-06 Reyes
- 2025-04-18 Viernes Santo
... etc
```

Más dos bloques estacionales (todo agosto reducido; 22-dic → 02-ene reducido), más auto-detección de "puentes" — lunes precedidos de un weekend-con-festivo, viernes seguidos del mismo. Un día que es puente se degrada a `workday_low` con intensidad 40%.

El histograma resultante para un run de dos años:

```
workday_normal       432
weekend              181
summer_reduced        60
holiday               20
winter_holidays       20
workday_low           11
workday_high           6
```

## Personas con narrativa

El roster de validación son seis usuarios (el set completo de 46 de GOAD se enchufa después de que la mecánica esté probada). Cada persona tiene un horario base, vacaciones opcionales, cambios de horario opcionales en fechas específicas, y fechas de alta/baja en la empresa:

```yaml
- id: jon.snow
  role: SysAdmin
  workstation: 106
  schedule: {start: 9, end: 18}
  workdays: [mon, tue, wed, thu, fri]
  vacations:
    - {start: "2024-08-05", end: "2024-08-23"}     # verano
    - {start: "2025-12-22", end: "2026-01-05"}     # navidad

- id: samwell.tarly
  role: Developer
  linux_host: 107
  active_from: "2024-09-01"                         # contratado a medio camino
  ...

- id: stannis.baratheon
  role: Compliance
  active_to: "2025-09-15"                           # dejó la empresa

- id: catelyn.stark
  role: HR
  vacations:
    - {start: "2025-04-20", end: "2025-10-15"}      # baja maternal

- id: arya.stark
  role: Developer
  schedule: {start: 22, end: 26}                    # turno de noche (22→02)
  schedule_changes:
    - from: "2025-10-16"
      schedule: {start: 10, end: 19}                # promoción → turno de día
```

Esta es la *capa narrativa*. Cada uno de estos patrones produce una huella forense detectable:

- **Nuevos hires**: el primer 4624 de samwell en DC01 es a las 2024-09-02 10:14, y nada de él existe antes. Corre una query de "primera aparición" y aparece en el mes correcto.
- **Bajas**: el último evento Security de stannis es el 2025-09-15 sobre las 17:00. Después de esa fecha, su cuenta sigue en AD pero no se autentica nunca. `(Get-ADUser stannis -Properties LastLogonDate).LastLogonDate` te da la fecha exacta de salida.
- **Baja maternal**: catelyn genera eventos de 2024-04-13 a 2025-04-20, luego nada, luego eventos otra vez desde 2025-10-15. Seis meses de silencio.
- **Promoción**: arya genera eventos 22:00-02:00 en LNX01 de 2024-04 hasta 2025-10-16, y luego eventos 10:00-19:00 después. Un único día donde su horario cambia permanentemente.

## El orchestrator

`phase10.py` corre en el host Proxmox. Cada VM se alcanza vía `qm guest exec` (virtio-serial), que es independiente del reloj — SSH y WinRM se rompen en el momento en que el reloj cruza una ventana de validez de certificado, pero virtio-serial no le importa qué marca el reloj.

El modelo de estado es de tres niveles:

```
run
└── days[]                 # 729 entradas, una por día de calendario
    └── rounds[]           # 1-4 por día, según el perfil
        └── participants[] # unidades de trabajo (vm, persona)
```

Cada nivel tiene `status ∈ {pending, in_progress, done, failed}`. El checkpoint es un único fichero JSON que se reescribe (atómicamente, vía `tmp + os.replace + fsync`) después de cada transición. Un crash deja el checkpoint válido anterior intacto. Un resume lee el checkpoint, encuentra el primer día `!done`, encuentra el primer round `!done` dentro, y para ese round empieza en el primer participante `!done` — retomando exactamente donde murió.

El bucle principal envuelve cada `qm guest exec` en un retry con backoff exponencial. SIGINT y SIGTERM pasan por un signal handler que llama a `emergency_restore()` — re-activando NTP y forzando una resincronización en cada VM antes de que el proceso salga. *Nunca dejamos VMs abandonadas en 2024.*

## Paralelismo donde importa

La primera versión del bucle iteraba VMs secuencialmente dentro de cada round. Para un workday_normal con 3 rounds × 5 participantes cada uno, 15 llamadas secuenciales a `qm guest exec` = ~60 segundos por día. Extrapolado: 729 días × 60s = **más de 12 horas para el run completo**.

El fix: dentro de un round, los participantes en VMs distintos son independientes (relojes distintos, payloads de actividad distintos, sin estado compartido). Los participantes en el MISMO VM tienen que seguir corriendo secuencialmente (reloj compartido). Así que el refactor agrupa los participantes pendientes por VM y reparte un worker thread por VM:

```python
with ThreadPoolExecutor(max_workers=len(by_vm)) as executor:
    futures = [executor.submit(_run_vm_in_round, vmid, parts)
               for vmid, parts in by_vm.items()]
    for future in as_completed(futures):
        status, _vm, detail = future.result()
```

Más una optimización de regalo: todos los participantes de un round en un VM comparten el mismo timestamp, así que hacemos UN SOLO `disarm + set_clock` por VM por round en lugar de uno por participante. Eso cortó otro ~30% del tiempo de round.

Los writes del checkpoint se protegen con un `threading.RLock` para mantener coherencia bajo acceso concurrente. El lock es reentrante porque algunos métodos (ej. `mark_day_failed`) llaman a otros métodos con lock, lo que causaría deadlock con un Lock plano.

ETA final para un run desde cero: **~9-10 horas**, no las 4-5 que soñé ingenuamente — el floor por round lo fija el trabajo secuencial de clock-set del VM más lento, y eso son ~10 segundos independientemente de cuántos threads le eches. Pero 10 horas es territorio nocturno, y el run es reanudable, así que un hipo a la mitad no es fatal.

## Alertas Telegram — reutilizar el bot de la Parte 7.5

Como la [Parte 7.5]({% post_url es/2026-04-13-ad-dfir-lab-part7-5-licenses %}) ya montó un bot de Telegram para mantenimiento de licencias, la Fase 10 lo reutiliza. Un pequeño `lib/notifier.py` lee `/root/lab/config/telegram.conf` y dispara mensajes en:

- arranque del run: "🚀 Phase 10 starting, N days total, resume point..."
- cada 25 días completados: progreso + conteo de fallos
- error: "❌ error on day X"
- abort: "🛑 phase 10 aborted, reason..."
- complete: "✅ phase 10 complete, snapshot `noisy-ad-2years` taken"

Todas las llamadas son best-effort no-bloqueantes — un send de Telegram fallido loguea un warning pero nunca raisea. El run no puede depender de conectividad de red al exterior. `curl` con timeout máximo 10 segundos, envuelto en try/except, y ya está.

## La validación que explotó — y por qué

Antes de comprometerme con 10 horas de generación, corrí 5 días de validación para probar que el bucle funciona. Salieron limpios: 5/5 días, 11 rounds, 53 participantes, cero fallos. La [Parte 7.5]({% post_url es/2026-04-13-ad-dfir-lab-part7-5-licenses %}) acaba diciendo "el test empírico probó que la eval de Windows se basa en reloj real y el viaje hacia atrás nunca consume tiempo de eval". Lancé el run completo.

A las 3 horas, llegó un ping de Telegram mostrando **361 fallos** y current_day = 102. Cada round estaba fallando con timeouts de `wait_agent` en los mismos tres VMs: DC01 (101), SRV02 (103), WS01 (106). Cuando me conecté por SSH y corrí `qm status`, esos tres estaban `stopped`. Los otros cuatro (DC02, DC03, SRV03, LNX01) estaban `running` — el factor común era *esos tres reciben tráfico en cada round*, porque alojan las personas `system.replication` / `system.backup` y todas las workstations humanas.

Los tres VMs no los había parado yo, ni un `qmstop`, ni OOM del host — `/var/log/pve/tasks` no mostraba shutdowns externos, dmesg estaba limpio. Los rearranqué y saqué el System log:

```
TimeCreated  : 5/31/2024 2:18:36 PM          # timestamp fake-past
Id           : 1074
ProviderName : User32
Msg          : wlms.exe has initiated the shutdown of KINGSLANDING
                on behalf of NT AUTHORITY\SYSTEM for the following
                reason: Other (Planned)
                Comment: The license period for this installation
                of Windows has expired. The operating system is
                shutting down.
```

El mismo mensaje en los tres VMs. WS01 murió a fake 2024-05-17, DC01 y SRV02 a fake 2024-05-31 — entre el ~día 30 y el ~día 50 del viaje en reloj. Los tres VMs no tocados seguían vivos porque no habían recibido suficientes manipulaciones de reloj como para disparar el umbral.

## Qué se equivocó la Parte 7.5 — y la regla real

El test empírico de la Parte 7.5 fue así:

```
12:19:00  baseline   → 128506 minutos restantes
12:19:07  qm stop    → vm off durante exactamente 10 minutos reales
12:29:25  qm start   → 128496 minutos restantes   (delta -10 = tiempo real)
```

Concluí "la eval de Windows se basa en reloj real, ergo el viaje hacia atrás es gratis". Esa conclusión es *parcialmente cierta* — pero solo probé el caso donde el reloj avanzaba HACIA ADELANTE, y lo probé en una VM apagada. Nunca probé el caso donde yo activamente ponía el reloj HACIA ATRÁS más allá de la fecha de instalación con la VM corriendo. Eso es exactamente lo que hace la Fase 10, miles de veces, y el comportamiento es distinto.

Lo que pasa realmente dentro de Windows: el **Windows Licensing Monitoring Service** (`wlms.exe`, presente en todas las installs eval de Server 2019/2016 y Win10 Enterprise) corre un check periódico. Cuando dispara, calcula el grace period de eval *basándose en el reloj actual*. Mover el reloj adelante y atrás rápido no lo crashea — wlms simplemente recalcula en su siguiente tick. Pero si `current_time < install_date`, el cálculo es negativo, y el servicio lo interpreta como "licencia expirada" y llama a `InitiateSystemShutdown`.

No lo hace instantáneamente. Basándose en las fechas empíricas de los fallos — 30 a 50 días de manipulación de reloj hacia atrás antes del primer shutdown — wlms parece acumular algún contador interno de confianza antes de apretar el gatillo. De ahí el modo de fallo silencioso, con retardo, y dependiente de cuánto se toca cada VM.

Una vez ves el mecanismo, el fix se escribe solo.

## El fix: desactivar wlms a nivel SCM

`wlms` es un servicio estándar de Windows. Lo puedes desactivar como cualquier otro:

```powershell
Stop-Service -Name wlms -Force
Set-Service -Name wlms -StartupType Disabled
```

Una vez que el StartType está en `Disabled`, el Service Control Manager de Windows **se niega** a arrancarlo — desde nada. Scheduled tasks, service triggers, servicios dependientes, un `net start` manual, nada. Esto no es "el servicio puede que no corra"; es arquitectónicamente bloqueado. Sin proceso `wlms.exe` no hay llamada a `InitiateSystemShutdown`.

Añadí esto a la función `disarm_time_sync()` de `lib/clock_control.py` — así corre en CADA clock set, idempotentemente. Y tomé un nuevo snapshot `pre-noise` en los seis VMs Windows después de desactivar wlms, así que cualquier `qm rollback pre-noise` futuro mantiene el fix.

```
$ qm guest exec 106 -- powershell -Command "(Get-Service wlms).Status"
Stopped

$ qm guest exec 106 -- powershell -Command "(Get-Service wlms).StartType"
Disabled
```

También desactivé `sppsvc` (Software Protection Service) por seguridad, aunque ya estaba parado por defecto en nuestras installs eval.

## Reinicio, validación, run completo

Con wlms matado en los 6 VMs Windows y el snapshot `pre-noise` re-tomado, reseteé el checkpoint y volví a correr la validación: 4 días limpios, 0 fallos, todos los VMs vivos, wlms seguía `Stopped` después de cada round. Entonces lancé el run completo otra vez en tmux:

```bash
tmux new-session -d -s phase10 -c /root/lab/phase10 \
     "python3 phase10.py 2>&1 | tee -a state/phase10-fullrun.log"
```

La monitorización pasa por el bot de Telegram y algún `phase10.py --status` ocasional. El run es independiente de mi sesión SSH o de Claude o de cualquier cosa — tmux lo posee, systemd lo mantiene vivo a través de logouts, y el checkpoint + signal handler significan que lo peor que cualquier interrupción puede hacer es dejar el estado perfectamente recuperable.

## Qué verifiqué en los primeros 5 días del stub run

Antes incluso del crash de wlms, había sacado pruebas forenses exhaustivas de que el mecanismo de viaje en reloj estaba escribiendo correctamente en los logs de Windows. En solo 5 días de actividad stub (sin acciones de persona reales todavía, solo ficheros heartbeat):

| Capa de artefactos | Lo que encontré |
|---|---|
| NTFS `$STANDARD_INFORMATION` | heartbeat.log CreationTime 4/15/2024 9:35, markers con timestamps per-round en 2024 |
| Sysmon EVTX | 672 eventos en 5 días en WS01 (File Create, Process Create, Image Load, Registry, Pipe, DNS), todos con TimeCreated en 2024 |
| Security EVTX | 1088 eventos (4688, 4689, 4624, 4672...) en 2024 |
| System log | Eventos de clock-change registrados, entradas Kernel-General time change |
| PowerShell Operational | 84 × 4104 Script Block Logging entries capturando cada `Set-Date` que corrimos, backdated |
| Prefetch `.pf` | 6 ficheros prefetch con LastWriteTime en la ventana 2024-04 — generados naturalmente por Windows mientras el reloj estaba puesto |
| Realismo de schedule de personas | En SRV02, el round a las 17:14 tenía tyron + system.backup pero NO catelyn ni stannis (los dos acaban a las 17:00); el round a las 16:59 tenía los cuatro (todos aún dentro del corte de las 17:00) — schedules respetados al minuto |

Y el control negativo: DC02, DC03, SRV03 y LNX01 (que no tenían personas asignadas esos 5 días) tuvieron **cero** eventos en la ventana 2024. El orchestrator es quirúrgico — toca exactamente lo que el plan dice y nada más.

## El primer run completo

Con wlms desactivado, el snapshot `pre-noise` re-tomado, y las 6 personas iniciales sobre 4 VMs tocadas, lancé el run completo otra vez en tmux. Acabó limpio en **7h 34m** para los 730 días:

```
progress:           730/730 days done, 0 in-progress, 0 pending
failures logged:    0
rounds:             1683 / 1683
participants:       8024 / 8024
```

Markers por VM tras el primer run completo:

| VM | Markers | Personas |
|---|---:|---|
| 101 DC01 | 1,683 | system.replication |
| 103 SRV02 | 4,126 | system.backup + tyron + catelyn + stannis |
| 106 WS01 | 1,167 | jon.snow (solo workdays) |
| 107 LNX01 | 1,048 | samwell.tarly + arya.stark |
| 102 DC02 | 0 | *(sin tocar)* |
| 104 DC03 | 0 | *(sin tocar)* |
| 105 SRV03 | 0 | *(sin tocar)* |

Ese "0" en las tres últimas filas es donde mi propia revisión de mi propio laboratorio cazó una laguna real. Te explico.

## El segundo problema: tres DCs silenciosos

Mirando el dataset terminado, me di cuenta de algo que cualquier instructor razonable de DFIR pillaría en cinco minutos:

> "Espera — DC02 es el domain controller del dominio hijo `north.sevenkingdoms.local`. En AD real, los DCs de child domains replican con el padre cada 15 minutos por defecto, y cualquier usuario autenticándose contra ese child domain genera tráfico Kerberos en ese DC. Un DC de child domain entero con cero eventos en dos años es forensicamente imposible."

La misma historia para DC03 (el DC del segundo forest `essos.local`) y SRV03 (la Certificate Authority ADCS — los certificados de CA se renuevan en background, y como mínimo ves una publicación de CRL diaria). Un dataset donde esos tres servidores están totalmente muertos es un dataset que un investigador entrenado marcaría como sintético en el momento en que lo abre.

La causa raíz no era un bug — era mi roster de personas. Había construido el set inicial de validación alrededor de "un representante de cada categoría de rol": un DC raíz, un file server, una workstation, un host Linux. Eso es una validación **mecánica** sólida (¿funciona el orchestrator end-to-end?) pero deja la topología del forest GOAD a medio poblar. Los otros tres VMs no se tocaban porque ninguna persona había sido definida para tocarlos.

Arreglar esto requería tres cosas.

**Primero, el modelo de persona tenía que soportar targeting multi-VM explícito.** El modelo viejo tenía un campo `workstation` por persona humana más un fallback hardcodeado a SRV02. Eso vale para un usuario centralizado de workstation pero está mal para una persona que "se autentica contra el DC del norte" — que no tiene workstation en absoluto, solo un DC. Añadí un nuevo campo lista `touches_vms`:

```yaml
- id: brandon.stark
  role: Junior Developer (north)
  touches_vms: [102]             # autentica contra DC02
  schedule: {start: 9, end: 17}
  workdays: [mon, tue, wed, thu, fri]
```

Y cambié `day_planner.py` para iterar `persona.target_vm_set()` (una unión de `workstation` + `linux_host` + `touches_vms`) en lugar de la lógica vieja campo-a-campo.

**Segundo, el roster de personas tenía que crecer para cubrir los tres dominios.** El set final son 11 humanas (desde 6) más 5 system personas (desde 2), distribuidas entre los tres dominios:

| Dominio | DC | Personas nuevas |
|--------|----|-----------------|
| sevenkingdoms.local (root) | 101 | (las 6 existentes) |
| north.sevenkingdoms.local (child) | 102 | brandon.stark, robb.stark |
| essos.local (segundo forest) | 104 | daenerys.targaryen, viserys.targaryen, khal.drogo |

Más tres system personas nuevas para garantizar que ningún DC se queda callado:

```yaml
- id: system.replication.north
  target_vm: 102
  always: true

- id: system.replication.essos
  target_vm: 104
  always: true

- id: system.adcs
  target_vm: 105                       # SRV03 CA, CRL nocturna
  always: true
```

**Tercero, los eventos narrativos había que asignarlos también a las nuevas personas.** Si no, las nuevas filas serían solo ruido plano, no historias. Añadí:

- **viserys.targaryen** (board member de essos) — part-time L/X/V, `active_to: 2025-06-30`. El analista debería poder pinpoint "cuándo se jubiló viserys".
- **khal.drogo** (sales de essos) — `active_from: 2024-06-01`. Contratación a mitad de ventana como samwell, pero del lado essos.
- **robb.stark** y **brandon.stark** (north) — horarios tipo sevenkingdoms con vacaciones.

## El tercer problema: personas nocturnas invisibles

Aprovechando que tenía el modelo de personas abierto, arreglé también una limitación que ya había anotado antes. arya.stark se suponía que era una junior dev nocturna (22:00–02:00) hasta su promoción el 2025-10-16, tras la cual pasa a turno de día 10:00–19:00. En el primer run completo, su era pre-promoción tenía **cero eventos** en el dataset. ¿Por qué? Porque los round hours del perfil `workday_normal` eran `[9, 13, 17]`, y ninguno cae en la ventana nocturna 22–02. El planner correctamente nunca la seleccionaba.

Forensicamente esto significaba que arya aparecía como "una usuaria que salió de la nada el 2025-10-16", no como "una trabajadora nocturna que fue promocionada". Narrativa rota.

Fix: añadir un cuarto round a las 23:xx a cada perfil `workday_*`:

```yaml
workday_normal:
  rounds: 4                          # antes 3
  round_hours: [9, 13, 17, 23]       # añadido round nocturno
```

Ahora los rounds pre-promoción de arya caen dentro de su ventana de turno nocturno. Las demás personas no se ven afectadas porque no están activas a las 23:xx. Coste: un round extra por workday = ~432 rounds extra en todo el run, un incremento modesto de ~30% en runtime de workdays.

## El cuarto problema: Linux atascado en fecha falsa tras el restore

El primer run completo acabó con todos los VMs Windows de vuelta a tiempo real — `w32tm /resync` funcionó. Pero LNX01 mostraba `2026-04-13 07:46` cuando el UTC real era `23:57` — atascado 16 horas por detrás de lo real. Eso alarma: ¿falló el restore?

Corriendo `timedatectl` dentro del guest reveló la causa raíz al momento:

```
Local time:            Mon 2026-04-13 07:46:13 UTC
Universal time:        Mon 2026-04-13 07:46:13 UTC
RTC time:              Mon 2026-04-13 23:57:31      ← reloj hardware CORRECTO
System clock synchronized: no
```

El **RTC** estaba bien — había sido tiempo real durante todo el run, porque KVM pasa el reloj del host a través del RTC hardware emulado independientemente de lo que hagamos con `date -s`. Pero el **system clock del kernel Linux** estaba atascado en cualquier fecha falsa que hubiéramos seteado por última vez, porque `systemd-timesyncd` todavía no había contactado con su servidor NTP upstream (la red tardó en levantarse, quizás una ventana de firewall, quizás el pool por defecto era inalcanzable).

El fix es trivialmente una línea: forzar la sincronización del system clock desde el RTC antes de tocar el daemon NTP:

```bash
hwclock --hctosys 2>/dev/null || true
# ... luego arranca systemd-timesyncd / chrony
```

Añadido a `LNX_RESTORE_SH` en `clock_control.py`. Idempotente, independiente de la red, siempre correcto porque el RTC siempre es correcto.

## Regenerando el dataset — siete VMs, tres dominios

Con los tres fixes commiteados (modelo touches_vms + round nocturno + restore hwclock), borré el snapshot antiguo `noisy-ad-2years`, rollback de los siete VMs a `pre-noise`, reseteé el checkpoint, y lancé el run completo otra vez.

El plan nuevo:

```
days:              730
rounds:            2132          (antes 1683, +27% por el round nocturno)
participants:      21521         (antes 8024, +168% por 7 VMs + 5 personas extra)
VMs touched:       7 / 7
domains covered:   sevenkingdoms + north + essos
```

Runtime total: **8h 32m** (vs 7h 34m del primer run). Los 58 min extra son el coste de cubrir tres VMs más — menos de lo esperado porque el paralelismo escala bien: dentro de cada round, todos los VMs tocados corren en worker threads en paralelo, así que añadir más VMs no multiplica el wall time linealmente.

## Verificación forense — la batería per-VM

Una vez terminó el segundo run, escribí un script `phase10-verify.py` que consulta artefactos forenses nativos en cada VM y los compara contra expectativas. No auto-checks de heartbeat — Windows Event Log real, metadata NTFS, scan de Prefetch. El tipo de cosas que un investigador haría el día uno.

Resultados clave por VM:

**VM 101 DC01-kingslanding** (DC raíz sevenkingdoms, `system.replication` + acceso admin de jon.snow):
- 3,333 markers (2,132 system + 1,201 jon.snow)
- Sysmon: **216,188** eventos
- Event 4616 (System time changed): **4,280** ← la firma del clock travel
- Primer marker: 2024-04-13, último: 2026-04-12 ✓

**VM 102 DC02-winterfell** (DC child north, antes 0 markers):
- 4,243 markers (2,132 system + 929 brandon + 1,182 robb)
- Sysmon: **254,684** eventos
- Firma 4616: **4,277** (antes eran 23, puro baseline de NTP)

**VM 103 SRV02-castelblack** (la más pesada, 4 humanas + system.backup):
- 4,636 markers
- Sysmon: **268,903**
- Checks narrativos todos exactos:
  - último evento de stannis.baratheon: **2025-09-15** (fecha exacta de su salida)
  - markers de catelyn.stark durante maternidad 2025-04-20 → 2025-10-14: **0**
  - último de catelyn pre-maternidad: 2025-04-17 ✓
  - primero de catelyn post-maternidad: 2025-10-16 ✓

**VM 104 DC03-meereen** (DC forest essos, antes 0 markers):
- 4,573 markers (2,132 system + 1,313 daenerys + 174 viserys + 954 khal)
- Sysmon: **231,066**
- Checks narrativos exactos:
  - primer evento de khal.drogo: **2024-06-03** (primer lunes tras su hire 2024-06-01 sábado)
  - último evento de viserys.targaryen: **2025-06-30** (fecha exacta de su jubilación)

**VM 105 SRV03-braavos** (ADCS, antes 0 markers):
- 2,132 markers (= total rounds, exacto — system.adcs dispara en cada round)
- Sysmon: **139,098**
- Security: **264,086**
- 4616: **4,282**

**VM 106 WS01-highgarden** (workstation de jon.snow):
- 1,201 markers, todos jon.snow
- Histograma día-de-semana: Lun 238, Mar 250, Mié 237, Jue 242, Vie 234, **Sáb 0, Dom 0** ← patrón workday-only perfecto
- Sysmon: 88,957 | Security: 150,596
- Ficheros Prefetch .pf con LastWrite en la ventana fake: **120** (Win10 tiene Prefetch habilitado, artefacto NTFS natural)

**VM 107 LNX01** (samwell + arya):
- 1,403 markers (823 samwell + 580 arya)
- primer evento de samwell: **2024-09-02** (primer lunes tras su hire 2024-09-01 domingo)
- **arya markers pre-promoción: 330** ← el fix del round nocturno funcionando
- arya markers post-promoción: 250
- **horas de arya pre-promoción: `['00', '22', '23']`** ← solo horas de turno nocturno
- horas de arya post-promoción: `['10', '11', '12', '13', '14', '16', '17', '18']` ← solo horas de turno de día

Las diez aserciones narrativas que prueban que la historia aguanta:

1. ✅ samwell.tarly contratado 2024-09-01 → primer evento **2024-09-02** (primer lunes)
2. ✅ khal.drogo contratado 2024-06-01 → primer evento **2024-06-03** (primer lunes)
3. ✅ viserys.targaryen jubilado 2025-06-30 → último evento **2025-06-30** exacto
4. ✅ catelyn.stark maternidad 2025-04-20 → 0 eventos en la ventana → primer post-evento **2025-10-16**
5. ✅ stannis.baratheon se fue 2025-09-15 → último evento **2025-09-15** exacto
6. ✅ arya.stark promocionada 2025-10-16 → turno cambia de 22-00 a 10-18 en esa fecha exacta
7. ✅ jon.snow solo workdays → 0 eventos Sáb/Dom en 730 días
8. ✅ Los tres DCs (101/102/104) tienen 4k+ de 4616 (firma clock travel)
9. ✅ Los tres DCs tienen 2,132 markers de system.replication = total rounds
10. ✅ SRV03 ADCS tiene exactamente 2,132 markers de system.adcs (uno por round, CRL nocturna)

## Cómo queda el dataset ahora

Tras la regeneración, el corpus forense completo vive en siete VMs abarcando 2024-04-13 hasta 2026-04-12:

- **~1.3 millones de eventos EVTX** backdateados entre Sysmon, Security, PowerShell y System log en los seis VMs Windows
- **~120 ficheros Prefetch `.pf` naturales** en WS01 con LastWrite en la ventana fake
- **21,521 ficheros sentinel marker** con NTFS CreationTimeUtc en la ventana fake, parseables per-persona
- **Cada DC del forest replicando todos los días** — ningún silencio sospechoso
- **Cada evento narrativo** (contratación, despido, promoción, maternidad, jubilación) reflejado en el event log con precisión diaria

## El problema del gap y el catchup rolling

Un snapshot estático de 2 años termina en el día X. El tiempo real sigue avanzando. Si vuelves a lanzar un ataque dos semanas después, el timeline forense muestra dos semanas de silencio entre el último evento narrativo y el primer evento del ataque. Eso es feo — y cuanto más esperas, más feo se pone. A seis meses, el gap se come cualquier cosa que produzca el ataque.

La solución es un catchup rolling: cuando el tiempo real avanza, extender la narrativa hacia delante por esos días extra para que el "último día" del dataset sea siempre "ayer". Dos decisiones de diseño importaron aquí.

**Primera: no tocar el snapshot pristine.** `noisy-ad-2years` se queda congelado para siempre como la baseline de referencia. Un segundo snapshot `noisy-ad-current` vive encima y es reemplazado por el catchup en cada ejecución. Si `noisy-ad-current` se corrompe, la siguiente pasada del cron lo recrea desde el estado pristine. Si en algún momento quieres resetear todo el lab a "snapshot de 2 años recién sacado de fábrica", haces rollback a `noisy-ad-2years` y el cron reconstruye `noisy-ad-current` en su próximo tick.

```
clean-ad → pre-noise → noisy-ad-2years → noisy-ad-current
                       ↑ nunca se toca   ↑ actualizado diariamente
```

**Segunda: phase10 se niega a correr con un override parcial.** El primer test del script de catchup murió con un bug de parseo de fechas que dejó una de las flags de override vacía. Sin red de seguridad, phase10 habría silenciosamente caído de vuelta al `start_date: 2024-04-13` por defecto, reconstruyendo el plan completo de 2 años desde cero e iterando 8 horas de rounds ya generados (escribiendo nuevos eventos 4616 de clock-change por el camino, contaminando el dataset). Eso pasó de verdad durante unos minutos antes de que lo matara, y me costó un rollback + reconstrucción de snapshot recuperarme. Tras ese incidente hice que `phase10.py` se niegue explícitamente a correr si `--extend-from` y `--extend-to` no vienen juntos, o si falta `--state-dir` cuando vienen.

La confianza es cara; el hard-fail es barato.

El script de catchup en sí es un wrapper bash de ~100 líneas que:

1. Consulta el marker más reciente en SRV02 para averiguar el último día narrado
2. Calcula "ayer UTC" como objetivo
3. Si hay gap, llama a `phase10.py` en modo ephemeral (`--state-dir /tmp/...`) con el rango de fechas exacto
4. Reemplaza el snapshot `noisy-ad-current` con el nuevo estado
5. Loguea todo en `/var/log/lab-catchup.log`

La programación es **una vez al día a las 03:00 UTC** vía `/etc/cron.d/lab-catchup`. Fuera de horas para el operador (05:00 CEST), y después de medianoche UTC para que "ayer" sea un día completo. La mayoría de ejecuciones generan exactamente 1 día de ruido en unos 90 segundos. Si el cron ha estado caído una semana, la siguiente ejecución genera 7 días en una sola invocación — idempotente y reanudable, la misma maquinaria que el run original completo.

**Comportamiento de Telegram**: silencio en éxito. Solo dispara pings cuando algo falla. Eso mantiene limpio el inbox de notificaciones y garantiza que cualquier mensaje significa "algo necesita atención ahora". Para verificar que el cron está vivo día a día:

```bash
tail -20 /var/log/lab-catchup.log
/root/lab/scripts/lab-catchup-status.sh    # resumen del gap, últimas ejecuciones
```

**Trigger manual** para cuando estás a punto de lanzar una sesión de ataque y quieres un gap de cero días:

```bash
ssh root@hetzner
/root/lab/scripts/lab-catchup.sh    # idempotente, ~3s si no hay nada que recuperar
```

Espera a que termine (éxito silencioso, o error por Telegram si falla), luego haces rollback de los VMs a `noisy-ad-current` para descartar cualquier drift del live state antes de lanzar Kali contra ellos. Los eventos del ataque caen un día después de la última entrada narrativa: un timeline forense continuo sin gap visible de recolección.

## Lo que viene

El scaffolding está completo, el dataset está validado, y el par de snapshots `noisy-ad-2years` + `noisy-ad-current` está listo para usarse.

**Matiz importante**: esto sigue siendo actividad stub. Cada tupla (persona, round) escribe un único fichero marker y una línea en heartbeat.log. Eso es suficiente para probar que el scaffolding funciona end-to-end Y para generar el ruido de fondo Sysmon/Security que Windows produce de forma natural cuando un proceso corre bajo el nombre de una persona. Pero NO es aún actividad realista a nivel de aplicación — jon.snow no abre documentos Word de verdad, samwell.tarly no hace push de commits git de verdad, y no hay historial de Chrome poblándose. Esos hooks son lo que cubrirá la Parte 9. La arquitectura es de lo que va la Parte 8.

La buena noticia: la infraestructura que acabamos de construir significa que añadir actividad real de persona es *solo* una reescritura de `lib/activities.py`. El bucle diario, el paralelismo, el checkpoint, el viaje en reloj, el calendario español, el modelo de personas tri-dominio, el workaround de wlms, el restore de hwclock, el soporte de turno nocturno, las alertas Telegram y la verificación forense per-VM están hechos y son reutilizables.

---

*Siguiente: [Parte 9 — Recolectando la Evidencia: Pipeline de Imagen Forense]({% post_url es/2026-04-15-ad-dfir-lab-part9-forensic-imaging %})*

*Anterior: [Parte 7.5 — Mantener vivos los Siete Reinos: Licencias Eval y Longevidad del Laboratorio]({% post_url es/2026-04-13-ad-dfir-lab-part7-5-licenses %})*
