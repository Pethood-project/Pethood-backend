# Contrato de API — Campañas de donación

Endpoints de **HU-12.1 a HU-12.7 (Campañas de Recaudación)**, listos para consumir desde `pethood-frontend`. Están implementados, testeados y verificados contra el servidor local con las campañas del seed. Alcance, reglas y criterios de aceptación: [spec 026](specs/026-campanias.md). Editar, pausar y eliminar: [spec 028](specs/028-editar-campanias.md).

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md` y de la spec.

Pantallas que los consumen (app mobile): **GUI-13 Campañas Adoptante** (pantalla 13 del prototipo), **GUI-36 Campañas Refugio** (pantalla 21), **GUI-37 Crear Campaña** (pantalla 27), y dos que no están en el prototipo: **Donar** y **Revisar donaciones**.

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1`.

**Autenticación:** todos los endpoints la exigen.

```
Authorization: Bearer <token>
X-Ambito: PERSONAL | REFUGIO
```

- Las rutas bajo `/campanias` (portal y donar) exigen el perfil **PERSONAL**: desde el perfil de refugio no se dona. El detalle (`GET /campanias/:id`) sirve desde cualquier perfil.
- Las rutas bajo `/refugio/...` exigen el rol `MIEMBRO_REFUGIO` **y** el perfil **REFUGIO**. Una campaña o donación de otro refugio responde **404**, no 403, para no revelar que existe.

**Formato de error**, siempre el mismo:

```json
{ "error": { "codigo": "LIMITE_CAMPANIAS", "mensaje": "Alcanzaste el límite de 5 campañas activas. Finalizá o eliminá una para crear otra" } }
```

El `mensaje` viene en español con voseo y **se puede mostrar tal cual en el toast**.

**Paginación por cursor** (todos los listados): `cursor` es el id del último elemento que el cliente ya tiene (ausente = primera página) y `limite` el tamaño de página. La respuesta trae `hayMas` y `proximoCursor`, sin `total`. Un `cursor` que no existe responde `400 CURSOR_INVALIDO`.

**Fechas:** `fechaInicio` y `fechaFin` van como `AAAA-MM-DD` (sin hora). `fechaAlta` de una donación, en ISO 8601 completo.

**Montos:** números en pesos. En los bodies se aceptan como texto con coma o punto decimal (`"1500,50"`).

---

## La campaña

Igual en el portal, en el detalle y en «Mis Campañas»:

```json
{
  "id": 4,
  "titulo": "Castraciones de primavera",
  "descripcion": "Queremos castrar 80 animales del barrio antes de que arranque la temporada de celo.",
  "imagenUrl": "/api/v1/archivos/campanias/c6bd552f.webp",
  "objetivo": 250000,
  "recaudado": 51500.5,
  "porcentaje": 20,
  "donantes": 5,
  "fechaInicio": "2026-04-01",
  "fechaFin": "2026-11-29",
  "estado": { "id": 2, "nombre": "Activa" },
  "alias": "patitas.castra.mp",
  "cbu": "0000003100012345678901",
  "refugio": { "id": 1, "nombre": "Refugio Patitas", "imagenUrl": null }
}
```

| Campo | Qué es |
| --- | --- |
| `recaudado` | Suma de las donaciones **Realizada**: lo único que mueve la barra (regla transversal 11). Puede superar el objetivo. |
| `porcentaje` | 0 a 100, hacia abajo y topeado en 100. Listo para la barra. |
| `donantes` | Usuarios distintos con al menos una donación Realizada. |
| `alias` / `cbu` | Al menos uno viene cargado (salvo campañas sembradas antes de la spec 026). |
| `imagenUrl` | Ruta relativa: pasarla por `urlAbsoluta`. `null` sólo en campañas viejas del seed. |

En «Mis Campañas» cada campaña suma **`pendientes`** (cuántas donaciones esperan revisión) y **`tieneDonaciones`** (alguien avisó que donó, en cualquier estado: si es `true`, no se puede eliminar).

Estados (`estado.nombre`): `Inactiva` (todavía no empezó), `Activa`, `Pausada` (no se muestra en el portal ni recibe donaciones), `Finalizada`. `Cancelada` dejó de existir (spec 028): las que había pasaron a `Finalizada`.

## La donación

