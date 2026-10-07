# Contrato de API — Mercado Pago y DNI

Endpoints de la **spec 027** (confirmación automática de donaciones con Mercado Pago y DNI obligatorio). Alcance, reglas y criterios de aceptación: [spec 027](specs/027-mercadopago.md). Las campañas y donaciones en sí están en [`api-campanias.md`](api-campanias.md).

> Este documento describe **solo lo que el backend expone**. PetHood nunca cobra ni procesa pagos: sólo lee las transferencias que recibe cada refugio en su cuenta de Mercado Pago, con el permiso que el refugio le da al vincularla.

---

## Convenciones comunes

Iguales a `api-campanias.md`: base `{EXPO_PUBLIC_API_URL}/api/v1`, `Authorization: Bearer <token>`, `X-Ambito`, errores `{ error: { codigo, mensaje } }` con el `mensaje` listo para el toast.

**Módulo apagado:** si faltan `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` o `MP_CLAVE_CIFRADO` en el `.env`, `GET /refugio/mercadopago` responde `disponible: false`, la vinculación responde 503 `MP_NO_DISPONIBLE` y todas las donaciones se confirman a mano (spec 026).

---

## `GET /api/v1/refugio/mercadopago` — Estado de la conexión

Perfil **REFUGIO** (rol `MIEMBRO_REFUGIO`).

```json
{ "disponible": true, "estado": "VINCULADA", "fechaVinculacion": "2026-09-30T12:00:00.000Z" }
```

| `estado` | Qué significa |
| --- | --- |
| `NO_VINCULADA` | El refugio nunca vinculó su cuenta, o la desvinculó |
| `VINCULADA` | Las donaciones se confirman solas |
| `REVINCULAR` | Mercado Pago dejó de aceptar el token (revocado o vencido): hay que volver a vincular |

Errores: `403 SIN_REFUGIO`, `403 AMBITO_NO_PERMITIDO`.

## `POST /api/v1/refugio/mercadopago/vinculacion` — Empezar a vincular

Perfil **REFUGIO**. Sin body. Devuelve la URL de autorización de Mercado Pago, que la app abre en el navegador del teléfono:

```json
{ "url": "https://auth.mercadopago.com/authorization?client_id=…&response_type=code&platform_id=mp&state=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256" }
```

El `state` es un JWT firmado que vence a los **10 minutos** y lleva el refugio, el usuario y el verificador PKCE cifrado. Errores: `503 MP_NO_DISPONIBLE`, `403 SIN_REFUGIO`.

## `GET /api/v1/mercadopago/oauth/callback` — Retorno de Mercado Pago

**Público**: lo abre el navegador cuando el refugio autoriza en Mercado Pago. Query: `code`, `state`. Responde **HTML**, no JSON:

- **200:** «Listo, ya vinculaste Mercado Pago. Podés volver a PetHood.»
- **400 `VINCULACION_INVALIDA`:** «El enlace de vinculación venció o no es válido. Volvé a intentarlo desde la app.» (state vencido o alterado, código ya usado o faltante). No se guarda nada.
- **503 `MP_NO_DISPONIBLE`:** módulo apagado.

Si el refugio ya tenía una conexión, la reemplaza.

## `DELETE /api/v1/refugio/mercadopago` — Desvincular

Perfil **REFUGIO**. **204** sin cuerpo. Borra los tokens de la base (baja lógica de la conexión); desde ahí las donaciones se confirman a mano.

## `PATCH /api/v1/usuarios/me/dni` — Cargar el DNI

Cualquier usuario autenticado. Body: `{ "dni": "30123456" }`. Devuelve `{ "usuario": <perfil> }` (el mismo de `GET /usuarios/me`, que ahora incluye `dni`).

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «El DNI es obligatorio.» / «El DNI debe tener 7 u 8 dígitos numéricos.» |
| `DNI_YA_CARGADO` | 409 | «Tu DNI ya está cargado. Si hay un error, escribinos desde Soporte.» |
| `DNI_DUPLICADO` | 409 | «Ya existe una cuenta con ese DNI.» |

**Registro:** `POST /auth/registro` exige ahora `dni` (mismas reglas).

---

## Cambios en campañas y donaciones

- **Campaña** suma `confirmacionAutomatica: boolean` (su refugio tiene Mercado Pago vinculado).
- **Donación** suma `confirmadaPorMercadoPago: boolean` y `origen: 'MERCADO_PAGO' | 'OTRO_BANCO' | null`.
- **Sólo las donaciones con origen `MERCADO_PAGO` se confirman solas.** En una transferencia desde otro banco o billetera, Mercado Pago informa como pagador al dueño de la cuenta que recibe: no hay forma de saber quién transfirió (spec 027 §9, decisión 8).
- **`POST /campanias/:id/donaciones`** puede devolver la donación ya `Realizada` si la transferencia estaba acreditada, y responde `409 DNI_REQUERIDO` («Cargá tu DNI para donar.») si el usuario no tiene DNI.

## Cómo se confirma una donación sola

Pago `approved` + mismo monto (centavos incluidos) + DNI del donante igual al del CUIL/CUIT/DNI del pagador + pago hecho entre 24 h antes y 72 h después de «Terminar donación» + pago no usado por otra donación. Se intenta al donar (tope de 5 s); si no aparece, se reintenta en segundo plano para esa donación 3 veces cada 30 s y después al minuto, a los 2 y a los 5 (30 s, 1 min, 1 min 30 s, 2 min 30 s, 4 min 30 s y 9 min 30 s desde el botón); y, como respaldo, en el cron `src/jobs/conciliar-donaciones-mp.job.ts`, cada 5 minutos, que además renueva los tokens que vencen en menos de 30 días:

```
*/5 * * * * cd /ruta/al/repo && node dist/jobs/conciliar-donaciones-mp.job.js
```

## Configurar la aplicación de Mercado Pago

1. En [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app), la aplicación del proyecto (una sola para todos los refugios) con credenciales de producción activadas.
2. En su configuración, **URL de redireccionamiento** = `MP_REDIRECT_URI`, exactamente igual: `https://<host público>/api/v1/mercadopago/oauth/callback`. Habilitar el permiso **`offline_access`** (sin él no hay renovación de tokens).
3. En `.env`: `MP_CLIENT_ID` y `MP_CLIENT_SECRET` de «Credenciales de producción», `MP_REDIRECT_URI` y `MP_CLAVE_CIFRADO` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). **No cambiar la clave** una vez que hay refugios vinculados: sus tokens dejarían de poder descifrarse y tendrían que volver a vincular.

**En desarrollo:** Mercado Pago exige HTTPS, así que el callback necesita una URL pública. Con `ngrok http 3000`, usar la URL `https://….ngrok-free.app/api/v1/mercadopago/oauth/callback` como `MP_REDIRECT_URI` y registrarla igual en la aplicación.

## Pendiente

- **Webhook:** hoy la confirmación de una transferencia que llega después de «Terminar donación» tarda hasta 5 minutos (deuda 37).
- **Vincular desde web-admin.**
