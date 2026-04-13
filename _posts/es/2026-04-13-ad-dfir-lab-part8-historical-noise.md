---
layout: post
title: "AD DFIR Lab — Parte 8: Un Día en el Reino — Generando Dos Años de Ruido Histórico"
date: 2026-04-13 18:30:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part8
tags: [dfir, lab, active-directory, forensics, python, proxmox]
description: "Dos años de actividad corporativa sintética sobre un AD limpio, usando viaje hacia atrás en el reloj, un planner día-como-iteración, calendario español con vacaciones y eventos narrativos, y un traspié brutal con wlms.exe de Windows que apagó tres VMs a mitad del run."
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

## Lo que viene

El run completo está en progreso mientras escribo esto. Cuando acabe, el snapshot `noisy-ad-2years` se tomará, NTP se restaurará en cada VM, y un ✅ final llegará a Telegram.

**Matiz importante**: esta primera pasada usa actividades stub. Cada tupla (persona, round) escribe un único fichero marker y una línea en heartbeat.log. Eso es suficiente para probar que el scaffolding funciona end-to-end con calendar/personas/planner/checkpoint/paralelismo, pero NO es aún actividad realista persona-driven — jon.snow no abre documentos Word de verdad, samwell.tarly no hace push de commits git de verdad, y no hay historial de Chrome poblándose. Esos hooks son lo que cubrirá la Parte 9. La arquitectura es de lo que va la Parte 8.

La buena noticia: la infraestructura que acabamos de construir significa que añadir actividad real de persona es *solo* una reescritura de `lib/activities.py`. El bucle diario, el paralelismo, el checkpoint, el viaje en reloj, el calendario español, el workaround de wlms y las alertas Telegram están hechos y son reutilizables.

---

*Siguiente: Parte 9 — Fuego y Sangre: Escenarios de Ataque y Análisis Forense (próximamente)*

*Anterior: [Parte 7.5 — Mantener vivos los Siete Reinos: Licencias Eval y Longevidad del Laboratorio]({% post_url es/2026-04-13-ad-dfir-lab-part7-5-licenses %})*