```json
{
  "id": 22,
  "monto": 1500.5,
  "estado": { "id": 1, "nombre": "Pendiente" },
  "motivoRechazo": null,
  "fechaAlta": "2026-09-30T14:08:09.345Z",
  "donante": { "id": 2, "nombre": "Ana", "apellido": "Gomez", "imagenUrl": null }
}
```

Estados: `Pendiente` (declarada, no suma), `Realizada` (el refugio la aplicó, suma), `Cancelada` (rechazada, con `motivoRechazo`: `NO_RECIBIDA` | `MONTO_NO_COINCIDE`).

---

## `GET /api/v1/campanias` — Portal del adoptante (HU-12.2)

Perfil **PERSONAL**. Campañas **Activa** de todos los refugios, de la más reciente a la más vieja.

**Query:** `cursor?`, `limite?` (1–50, por defecto 20).

**Respuesta 200:** `{ "campanias": [<campaña>], "hayMas": false, "proximoCursor": null }`. Sin campañas, lista vacía (nunca 404).

**Errores:** `400 VALIDACION` (límite fuera de rango), `400 CURSOR_INVALIDO`, `403 AMBITO_NO_PERMITIDO`.

## `GET /api/v1/campanias/:id` — Detalle con alias y CBU (HU-12.2)

Cualquier perfil. **Respuesta 200:** una campaña. **Errores:** `400 VALIDACION` (id inválido), `404 CAMPANIA_NO_ENCONTRADA`.

## `POST /api/v1/campanias/:id/donaciones` — «Terminar donación» (HU-12.3)

> **Spec 027:** si el refugio vinculó Mercado Pago, la donación puede volver ya `Realizada` (`confirmadaPorMercadoPago: true`) cuando la transferencia estaba acreditada. Sin DNI cargado responde `409 DNI_REQUERIDO` («Cargá tu DNI para donar.»). Detalle en [`api-mercadopago.md`](api-mercadopago.md).

Perfil **PERSONAL**. El adoptante avisa cuánto transfirió y **desde dónde**: `origen` obligatorio, `MERCADO_PAGO` u `OTRO_BANCO` («Elegí desde dónde vas a transferir»). Sólo las de Mercado Pago se confirman solas; la donación devuelve `origen` (`null` en las anteriores a este campo).

**Body (JSON):** `{ "monto": "1500,50" }` — de 1 a 2.500.000, hasta 2 decimales, coma o punto.

**Respuesta 201:** la donación, en estado **Pendiente**. El `recaudado` de la campaña **no cambia**.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «El monto es obligatorio», «El monto debe estar entre 1 y 2500000», etc. |
| `AMBITO_NO_PERMITIDO` | 403 | Desde el perfil de refugio |
| `DONACION_PROPIA` | 403 | «No podés donar a una campaña de tu propio refugio» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | «No encontramos esa campaña» |
| `CAMPANIA_NO_ACTIVA` | 409 | «Esta campaña no está recibiendo donaciones». También si figura Activa pero ya venció o llegó al objetivo y el cron todavía no corrió: en ese caso se cierra en el acto. |

## `GET /api/v1/refugio/campanias` — «Mis Campañas» (HU-12.1)

Perfil **REFUGIO**. Las campañas del refugio, de la más reciente a la más vieja, con `pendientes`.

**Query:**

| Param | Qué hace |
| --- | --- |
| `cursor`, `limite` | Paginación (límite 1–50, por defecto 20) |
| `estados` | Ids separados por coma (`?estados=1,2`). Vacío = todos |
| `fechaDesde` | `AAAA-MM-DD`. Filtra por la fecha de **inicio** de la campaña, inclusive |
| `fechaHasta` | `AAAA-MM-DD`. Sólo vale junto con `fechaDesde` |

**Errores:** `400 VALIDACION` («Para filtrar por fecha, elegí la fecha "desde"», «La fecha "desde" no puede ser posterior a "hasta"»), `400 CURSOR_INVALIDO`, `403 SIN_REFUGIO`, `403 AMBITO_NO_PERMITIDO`.

## `POST /api/v1/refugio/campanias` — Crear campaña (HU-12.1)

Perfil **REFUGIO**. El refugio tiene que estar **verificado y en estado Activo**.

**Body (multipart):**

