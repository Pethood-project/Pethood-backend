# Contrato de API — Campañas de donación

Endpoints de **HU-12.1 a HU-12.7 (Campañas de Recaudación)**, listos para consumir desde `pethood-frontend`. Están implementados, testeados y verificados contra el servidor local con las campañas del seed. Alcance, reglas y criterios de aceptación: [spec 021](specs/021-campanias.md).

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
{ "error": { "codigo": "LIMITE_CAMPANIAS", "mensaje": "Alcanzaste el límite de 5 campañas activas. Finalizá o cancelá una para crear otra" } }
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
| `alias` / `cbu` | Al menos uno viene cargado (salvo campañas sembradas antes de la spec 021). |
| `imagenUrl` | Ruta relativa: pasarla por `urlAbsoluta`. `null` sólo en campañas viejas del seed. |

En «Mis Campañas» cada campaña suma **`pendientes`**: cuántas donaciones esperan revisión.

Estados (`estado.nombre`): `Inactiva` (todavía no empezó), `Activa`, `Finalizada`, `Cancelada`.

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

Perfil **PERSONAL**. El adoptante avisa cuánto transfirió.

**Body (JSON):** `{ "monto": "1500,50" }` — de 1 a 2.500.000, hasta 2 decimales, coma o punto.

**Respuesta 201:** la donación, en estado **Pendiente**. El `recaudado` de la campaña **no cambia**.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «El monto es obligatorio», «El monto debe estar entre 1 y 2500000», etc. |
| `AMBITO_NO_PERMITIDO` | 403 | Desde el perfil de refugio |
| `DONACION_PROPIA` | 403 | «No podés donar a una campaña de tu propio refugio» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | «No encontramos esa campaña» |
| `CAMPANIA_NO_ACTIVA` | 409 | «Esta campaña no está recibiendo donaciones» |

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
| `LIMITE_CAMPANIAS` | 409 | «Alcanzaste el límite de 5 campañas activas. Finalizá o cancelá una para crear otra» (cuentan Inactiva + Activa) |

## `PATCH /api/v1/refugio/campanias/:id/estado` — Finalizar o cancelar (HU-12.5, HU-12.6)

Perfil **REFUGIO**. **Body:** `{ "estado": "Finalizada" }` o `{ "estado": "Cancelada" }`.

- Finalizar: sólo desde **Activa**.
- Cancelar (dar de baja): desde **Inactiva** o **Activa**. No llena `fecha_baja`: la campaña sigue apareciendo con el filtro «Cancelada».
- Finalizada y Cancelada son finales.

**Respuesta 200:** la campaña actualizada (con `pendientes`). Las donaciones pendientes se pueden seguir revisando.

| Código | HTTP | Mensaje |
| --- | --- | --- |
| `VALIDACION` | 400 | «El estado tiene que ser "Finalizada" o "Cancelada"» |
| `CAMPANIA_NO_ENCONTRADA` | 404 | No existe o es de otro refugio |
| `TRANSICION_INVALIDA` | 409 | «La campaña está «Cancelada»: no se puede finalizar», o «La campaña cambió de estado recién. Actualizá la lista e intentalo de nuevo» (otro miembro o el cron llegaron primero) |

## `GET /api/v1/refugio/campanias/:id/donaciones` — Bandeja de revisión (HU-12.3)

Perfil **REFUGIO**. Donaciones de la campaña, de la más reciente a la más vieja.

**Query:** `cursor?`, `limite?` (1–50, por defecto 30), `estado?` = `Pendiente` | `Realizada` | `Cancelada` (sin él, todas).

**Respuesta 200:** `{ "donaciones": [<donación>], "hayMas": false, "proximoCursor": null }`.

**Errores:** `400 VALIDACION` («El estado no es válido»), `400 CURSOR_INVALIDO`, `404 CAMPANIA_NO_ENCONTRADA`.

## `PATCH /api/v1/refugio/donaciones/:id/estado` — Aplicar o rechazar (HU-12.3)

Perfil **REFUGIO**. **Body:** `{ "estado": "Realizada" }` o `{ "estado": "Cancelada", "motivo": "NO_RECIBIDA" | "MONTO_NO_COINCIDE" }`.

- **Realizada** suma el monto al `recaudado`. Si con eso la campaña Activa llega al objetivo, se finaliza en el acto.
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
- Activa → Finalizada cuando pasa `fechaFin` (cuenta hasta el final de ese día) o `recaudado` ≥ `objetivo`.

```
5 0 * * * cd /ruta/al/repo && node dist/jobs/transicion-estados-campana.job.js
```

## Decisiones tomadas y por qué

- **La donación se declara después de transferir.** No hay pasarela de pago: el adoptante transfiere por fuera del sistema y avisa. La confianza la cierra el refugio, que verifica el ingreso real antes de aplicarla.
- **Cancelar no es `fecha_baja`.** La HU-12.5 «da de baja» la campaña, pero el filtro por estado tiene que poder mostrar las canceladas.
- **Quota sobre Inactiva + Activa.** Contar sólo las Activa dejaría crear campañas programadas sin límite.
- **404 y no 403 entre refugios.** No revela que la campaña o la donación existen.
- **`montoDonadoDeclarado` del dashboard de admin** conserva el nombre para no romper web-admin, pero ahora suma sólo las Realizada.

## Pendiente para otros módulos

- **Editar una campaña:** fuera de alcance de la spec 021 (el botón «Editar» de GUI-36 queda deshabilitado).
- **«Mis donaciones» del adoptante:** historial y estado de lo que donó.
- **Confirmación automática con Mercado Pago:** spike y luego spec 022. El modelo ya la admite (otro camino a Realizada con usuario SISTEMA).
- **GUI-36 en `web-admin`:** sigue con datos de ejemplo.
