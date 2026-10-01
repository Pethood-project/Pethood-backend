# Spec 008 — Moderación y Reportes (Módulo 3)

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** equipo PetHood · **Última actualización:** 2026-10-01

## 1. Objetivo

Permitir que cualquier usuario reporte una publicación, una persona, un refugio, una reseña, un aviso de mascota perdida, una campaña o un mensaje de chat, y que el administrador vea los reportes pendientes y los resuelva desde web-admin. Da cobertura a HU-3.1 a HU-3.7.

## 2. Alcance

- **Incluye:** aviso in-app al reportante al resolver (fila en `Notificacion`); alta de reporte (HU-3.1, 3.2, 3.3, más avisos de mascota perdida, campañas y mensajes); listado y detalle de reportes para el admin (HU-3.6); resolución de un reporte con respuesta (HU-3.7); anti-spam (duplicado y tope de pendientes); cablear `cantidadReportes` y `reportes[]` del detalle de publicaciones admin.
- **NO incluye:**
  - Suspender usuario (HU-3.4) y eliminar publicación (HU-3.5): ya existen en `PATCH /admin/usuarios/:id/suspender` (y `/reactivar`), `PATCH /admin/refugios/:id/suspender` y `PATCH /admin/publicaciones/:id/baja` (`docs/api-admin-moderacion.md`). Resolver un reporte **no** dispara la baja: el admin hace las dos llamadas por separado.
  - Baja de un aviso de mascota perdida (`ANIMAL_PERDIDO`) **por el dueño**: no existe (deuda #28). La del admin sí, ver §4.
  - Baja de una reseña: ya existe en `DELETE /resenas/:id` (spec 022).
  - Que el reportante consulte el estado de sus reportes, endpoints para leer notificaciones, correo, y avisar al reportado de una suspensión o baja: deuda #27 (Módulo 4).
  - Pantallas de mobile: el alta de reporte desde la app se especifica con el frontend; esta spec fija solo el contrato.

## 3. Entidades involucradas

`ReporteProblema` (MODELO_DATOS.md). Hoy no tiene relaciones; esta spec la completa con un vínculo **polimórfico**: `tipo` + `objeto_id`, sin FK. **Campos nuevos:**

| Campo | Tipo | Nota |
|---|---|---|
| `tipo` | enum `TipoReporte` (`tipo_reporte`) | `PUBLICACION`, `USUARIO`, `REFUGIO`, `RESENA`, `ANIMAL_PERDIDO`, `CAMPANIA`, `MENSAJE` |
| `objeto_id` | `Int` | id de la tabla que indica `tipo` |

- **Sin FK, a propósito:** con una FK por tipo cada tipo nuevo agregaría columna, índice y rama de CHECK. No queda colgado porque nada se borra físicamente (regla transversal 1). A cambio, el service resuelve el objeto con un resolver por tipo (existe, no está de baja, no es propio, etiqueta, estado) en vez de un `include` de Prisma.
- **Por qué entran `CAMPANIA` y `MENSAJE`:** campañas (alias/CBU para donar) y chat (acoso, estafas) son los dos canales con más riesgo. Se agregaron con la migración `20261001133434_reporte_tipos_campania_mensaje` (`ALTER TYPE ... ADD VALUE`). Se descartó `SEGUIMIENTO` (privacidad y confianza de imágenes).
- **`CAMPANIA`:** `objeto_id` = `campania.id`. «Propia» = la campaña de un refugio al que el usuario pertenece. No existe el módulo de campañas (Módulo 12): el reporte funciona contra la tabla `campania`, pero **todavía no hay forma de dar de baja una campaña** (HU-12.5). Lo único que puede hacer el admin hoy es suspender al refugio.
- **`MENSAJE`:** `objeto_id` = `mensaje.id`. Solo se reporta un mensaje de tipo `TEXTO` de otra persona, en un chat del que el reportante es participante; los mensajes `SOLICITUD` los emite el sistema y no se reportan. `Mensaje` no tiene baja lógica (solo alta), así que no existe «dado de baja»: el mensaje se puede reportar siempre. Etiqueta: contenido recortado. **Privacidad:** el detalle del reporte le muestra al admin una **ventana de contexto**: los 10 mensajes anteriores y los 10 posteriores al reportado (del mismo chat, por `id`), con el reportado marcado. Cada mensaje trae contenido, imágenes, autor y fecha. Nunca el resto de la conversación y sin «ver más» (se amplía en otra spec si en la práctica falta contexto). Como `Mensaje` nunca se edita ni se borra, el admin ve lo que realmente se dijo. El tamaño de la ventana es la constante `VENTANA_CONTEXTO_MENSAJES = 10` del service. Acción posible para el admin: suspender al autor.
- **Reportante:** `usuario_alta` (no se agrega campo).
- **Resolución:** `resuelto = true`, `respuesta` con el texto del admin, `usuario_modificacion`/`fecha_modificacion` con quién y cuándo. No hay campo de fecha de resolución aparte.
- **Pendiente** = `resuelto = false AND fecha_baja IS NULL`.
- `mensajeSistema` queda sin uso en este módulo.
- **Índices:** `(tipo, objeto_id)` para listar los reportes de un objeto, y el único parcial `reporte_problema_pendiente_uq` sobre `(usuario_alta, tipo, objeto_id) WHERE resuelto = false AND fecha_baja IS NULL`: un solo reporte **pendiente** por usuario y objeto. Una vez resuelto, el usuario puede volver a reportar lo mismo.
- **Migración** `20261001132816_reporte_tipo_objeto`: borra las filas previas (eran del seed, no apuntaban a nada y ningún endpoint las creó). El seed las recrea con tipo y objeto.
- Límites nuevos en `limits.ts` (hay que espejarlos en mobile): `reporte.motivo { min: 5, max: 500 }` (espejado en mobile). `admin.respuestaReporte { min: 1, max: 500 }` es solo web-admin y no se espeja.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/reportes` | cualquier sesión | Crea el reporte |
| GET | `/api/v1/admin/reportes` | ADMIN | Lista con filtros (offset) |
| GET | `/api/v1/admin/reportes/:id` | ADMIN | Detalle con el objeto reportado |
| PATCH | `/api/v1/admin/reportes/:id/resolver` | ADMIN | Marca resuelto con respuesta |
| PATCH | `/api/v1/admin/animales-perdidos/:id/baja` | ADMIN | Baja lógica de un aviso reportado, con `motivo` |

**POST — body:**

```json
{ "tipo": "PUBLICACION", "objetoId": 12, "motivo": "La foto no corresponde a la mascota." }
```

`tipo` ∈ `PUBLICACION | USUARIO | REFUGIO | RESENA | ANIMAL_PERDIDO | CAMPANIA | MENSAJE`; `objetoId` es el id del objeto del tipo indicado. Respuesta `201` con `{ id, tipo, objetoId, motivo, resuelto: false, fechaAlta }`.

**Errores del POST:** `NO_ENCONTRADO` (404, el objeto no existe o está dado de baja), `REPORTE_PROPIO` (403), `REPORTE_DUPLICADO` (409), `LIMITE_REPORTES` (409, ya hay 5 pendientes), más los de validación Zod.

**GET `/admin/reportes`:** query `estado` (`pendiente` por defecto | `resuelto` | `todos`), `tipo`, `page` (1), `limit` (20, máx. 50). Orden: `fechaAlta` ascendente en pendientes (el más viejo primero), descendente en el resto, `id` como desempate. Respuesta `{ items, total, page, limit }`:

```json
{
  "id": 4,
  "tipo": "PUBLICACION",
  "motivo": "La foto no corresponde a la mascota.",
  "resuelto": false,
  "reportante": { "id": 3, "nombre": "Ana", "apellido": "Pérez" },
  "objeto": {
    "id": 12, "etiqueta": "Firulais", "imagenUrl": "https://…",
    "reportesPendientes": 1, "reportesTotales": 3
  },
  "fechaAlta": "2026-10-01T…"
}
```

`objeto.imagenUrl` es la miniatura (portada de la publicación o del aviso, logo del refugio, foto de la persona, imagen de la campaña; `null` en reseña y mensaje). `reportesPendientes` / `reportesTotales` cuentan los reportes del **mismo objeto** (mismo `tipo` + `objetoId`, sin los dados de baja), para priorizar reincidentes.

`objeto.etiqueta` es el título de la publicación, el nombre de la persona o del refugio, el comentario recortado de la reseña el título de la campaña, el contenido recortado del mensaje o el nombre del animal (si no tiene, la descripción recortada) del aviso. En un aviso, el «dueño» a efectos de `REPORTE_PROPIO` es `usuario_reportante_id` (no confundir con el reportante del reporte de moderación).

**GET `/admin/reportes/:id`:** el ítem de arriba más `respuesta`, `fechaResolucion`, `resueltoPor` y, dentro de `objeto`, su `estado` actual (`ACTIVO`, `SUSPENDIDO` o `DE_BAJA`) y la `vista` según el tipo, para decidir sin salir de la pantalla:

| `tipo` | `objeto.vista` (lleva también `tipo`) |
|---|---|
| `USUARIO` | `nombre, apellido, email, telefono, imagenUrl, verificado, estado, fechaAlta, provincia, localidad, refugios[{id,nombre}]` |
| `RESENA` | `puntuacion, comentario, fecha, autor{id,nombre,apellido}, receptor{tipo:'REFUGIO'\|'PERSONA', id, nombre}` |
| `ANIMAL_PERDIDO` | `nombre, estado, descripcion, imagenes[], ubicacion, fechaSuceso, reportante{id,nombre,apellido}` |
| `CAMPANIA` | `titulo, descripcion, estado, montoObjetivo, montoActual, fechaInicio, fechaFin, imagenes[], refugio{id,nombre}` |
| `PUBLICACION`, `REFUGIO` | sin `vista`: web-admin usa `GET /admin/publicaciones/:id` y `GET /admin/refugios/:id` |
| `MENSAJE` | sin `vista`: lleva `objeto.contexto[]` |

Aclaraciones: la `vista` de una persona incluye email y teléfono porque la ve solo el admin (el perfil público de la spec 023 no). `refugios` es una lista de 0 o 1 elemento (una persona pertenece a un solo refugio). `fechaSuceso` cae a la fecha de alta del aviso si este no la tiene. `montoActual` suma las donaciones activas: `Donacion` todavía no tiene la confirmación manual del refugio (regla 11) y el Módulo 12 la reemplazará. **`Campania` no tiene alias ni CBU en el modelo**, así que no se devuelven; hay que agregarlos con el Módulo 12 (HU-12.2). En un `MENSAJE`, `contexto[]` trae la ventana de ±10 mensajes, con las fotos **firmadas** (la carpeta de chats es privada). El `reportesRecibidos` que proponía el pedido de web-admin se omitió: lo cubren `reportesPendientes` y `reportesTotales`.

**PATCH `/admin/animales-perdidos/:id/baja`:** body `{ motivo }` (como el resto de las bajas admin). Responde `204`. Da de baja el aviso y le crea una `Notificacion` (`tipo: 'MODERACION'`) a quien lo publicó con el motivo. Errores: `NO_ENCONTRADO` (404), `AVISO_DE_BAJA` (409). Escribe `BAJA_MODERACION` en `LogAuditoria`.

**PATCH `/admin/reportes/:id/resolver`:** body `{ "respuesta": "..." }`. Devuelve el detalle. Error `REPORTE_YA_RESUELTO` (409).

**Notificación:** al resolver, se crea una `Notificacion` (`tipo: 'REPORTE_RESUELTO'`) para el reportante (`usuario_alta` del reporte): «Un administrador resolvió tu reporte. Respuesta: <respuesta>». Mismo patrón que la baja de publicaciones (`crearNotificacion` en el repository). No hay endpoint para leerlas todavía (deuda #27).

Todo `/admin/*` exige JWT + rol `ADMIN`; errores con `{ error: { codigo, mensaje } }`; resolver escribe en `LogAuditoria`.

**Cambio en admin-publicaciones:** `cantidadReportes` pasa a contar los reportes pendientes de la publicación y `reportes[]` del detalle lista todos los reportes de ella (hoy son placeholders en 0 y `[]`).

## 5. Pantallas (frontend)

Fuera de esta spec de backend. Web-admin: tabla de reportes pendientes (HU-3.6) con filtro por tipo y detalle con acciones. Mobile: opción "Reportar" en ficha de publicación, perfil y reseña.

## 6. Reglas de negocio y validaciones

1. `motivo` es texto libre, 5 a 500 caracteres (`LIMITES.reporte.motivo`). Backend (Zod) y frontend (input).
2. Solo se reporta un objeto existente y no dado de baja. Backend.
3. No se puede reportar lo propio: la propia persona, un refugio al que se pertenece, una publicación que uno publicó (como usuario o como miembro del refugio dueño) ni una reseña, un aviso de mascota perdida o un mensaje que uno creó, ni una campaña de su refugio. Un mensaje solo lo reporta un participante del chat. Backend.
4. Un solo reporte pendiente por usuario y objeto. Backend (service + índice parcial).
5. Máximo 5 reportes pendientes por usuario (regla anti-spam, igual que las solicitudes). Backend.
6. Solo el admin ve y resuelve reportes. Backend (`requiereRol`).
7. Un reporte resuelto no se vuelve a resolver ni se edita. Backend.
8. Resolver **no** da de baja nada: la acción sobre el objeto es una llamada aparte.
9. Resolver crea la notificación al reportante en la misma operación que marca el reporte como resuelto. Backend.

## 7. Criterios de aceptación

- [ ] Un usuario puede reportar una publicación, una persona, un refugio, una reseña, un aviso de mascota perdida, una campaña o un mensaje con un motivo.
- [ ] Un mensaje solo lo puede reportar un participante del chat, y el admin ve ese mensaje con 10 anteriores y 10 posteriores del mismo chat.
- [ ] No puede reportar lo propio, un objeto inexistente o de baja.
- [ ] No puede tener dos reportes pendientes del mismo objeto ni más de 5 pendientes en total.
- [ ] Tras resolverse un reporte, puede volver a reportar el mismo objeto.
- [ ] El admin ve los pendientes ordenados del más viejo al más nuevo y puede filtrar por tipo.
- [ ] El admin resuelve un reporte con una respuesta y deja de aparecer entre los pendientes.
- [ ] Al resolver, el reportante recibe una `Notificacion` con la respuesta del admin.
- [ ] Un no-admin recibe 403 en `/admin/reportes`.
- [ ] El detalle de una publicación en admin muestra su cantidad de reportes pendientes y la lista.
- [ ] El listado y el detalle traen `imagenUrl`, `reportesPendientes` y `reportesTotales` del objeto.
- [ ] El detalle de un reporte de persona, reseña, aviso o campaña trae `objeto.vista`.
- [ ] El admin puede dar de baja un aviso reportado y su dueño recibe el motivo.

## 8. Casos borde y errores

- El objeto se da de baja después del reporte: el reporte sigue visible y resoluble; el detalle muestra el objeto como `DE_BAJA`. Lo mismo si la persona o el refugio quedó `SUSPENDIDO`.
- Dos reportes simultáneos del mismo usuario y objeto: uno gana por el índice parcial y el otro responde `REPORTE_DUPLICADO` (el service captura el error de unicidad).
- Tope de 5 en carrera: el conteo previo puede dejar pasar uno de más; es aceptable (no es una invariante de negocio crítica).
- Reportar un mensaje de un chat ajeno: `NO_ENCONTRADO`, para no revelar que el mensaje existe.
- Un refugio y sus miembros: el miembro puede reportar a otro refugio, pero no al suyo.

## 9. Notas y decisiones

- `motivo` libre, sin catálogo. Decisión de equipo, 2026-10-01.
- Anti-spam: duplicado (único parcial) y tope de 5 pendientes. Decisión de equipo, 2026-10-01.
- Resolver crea una `Notificacion` in-app al reportante; leerla, el correo y el aviso al reportado quedan en la deuda #27. Decisión de equipo, 2026-10-01.
- `REFUGIO` cubre la parte «refugio» de HU-3.2 («refugio o adoptante»): en el modelo el refugio es una entidad aparte del usuario, así que necesita su propio tipo. Reportar al refugio apunta a la entidad (la acción del admin es `PATCH /admin/refugios/:id/suspender`); reportar a una persona del refugio es `USUARIO`.
- `tipo` + `objeto_id` polimórfico en lugar de una FK por tipo, y `ANIMAL_PERDIDO`, `CAMPANIA` y `MENSAJE` incluidos. Decisión de equipo, 2026-10-01.
- Se reporta el mensaje y el admin ve una ventana de ±10 mensajes, no la conversación entera ni solo el mensaje suelto. Decisión de equipo, 2026-10-01.
- Al reportar un mensaje, la app tiene que avisar: «Un administrador podrá ver este mensaje y los cercanos». Texto exacto a definir con el frontend.
- Esta spec toma el número 008 (reservado en el índice como «Panel Admin y Moderación»).