| Campo | Regla |
| --- | --- |
| `titulo` | 3 a 50 caracteres, trim |
| `descripcion` | Hasta 300 caracteres, trim |
| `objetivo` | Sólo números (sin puntos ni comas), de 10000 a 2500000 |
| `fechaInicio` | `AAAA-MM-DD`, de hoy en adelante |
| `fechaFin` | `AAAA-MM-DD`, posterior a `fechaInicio` |
| `alias` | Opcional: 6 a 20 caracteres entre letras, números, `.` y `-` |
| `cbu` | Opcional: 22 dígitos (se ignoran espacios) |
| `imagen` | Archivo obligatorio, jpg/png/webp, ≤5 MB |

Al menos uno de `alias` o `cbu`.

**Respuesta 201:** la campaña con `pendientes: 0`. Nace **Inactiva**; si `fechaInicio` es hoy, en la misma operación pasa a **Activa**.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «Cargá el alias o el CBU/CVU para que puedan donarte», «La fecha de fin tiene que ser posterior a la de inicio», «La fecha de inicio no puede ser anterior a hoy», «El objetivo debe ser un número entero, sin puntos ni comas», etc. |
| `IMAGEN_REQUERIDA` | 400 | «Agregá una imagen para la campaña» |
| `REFUGIO_NO_HABILITADO` | 403 | «Tu refugio tiene que estar verificado y activo para crear campañas» |
| `LIMITE_CAMPANIAS` | 409 | «Alcanzaste el límite de 5 campañas activas. Finalizá o eliminá una para crear otra» (cuentan Inactiva + Activa + Pausada) |

## `PATCH /api/v1/refugio/campanias/:id` — Editar (spec 028)

Perfil **REFUGIO**. Sólo campañas **Inactiva**, **Activa** o **Pausada**.

**Body (multipart), todo opcional** (lo que no llega no cambia):

| Campo | Regla |
| --- | --- |
| `titulo` | 3 a 50 caracteres, trim |
| `descripcion` | Hasta 300 caracteres, trim |
| `objetivo` | Sólo números, de 10000 a 2500000, y **no menor a `recaudado`** |
| `fechaFin` | `AAAA-MM-DD`, **posterior a hoy** y posterior a `fechaInicio` |
| `imagen` | Archivo jpg/png/webp, ≤5 MB. Reemplaza a la anterior |

`alias`, `cbu` y `fechaInicio` no se pueden modificar: mandarlos es un 400.

**Respuesta 200:** la campaña actualizada (como en «Mis Campañas»). Si la nueva meta es igual a lo recaudado, la campaña llegó a su meta y vuelve **Finalizada**.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «La fecha de fin debe ser posterior a hoy», «La fecha de fin tiene que ser posterior a la de inicio», «El alias no se puede modificar», «El CBU/CVU no se puede modificar», «La fecha de inicio no se puede modificar», etc. |
| `SIN_CAMBIOS` | 400 | «No hay cambios para guardar» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | No existe, es de otro refugio o fue eliminada |
| `CAMPANIA_NO_EDITABLE` | 409 | «Una campaña finalizada no se puede editar» (también si la finalizaron mientras se editaba) |
| `OBJETIVO_MENOR_A_RECAUDADO` | 409 | «La meta no puede ser menor a lo que ya recaudaste ($57.000)» |

## `DELETE /api/v1/refugio/campanias/:id` — Eliminar (spec 028)

Perfil **REFUGIO**. Baja lógica, en cualquier estado, sólo si la campaña **no tiene ninguna donación** (ni pendiente, ni aplicada, ni rechazada). Desaparece de «Mis Campañas» y el detalle pasa a responder 404.

**Respuesta 204** sin cuerpo.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `CAMPANIA_NO_ENCONTRADA` | 404 | No existe, es de otro refugio o ya fue eliminada |
| `CAMPANIA_CON_DONACIONES` | 409 | «No podés eliminar una campaña que ya recibió donaciones. Podés finalizarla» |

## `PATCH /api/v1/refugio/campanias/:id/estado` — Finalizar, pausar o reactivar (HU-12.6, spec 028)

Perfil **REFUGIO**. **Body:** `{ "estado": "Finalizada" | "Pausada" | "Activa" }`.

