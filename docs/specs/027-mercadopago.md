# Spec 027 — Confirmación automática de donaciones con Mercado Pago

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-30

## 1. Objetivo

Que la donación que declara un adoptante (spec 026, HU-12.3) se confirme sola cuando la
transferencia llega a la cuenta de Mercado Pago del refugio, sin que el refugio tenga que
revisarla a mano. El refugio conecta su cuenta una sola vez («Vincular Mercado Pago») y el
sistema busca, para cada donación Pendiente, la transferencia con el mismo monto hecha por el
mismo DNI. Lo que no se puede confirmar solo sigue el circuito manual de la spec 026.

## 2. Alcance

- **Incluye:**
  - Vincular y desvincular la cuenta de Mercado Pago del refugio por OAuth (con PKCE), desde
    «Perfil del refugio» en la app mobile.
  - Guardar los tokens del refugio cifrados, renovarlos antes de que venzan y detectar cuando
    dejan de valer.
  - Confirmación automática de donaciones por monto + DNI: al tocar «Terminar donación» y con
    un cron cada 5 minutos.
  - Marca «Confirmada por Mercado Pago» en «Revisar donaciones».
  - **DNI obligatorio** (§6.11): se pide en el registro (HU-1.1), se puede cargar una sola vez
    desde «Editar perfil», y si falta se pide al tocar «Terminar donación».
  - Actualizar la regla transversal 11 (decisión del equipo, §9).
- **NO incluye:**
  - Webhook de Mercado Pago (aviso inmediato): mejora posterior; la consulta periódica alcanza.
  - Vincular desde web-admin: la pantalla de refugio de web-admin sigue con datos de ejemplo.
  - Pedir el DNI al entrar a la app (pantalla obligatoria post-login): se pide sólo al donar.
  - Corregir un DNI ya cargado: lo hace un admin (HU-2.3), no el usuario.
  - «Desaplicar» una donación confirmada automáticamente.
  - Cobrar con Checkout Pro/API o cualquier pasarela: PetHood nunca procesa pagos, sólo lee
    las transferencias que recibe el refugio.

## 3. Entidades involucradas

Cambios sobre `docs/MODELO_DATOS.md`:

- **`Conexion_MercadoPago`** (nueva, 1 a 1 con `Refugio`, con los seis campos de auditoría):
  - `conexion_mp_id PK`, FK `refugio_id` NOT NULL **único**.
  - `conexion_mp_user_id` (texto): el `user_id` de la cuenta de Mercado Pago autorizada.
  - `conexion_mp_access_token` y `conexion_mp_refresh_token` (texto): **cifrados** con
    AES-256-GCM. Nunca se devuelven por la API ni se loguean.
  - `conexion_mp_vence` (fecha y hora): vencimiento del access token.
  - `conexion_mp_estado` (texto): `VINCULADA` | `REVINCULAR`.
  - Desvincular es baja lógica (`fecha_baja`) y además borra los dos tokens de la fila.
- **`Usuario`**: `usuario_dni` sigue nullable en la base (las cuentas existentes y las de
  Google no lo tienen); la obligatoriedad la imponen el registro y la app (§6.11).
- **`Donacion`**: suma `donacion_mp_pago_id` (texto, nullable, **único**): el id del pago de
  Mercado Pago que la confirmó. Nulo en las confirmadas a mano y en las Pendientes. Impide que
  una misma transferencia confirme dos donaciones.

