---
layout: post
title: "AD DFIR Lab — Parte 7.5: Mantener vivos los Siete Reinos — Licencias Eval y Longevidad del Laboratorio"
date: 2026-04-13 14:00:00 +0100
category: cases
lang: es
ref: case-ad-dfir-lab-part7-5
tags: [dfir, lab, windows, licencias, proxmox, telegram]
description: "Las evaluaciones de Windows consumen tiempo de reloj real, no de ejecución. Un test empírico sobre una VM Win10 eval, los límites de rearm en Server 2019 y Win10, y un sistema de alertas Telegram para el laboratorio."
comments: true
---

*Este es un interludio de la serie [AD DFIR Lab]({% post_url es/2026-04-12-ad-dfir-lab-intro %}). Un post operativo corto sobre cómo mantener el laboratorio vivo durante años en lugar de meses.*

## La pregunta que no tenía respuesta obvia

Planificando la Fase 10 (generar dos años de actividad histórica sintética) surgió una duda práctica: *¿qué pasa dentro de 6 meses cuando expire la evaluación de Windows?* Todo el bosque está construido sobre ISOs eval. Server 2019 dura 180 días. Win10 Enterprise, 90. Y la intención es mantener este laboratorio vivo durante años.

La sabiduría popular dice: "apaga las VMs cuando no las uses, el tiempo de evaluación solo se consume mientras están encendidas". No encontré una respuesta definitiva en ningún sitio, así que lo medí.

## Test empírico: reloj real vs tiempo de ejecución

VM 106 (`highgarden`, Win10 Enterprise Eval) fue el conejillo de indias. La consulta es este PowerShell:

```powershell
$p = Get-WmiObject -Class SoftwareLicensingProduct |
     Where-Object { $_.PartialProductKey -and $_.LicenseStatus -ne 0 } |
     Select-Object -First 1
[math]::Floor($p.GracePeriodRemaining / 1440)  # días
$p.GracePeriodRemaining                         # minutos (valor crudo)
```

El protocolo:

```
12:19:00  Baseline:     128506 minutos restantes
12:19:07  qm stop 106
          (VM completamente apagada — no suspendida, no hibernada)
12:29:25  qm start 106  (exactamente 10 minutos después)
          Esperar al guest agent...
          Leer minutos de nuevo: 128496
```

**Delta: -10 minutos.** Coincidencia exacta con el tiempo de reloj transcurrido. Tener la VM apagada no ahorró ni un minuto.

**Conclusión**: Windows guarda una fecha absoluta de expiración (`install_date + eval_period`) y la compara con la hora actual del sistema en cada verificación. Que la VM esté corriendo o parada da igual. Las únicas formas de ganar más tiempo son `slmgr /rearm` y **viajar hacia atrás en el reloj** — que es exactamente lo que la Fase 10 va a hacer por otras razones (generar dos años de historia falsa).

Este descubrimiento cambió por completo mi visión sobre la vida útil esperada del laboratorio.

## Límites de rearm y vida útil real

```
Server 2019/2016   →  180 d inicial + 6 × 180 d  ≈  3.4 años
Win10 Enterprise   →   90 d inicial + 2 ×  90 d  ≈  9 meses
```

Windows 10 es el cuello de botella. Y "9 meses" es siendo generoso — asumiendo que no te descuidas con los rearms.

Hay un matiz importante: **Win10 eval degrada mejor que Server eval**. Cuando Server 2019 expira entra en "Notification Mode" y se apaga solo cada hora — inutilizable. Win10 eval simplemente pone el fondo de escritorio negro, añade una marca de agua "not genuine" y molesta una vez por hora. RDP, WinRM, Sysmon, los servicios, la pertenencia al dominio — todo sigue funcionando. Para un laboratorio DFIR donde Kali ataca desde fuera y tú analizas EVTX después, un fondo negro no es un problema.

Así que la estrategia real se parte en dos:

- **VMs Server** → rearm según calendario, no dejar que expiren nunca
- **WS01 (Win10)** → rearm mientras se pueda, reemplazar con una VM fresca cuando no

## Los scripts de monitorización

Dos scripts Bash pequeños viven en el host Proxmox y hablan con los guests vía el QEMU guest agent. El guest agent es el transporte adecuado para esto: sin red, sin dependencia del reloj, sin SSH, funciona independientemente del estado del AD.

`scripts/lab-license-status.sh` — check de sólo lectura, seguro para correr a diario:

```
VMID  NAME                   STATE      DAYS REMAINING  EXPIRES ON   STATUS
------------------------------------------------------------------------------------
101   kingslanding           running    178 days        2026-10-08   OK
102   winterfell             running    178 days        2026-10-08   OK
103   meereen                running    178 days        2026-10-08   OK
104   castelblack            running    178 days        2026-10-08   OK
105   braavos                running    178 days        2026-10-08   OK
106   highgarden             running     89 days        2026-07-11   OK
```

`scripts/lab-license-rearm.sh` — rearm individual, global o sólo consulta:

```bash
./lab-license-rearm.sh check     # sólo lectura, muestra rearms restantes por VM
./lab-license-rearm.sh 101       # rearm DC01 (confirma, reinicia)
./lab-license-rearm.sh all       # rearm todas las VMs Windows
```