- Finalizar: desde **Inactiva**, **Activa** o **Pausada**. Finalizada es final.
- Pausar: sólo desde **Activa**.
- Reactivar (`Activa`): sólo desde **Pausada**. Si ya venció o llegó a la meta, en la misma operación queda **Finalizada**.

**Respuesta 200:** la campaña actualizada (con `pendientes` y `tieneDonaciones`). Las donaciones pendientes se pueden seguir revisando.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «El estado tiene que ser "Finalizada", "Pausada" o "Activa"» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | No existe o es de otro refugio |
| `TRANSICION_INVALIDA` | 409 | «La campaña está «Finalizada»: no se puede reactivar», o «La campaña cambió de estado recién. Actualizá la lista e intentalo de nuevo» (otro miembro o el cron llegaron primero) |

## `GET /api/v1/refugio/campanias/:id/donaciones` — Bandeja de revisión (HU-12.3)

Perfil **REFUGIO**. Donaciones de la campaña, de la más reciente a la más vieja.

**Query:** `cursor?`, `limite?` (1–50, por defecto 30), `estado?` = `Pendiente` | `Realizada` | `Cancelada` (sin él, todas).

**Respuesta 200:** `{ "donaciones": [<donación>], "hayMas": false, "proximoCursor": null }`.

**Errores:** `400 VALIDACION` («El estado no es válido»), `400 CURSOR_INVALIDO`, `404 CAMPANIA_NO_ENCONTRADA`.

## `PATCH /api/v1/refugio/donaciones/:id/estado` — Aplicar o rechazar (HU-12.3)

Perfil **REFUGIO**. **Body:** `{ "estado": "Realizada" }` o `{ "estado": "Cancelada", "motivo": "NO_RECIBIDA" | "MONTO_NO_COINCIDE" }`.

- **Realizada** suma el monto al `recaudado`. Si con eso la campaña Activa o Pausada llega al objetivo, se finaliza en el acto.
- Sólo se resuelve una donación **Pendiente**. Vale aunque la campaña ya haya cerrado.

**Respuesta 200:** la donación actualizada.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «Elegí por qué rechazás la donación», «El estado tiene que ser "Realizada" o "Cancelada"» |
| `DONACION_NO_ENCONTRADA` | 404 | No existe o es de otro refugio |
| `TRANSICION_INVALIDA` | 409 | «Esta donación ya fue revisada» |

## `GET /api/v1/estados-campania` — Estados de campaña

Cualquier perfil. **Respuesta 200:** `[{ "id": 1, "nombre": "Inactiva" }, { "id": 2, "nombre": "Activa" }, …]`. Para el filtro de «Mis Campañas».

---

## Cron — `src/jobs/transicion-estados-campana.job.ts` (HU-12.4)

No es un endpoint: corre desde el cron del sistema (una vez por día) con el usuario SISTEMA.

- Inactiva → Activa cuando llega `fechaInicio`.
- Activa o Pausada → Finalizada cuando pasa `fechaFin` (cuenta hasta el final de ese día) o `recaudado` ≥ `objetivo`.

```
5 0 * * * cd /ruta/al/repo && node dist/jobs/transicion-estados-campana.job.js
```

## Decisiones tomadas y por qué

- **La donación se declara después de transferir.** No hay pasarela de pago: el adoptante transfiere por fuera del sistema y avisa. La confianza la cierra el refugio, que verifica el ingreso real antes de aplicarla.
- **Eliminar es baja lógica y sólo sin donaciones** (spec 028). Reemplazó a «Cancelar»: una campaña con donaciones tiene historial que el refugio y los donantes tienen que poder ver, así que se finaliza.
- **Quota sobre Inactiva + Activa + Pausada.** Contar sólo las Activa dejaría crear campañas programadas sin límite; la Pausada cuenta porque se puede reactivar.
- **404 y no 403 entre refugios.** No revela que la campaña o la donación existen.
- **`montoDonadoDeclarado` del dashboard de admin** conserva el nombre para no romper web-admin, pero ahora suma sólo las Realizada.

## Pendiente para otros módulos

- **«Mis donaciones» del adoptante:** historial y estado de lo que donó.
- **Confirmación automática con Mercado Pago:** spike y luego spec 027. El modelo ya la admite (otro camino a Realizada con usuario SISTEMA).
- **GUI-36 en `web-admin`:** sigue con datos de ejemplo.