**Variables de entorno nuevas** (`.env.example` y `config/env.ts`): `MP_CLIENT_ID`,
`MP_CLIENT_SECRET`, `MP_REDIRECT_URI` (la URL pública HTTPS del callback, registrada igual en
la aplicación de Mercado Pago), `MP_CLAVE_CIFRADO` (32 bytes en base64). Sin ellas el módulo
queda apagado: el botón no aparece y todo sigue manual.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/api/v1/refugio/mercadopago` | perfil REFUGIO | Estado de la conexión del refugio |
| POST | `/api/v1/refugio/mercadopago/vinculacion` | perfil REFUGIO | Arranca la vinculación: devuelve la URL de autorización |
| GET | `/api/v1/mercadopago/oauth/callback` | pública (la llama el navegador) | Retorno de Mercado Pago: canjea el código y guarda la conexión |
| DELETE | `/api/v1/refugio/mercadopago` | perfil REFUGIO | Desvincular |
| PATCH | `/api/v1/usuarios/me/dni` | cualquier usuario | Carga el DNI, sólo si todavía no tiene |

**Contrato completo:** [`docs/api-mercadopago.md`](../api-mercadopago.md) — cuerpos, respuestas,
errores con su mensaje literal, la página del callback, el cron y cómo configurar la aplicación
de Mercado Pago. Esta spec no lo repite para que no haya dos versiones que se desincronicen.

## 5. Pantallas (frontend mobile)

- **Perfil del refugio (`app/perfil/refugio.tsx`) — tarjeta «Mercado Pago»:**
  - No vinculada: «Vinculá tu cuenta de Mercado Pago para que las donaciones se confirmen
    solas.» + botón «Vincular Mercado Pago» (abre la URL en el navegador del teléfono).
  - Vinculada: «Vinculada el 30/09/2026» + «Desvincular» (con modal de confirmación).
  - Revincular: «Mercado Pago dejó de aceptar la conexión. Volvé a vincularla.» + botón.
  - Al volver a la app (foco), recarga el estado.
  - No aparece si `disponible` es `false`.
- **Donar (spec 026):** antes del alias y el CBU pregunta **«¿Desde dónde vas a transferir?»**
  (Mercado Pago / Otro banco o billetera); «Terminar donación» se habilita recién al elegir. La
  nota depende de la respuesta: Mercado Pago con el refugio vinculado → «Se confirma sola en
  unos minutos.»; otro banco → «El refugio va a revisar que la transferencia haya llegado y la
  va a confirmar.»; Mercado Pago sin vincular → el texto de la spec 026. Al tocar «Terminar donación» sin DNI cargado, un cartel lo pide («Para registrar tu
  donación necesitamos tu DNI.», campo DNI y «Guardar y donar»): lo guarda con
  `PATCH /usuarios/me/dni` y sigue con la donación. Si la respuesta vuelve `Realizada`: toast
  «¡Listo! Tu donación ya se sumó a la campaña.».
- **Registro (GUI-01):** suma el campo DNI, obligatorio, sólo números, 7 u 8 dígitos.
- **Editar perfil (GUI-15):** suma el campo DNI. Sin DNI, editable, y se guarda junto con el
  resto; con DNI, de solo lectura con la aclaración «Para corregirlo, escribinos desde Soporte.».
- **Perfil (pestaña):** el aviso «Completá tu perfil…» también aparece si falta el DNI.
- **Revisar donaciones (spec 026):** las `confirmadaPorMercadoPago` llevan la marca «Confirmada
  por Mercado Pago».

## 6. Reglas de negocio y validaciones

0. **Sólo se confirman solas las donaciones con origen `MERCADO_PAGO`** (§9, decisión 8). Las
   de `OTRO_BANCO` no se consultan a Mercado Pago (ni al donar, ni en los reintentos, ni en el
   cron) y quedan Pendientes para el refugio.
1. **Match** de una donación Pendiente con un pago de Mercado Pago, todo a la vez:
   - pago `approved`;
   - `transaction_amount` igual al monto de la donación (exacto, con centavos);
   - DNI del donante (`usuario_dni`) igual al DNI del pagador: si viene CUIL/CUIT, los 8
     dígitos del medio sin ceros a la izquierda; si viene DNI, tal cual;
   - `date_created` del pago entre 24 h antes y 72 h después del alta de la donación (el
     adoptante transfiere antes de tocar «Terminar donación»);
   - el pago no confirmó otra donación (`donacion_mp_pago_id` único).
2. **Consulta mínima:** `GET /v1/payments/search` con el token del refugio de la campaña,
   filtrada **del lado de Mercado Pago** por `transaction_amount` y rango de fechas (verificado
   en el spike). El DNI se compara en el backend sólo sobre esos resultados. Los pagos que no
   matchean no se guardan ni se loguean.
3. **Varias donaciones Pendientes que matchean el mismo pago** (mismo donante, mismo monto): se
   confirma la más vieja. El siguiente pago igual confirma la siguiente.
4. **No se intenta** si el refugio no está `VINCULADA`, si el donante no tiene DNI o si la
   donación ya salió de la ventana: queda para el refugio, a mano (spec 026).
5. **Cuándo se intenta:**
   - al crear la donación, dentro del mismo pedido, con un tope de 5 segundos a Mercado Pago;
     si no responde o no encuentra nada, la donación queda Pendiente sin error para el usuario;
   - **en segundo plano, para esa donación** (`campanias.reintentos.ts`): si el refugio está
     vinculado y no se encontró en el acto, se vuelve a buscar 3 veces cada 30 s y después al
     minuto, a los 2 y a los 5 (cada espera desde el intento anterior: 30 s, 1 min, 1 min 30 s,
     2 min 30 s, 4 min 30 s y 9 min 30 s desde el botón), y se corta al confirmar. Cubre el caso habitual de la transferencia que se acredita un rato
     después de «Terminar donación», sin hacer esperar al usuario. No retiene el proceso y no
     sobrevive a un reinicio: para eso está el cron (decisión del equipo, 2026-10-06);
   - en `src/jobs/conciliar-donaciones-mp.job.ts`, cada 5 minutos, para las Pendientes dentro
     de la ventana de refugios vinculados (respaldo).
6. **Confirmar** es la misma transición que aplicar a mano (Pendiente → Realizada, escritura
   condicional), con `usuario_modificacion = SISTEMA`, `donacion_mp_pago_id` y `LogAuditoria`.
   Si completa el objetivo, finaliza la campaña (spec 026 §6.7).
7. **El refugio** sigue pudiendo aplicar o rechazar a mano cualquier Pendiente. Si la rechaza,
   el cron ya no la toca.
8. **Tokens:** el mismo cron renueva (`grant_type=refresh_token`) los que vencen en menos de 30
   días y guarda el `refresh_token` nuevo (cambia en cada renovación). Si Mercado Pago responde
   401/403 con un token, la conexión pasa a `REVINCULAR` y se deja de intentar.
9. **Seguridad:** `state` firmado y con vencimiento (no hace falta guardarlo: el código de
   Mercado Pago ya es de un solo uso y PKCE ata el canje a quien empezó la vinculación), tokens
   cifrados en reposo, ninguna respuesta ni log incluye tokens; el callback no confía en nada
   que no venga en el `state`.
10. **Vincular y desvincular** escriben `LogAuditoria`.
11. **DNI obligatorio:** 7 u 8 dígitos numéricos, único. Obligatorio en el registro. Un usuario
    sin DNI lo carga una sola vez (`PATCH /usuarios/me/dni`); con DNI cargado, responde
    `DNI_YA_CARGADO` y sólo lo corrige un admin (es la identidad que valida HU-2.3 y la que se
    usa para el match). Donar exige tener DNI: la app lo pide antes, y el backend responde
    `DNI_REQUERIDO` (409, «Cargá tu DNI para donar.») si llega una donación sin él. Cargarlo
    escribe `LogAuditoria`.

## 7. Criterios de aceptación

- [ ] Un refugio vincula su cuenta desde «Perfil del refugio» y la tarjeta pasa a «Vinculada».
- [ ] Un `state` vencido o alterado, o un código ya usado, responde la página de error y no
      guarda nada.
- [ ] Los tokens quedan cifrados en la base y no aparecen en ninguna respuesta ni log.
- [ ] Con el refugio vinculado, un adoptante con DNI transfiere $X desde una cuenta a su
      nombre, toca «Terminar donación» con $X y la donación queda `Realizada` en el acto, con
      `donacion_mp_pago_id` y usuario SISTEMA.
- [ ] Si la transferencia se acredita después, el cron la confirma en su siguiente corrida.
- [ ] Un pago de otro monto, de otro DNI o fuera de la ventana no confirma nada.
- [ ] Un mismo pago no confirma dos donaciones.
- [ ] Con el refugio sin vincular, la donación queda Pendiente y el refugio la resuelve a mano
      como en la spec 026.
- [ ] El registro sin DNI, o con un DNI que no tiene 7 u 8 dígitos, se rechaza.
- [ ] Un usuario sin DNI lo carga desde «Editar perfil» o desde el cartel de «Donar», y después
      ya no lo puede cambiar (`DNI_YA_CARGADO`); un DNI de otro usuario da `DNI_DUPLICADO`.
- [ ] Donar sin DNI responde `DNI_REQUERIDO`.
- [ ] Desvincular borra los tokens y vuelve todo a manual.
- [ ] Un token revocado deja la conexión en «Revincular» sin romper el cron.
- [ ] Sin las variables de entorno de Mercado Pago, la app funciona como en la spec 026.

## 8. Casos borde y errores

- **Mercado Pago caído o lento** al donar: la donación se crea igual (Pendiente); lo retoma el
  cron.
- **El adoptante declara un monto distinto al transferido:** no matchea; el refugio la
  rechaza con «El monto no coincide» (spec 026).
- **Transferencia desde la cuenta de otra persona** (pareja, familiar): no matchea por DNI;
  queda manual.
- **El alias de la campaña es de otra cuenta** que la vinculada: nunca matchea; queda manual.
- **Dos miembros del refugio vinculan a la vez:** gana el último callback; la conexión es una
  por refugio.
- **Carrera entre el cron y el refugio** resolviendo la misma Pendiente: la escritura es
  condicional; quien llega segundo no cambia nada.

## 9. Notas y decisiones

1. **2026-09-30 — Spike (resultado):** con una cuenta real, una transferencia bancaria a CVU
   (`account_fund` / `bank_transfer` / `cvu`) y una de Mercado Pago a Mercado Pago
   (`money_transfer` / `account_money`) aparecieron al instante en `/v1/payments/search`,
   `approved`, con el monto exacto y el CUIL del pagador. La búsqueda filtra por
   `transaction_amount` del lado del servidor; por documento del pagador no (400). El nombre del
   pagador no viene.
2. **2026-09-30 — Equipo:** las donaciones confirmadas por Mercado Pago **suman solas**; el
   refugio las acepta a mano sólo cuando no se pudieron confirmar. Reemplaza la regla
   transversal 11: se actualiza en `CONSTITUTION.md`, `REQUISITOS.md` §8.9 y `AGENTS.md`.
3. **2026-09-30 — Equipo:** vinculación por **OAuth** (opción A), no pegando tokens: el refugio
   no tiene que crear nada en Mercado Pago Developers y la conexión se puede revocar y renovar.
4. **Match por DNI + monto**, sin centavos únicos: el adoptante dona montos redondos.
5. **2026-09-30 — Equipo: el DNI pasa a ser obligatorio** (opción A): en el registro, como ya
   decía HU-1.1; para las cuentas existentes y las de Google, se pide al donar, que es donde
   hace falta, sin bloquear el resto de la app. Se carga una sola vez; la corrección la hace
   un admin. No existía forma de cargarlo desde el perfil.
6. **Consulta periódica y no webhook** para la primera versión: no depende de que Mercado Pago
   llegue a una URL pública, y el spike mostró que la acreditación es instantánea.
7. **Prueba de punta a punta:** requiere una URL pública HTTPS para el callback (ngrok en
   desarrollo o Render), registrada en la aplicación de Mercado Pago Developers, y el permiso
   `offline_access` habilitado para la renovación.
8. **2026-10-06 — Prueba real + equipo: sólo Mercado Pago → Mercado Pago se confirma solo.** En
   una transferencia desde otro banco o billetera (Naranja X, `account_fund` / `bank_transfer`
   / `cvu`), Mercado Pago informa como pagador (`payer.id` y `payer.identification`) **al dueño
   de la cuenta que recibe**, y ningún otro campo del pago trae al que transfirió. El match por
   DNI no puede funcionar para esas. Por eso «Donar» pregunta el origen
   (`donacion_origen`: `MERCADO_PAGO` | `OTRO_BANCO`), sólo se buscan las de Mercado Pago, y el
   refugio ve el origen en «Revisar donaciones» para saber cuáles tiene que aplicar a mano. La
   alternativa de centavos únicos para otros bancos queda como deuda.