El rearm requiere un reinicio para surtir efecto, así que el script reinicia el guest y espera a que el agente vuelva antes de leer el nuevo estado.

## Alertas por Telegram

La tercera pieza es un wrapper con niveles, `scripts/lab-license-alert.sh`, que corre desde cron y envía un mensaje de Telegram cuando alguna VM cruza uno de estos umbrales:

```
30  15  10  5  4  3  2  1   días restantes
```

Dos detalles de diseño merecen mención:

1. **Fichero de estado anti-spam**. Cada VM tiene una línea en `/root/lab/state/license-alert-state` con `(vmid, ultimo_umbral, ultimos_dias, ultimos_rearms)`. Una alerta sólo se dispara cuando la VM cruza un umbral *más bajo* que la última vez. Si haces un rearm y los días suben, el estado se resetea — así que la próxima vez que baje a 30 días vuelves a recibir aviso.

2. **Alerta de rearms agotados**. Independiente del umbral de días, la primera vez que una VM llega a `RemainingAppReArmCount == 0`, dispara un mensaje aparte. Esa es la señal para programar el reemplazo o aceptar el modo eval degradado.

Entrada en cron:

```cron
0 9 * * * root /root/lab/scripts/lab-license-alert.sh >> /var/log/lab-license.log 2>&1
```

La configuración vive en `/root/lab/config/telegram.conf` (gitignoreado):

```bash
TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIjKlMnOpQrStUvWxYz"
TELEGRAM_CHAT_ID="123456789"
```

Y un bot creado vía `@BotFather` en Telegram. La llamada curl es JSON plano:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    -d chat_id="${CHAT_ID}" \
    -d parse_mode="Markdown" \
    --data-urlencode text="$MENSAJE"
```

### Montarlo en tu propio laboratorio

Si estás siguiendo la serie y quieres estas mismas alertas, **necesitas tu propio bot** — un bot de Telegram sólo puede enviar mensajes a `chat_id`s que previamente le han escrito, así que el token del mío no le sirve a nadie más (y compartirlo sería una fuga de credenciales de todos modos). El alta son cinco minutos:

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot` → elige un nombre visible y un username que acabe en `bot` → copia el token que te devuelve.
2. Abre el chat con tu bot recién creado y envíale cualquier mensaje (`/start`, `hola`, lo que sea). Telegram no te dará un `chat_id` para un usuario que nunca le ha hablado al bot.
3. Desde Proxmox, consulta una vez el endpoint de updates para leer tu propio chat id:
   ```bash
   TOKEN="<tu-token>"
   curl -sS "https://api.telegram.org/bot${TOKEN}/getUpdates" | jq '.result[].message.chat.id'
   ```
4. Mete `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en `/root/lab/config/telegram.conf`, hazle `chmod 600`, e instala la línea de cron de la sección anterior.

Si quieres que las alertas lleguen a un equipo entero, crea un grupo de Telegram, mete a tu bot dentro, y usa el chat id (negativo) del grupo en la config — el mismo script envía a grupos sin cambiar una línea de código.

Lo que **no** vas a poder hacer es suscribirte al bot de *mi* laboratorio para recibir alertas sobre *mi* laboratorio. Es intencional: un bot compartido obligaría a publicar el token, permitiría a cualquiera rate-limitearlo o spamear el canal, y mezclaría laboratorios no relacionados en el mismo flujo de alertas. Un bot por laboratorio es el modelo seguro más simple.

## Reemplazo de WS01, preparado por adelantado

Cuando Win10 agote los rearms, no queremos reconstruirlo a mano. `scripts/replace-ws01.sh` es un one-shot: le pasas el nombre de una ISO Win10 fresca, destruye la VM 106, la recrea con el mismo VMID/RAM/disco/VLAN, arranca instalación desatendida con el autounattend ISO preconstruido, espera al escritorio, pide una vez la instalación manual de `virtio-win-guest-tools.exe` por VNC (que aún no se puede automatizar — ver Parte 2), y luego configura hostname + IP estática + DNS. Los dos últimos pasos (`ansible-playbook 07.5-join-extras.yml --limit ws01` y la reaplicación del audit) son manuales porque usan los mismos playbooks documentados en partes anteriores — no duplicamos.

El resultado es una operación de "reconstruir WS01" de ~25 minutos en lugar de una tarde haciendo click en el instalador de Windows.

## Conclusión

Tres cosas de este desvío:

- **El tiempo eval es reloj real**, verificado empíricamente. No confíes en apagar VMs para ahorrarlo.
- **Win10 es el cuello de botella** (~9 meses) pero degrada bien — puedes convivir con una eval expirada.
- **Instrumenta desde el principio**: tener alertas desde el día uno significa que nunca te enteras de una expiración intentando hacer login.

Con esto zanjado, la Fase 10 (generación de ruido histórico con viaje hacia atrás en el reloj) viene a continuación.

---

*Siguiente: [Parte 8 — Un Día en el Reino: Generando Dos Años de Ruido Histórico]({% post_url es/2026-04-13-ad-dfir-lab-part8-historical-noise %})*

*Anterior: [Parte 7 — El Rey de la Noche se Alza: Kali como Plataforma de Ataque]({% post_url es/2026-04-13-ad-dfir-lab-part7-kali %})*
