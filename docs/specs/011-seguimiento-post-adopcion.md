# Spec 011 — Seguimiento Post-Adopción (HU-9.1, HU-9.2, HU-9.3)

**Estado:** APROBADA
**Sprint:** 7 (Fase 7 del ROADMAP) · **Responsable:** Grupo N°09 · **Última actualización:** 2026-09-26

## 1. Objetivo

Permitir que quien tiene una mascota bajo su cuidado por adopción o tránsito responda, en los momentos que el sistema le pide, cómo está el animal (descripción + foto de evidencia), y que quien la entregó (adoptante publicador o refugio) pueda ver si esas actualizaciones se están cumpliendo y revisar cada una en detalle.

## 2. Alcance

- **Incluye:** HU-9.1 (enviar seguimiento), HU-9.2 (ver seguimientos) y HU-9.3 (revisar actualización): generación automática de los pedidos de seguimiento según la secuencia de días, pregunta aleatoria por pedido, ventana de 48 h para responder, vencimiento con notificación al publicador, listado por solicitud, detalle del expediente y detalle de una actualización puntual. Desde 2026-09-26 también: primera pregunta fija y preguntas escritas a mano por el refugio (§6.3 y §6.11).
- **NO incluye:**
  - **Módulo de Solicitudes** (crear/aprobar una solicitud de adopción o tránsito): no existe todavía. Esta spec asume solicitudes ya aprobadas y se apoya en `prisma/seed-adopciones-completas.ts` para tener datos.
  - **Módulo 4 — Notificaciones**: HU-9.3 dice que a una actualización se puede llegar "desde una notificación". Acá se escribe la fila en `Notificacion` y se expone el endpoint que esa pantalla necesitaría, pero el listado de notificaciones y su navegación son del Módulo 4 (ver §9, decisión abierta sobre la referencia a la entidad).
  - **Bloqueo de galería / cámara nativa**: es responsabilidad del frontend mobile. El backend valida que llegue una imagen válida, pero no puede verificar su origen (regla transversal 9).
  - **Motor de notificaciones push**: acá solo se escribe la fila en `Notificacion`; el envío es del Módulo 4.

## 3. Entidades involucradas

Todas existen en `prisma/schema.prisma`. La migración `20260926120000_seguimiento_preguntas_refugio` sumó `pregunta_seguimiento_es_inicial`, `Pregunta_Seguimiento.solicitud_id` y `seguimiento_es_manual` (§6.3 y §6.11).

- **`Seguimiento`** (`seguimiento_descripcion`, `seguimiento_foto_url`, `seguimiento_plazo`, FK `solicitud_id`, FK `pregunta_seguimiento_id`). Una fila = **un pedido de seguimiento**: nace vacía (solo pregunta + plazo) y se completa cuando el adoptante responde. Su estado se deriva, no se guarda:

  | Estado | Condición | GUI-21 |
  |---|---|---|
  | `PENDIENTE` | `descripcion IS NULL` y `plazo > ahora` | se puede responder |
  | `VENCIDO` | `descripcion IS NULL` y `plazo <= ahora` | gris, "No completado" |
  | `COMPLETADO` | `descripcion IS NOT NULL` | naranja, "completado" con fecha |

  `seguimiento_es_manual = true` marca un pedido que el refugio mandó a mano (§6.11): no ocupa lugar en la secuencia de días.

- **`Pregunta_Seguimiento`** (`texto`, `posicion`, `es_adopcion`, `es_inicial`, FK `solicitud_id` nullable):
  - Con `solicitud_id` null es el **catálogo** precargado en `prisma/seed/catalogos.ts` (el mismo listado para adopción y tránsito; `esAdopcion` separa los flujos). `es_inicial = true` marca la pregunta fija del primer pedido, "¿Qué tal estuvo la primera noche en casa?", que no entra en el sorteo.
  - Con `solicitud_id` es una **pregunta escrita por el refugio** para esa solicitud (§6.11). Nunca se sortea. Si ningún pedido la usa todavía, es la pregunta *programada* para el próximo pedido automático.
- **`Solicitud` / `Solicitud_Estado` / `Tipo_Solicitud`**: solo lectura. Una solicitud entra en seguimiento cuando su estado vigente es `Aprobada`.
- **`Notificacion`**: se escribe una fila al vencer un pedido sin respuesta.

## 4. API (contrato backend)

Prefijo `/api/v1`. Todo exige `Authorization: Bearer <token>`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/seguimientos` | autenticado | Mis solicitudes en seguimiento (como adoptante y como publicador) |
| GET | `/solicitudes/:solicitudId/seguimientos` | autenticado | Detalle de GUI-21: historial de pedidos de esa solicitud |
| GET | `/seguimientos/:id` | adoptante o publicador | HU-9.3: una actualización puntual |
| POST | `/seguimientos/:id/actualizacion` | adoptante de la solicitud | HU-9.1: subir descripción + foto |
| POST | `/solicitudes/:solicitudId/seguimientos/preguntas` | refugio de la mascota (`X-Ambito: REFUGIO`) | §6.11: enviar una pregunta propia |
| DELETE | `/solicitudes/:solicitudId/seguimientos/pregunta-programada` | refugio de la mascota (`X-Ambito: REFUGIO`) | §6.11: descartar la pregunta programada |

Toda respuesta de error usa `{ error: { codigo, mensaje } }` vía `errorHandler`.

### GET /seguimientos

```json
[
  {
    "solicitudId": 12,
    "tipo": "Adopcion",
    "rol": "ADOPTANTE",
    "mascota": { "id": 4, "nombre": "Rex", "imagenUrl": "https://…" },
    "adoptante": { "id": 7, "nombre": "Ana", "apellido": "Gomez" },
    "totales": { "completados": 1, "vencidos": 1, "pendientes": 1 },
    "pendiente": { "id": 30, "pregunta": "¿Está comiendo bien?", "plazo": "2026-09-04T10:00:00.000Z" },
    "proximoAviso": "2026-09-09T10:00:00.000Z",
    "finalizado": false
  }
]
```

`rol` dice desde qué lado mira el usuario: `ADOPTANTE` (puede responder) o `PUBLICADOR` (solo lee). `proximoAviso` es cuándo llega el próximo pedido, o `null` si la secuencia se agotó. `pendiente` es `null` cuando no hay nada para responder ahora — GUI-21 pinta el botón en gris.

### GET /solicitudes/:solicitudId/seguimientos

```json
{
  "solicitudId": 12,
  "tipo": "Adopcion",
  "rol": "ADOPTANTE",
  "puedeSubirActualizacion": true,
  "puedeEnviarPregunta": false,
  "preguntaProgramada": null,
  "mascota": { "id": 4, "nombre": "Rex", "imagenUrl": "https://…" },
  "adoptante": { "id": 7, "nombre": "Ana", "apellido": "Gomez" },
  "proximoAviso": "2026-09-09T10:00:00.000Z",
  "finalizado": false,
  "seguimientos": [
    {
      "id": 30, "numero": 1, "pregunta": "¿Qué tal estuvo la primera noche en casa?",
      "esManual": false, "estado": "COMPLETADO",
      "descripcion": "Come dos veces por día", "fotoUrl": "/api/v1/archivos/seguimientos/x.jpg",
      "fechaPedido": "2026-08-20T10:00:00.000Z", "plazo": "2026-08-22T10:00:00.000Z",
      "fechaRespuesta": "2026-08-21T09:00:00.000Z"
    }
  ]
}
```

`seguimientos` va del más reciente al más viejo. `puedeEnviarPregunta` es `true` sólo para el refugio que entregó la mascota, mientras el seguimiento no haya terminado y después de que llegó el primer pedido. `preguntaProgramada` (`{ id, texto, fechaAlta }` o `null`) es la pregunta del refugio que espera al próximo pedido automático; sólo se le devuelve al refugio (al adoptante le llega recién con su pedido). Errores: `404 NO_ENCONTRADO` si la solicitud no existe o no está aprobada; `403 NO_AUTORIZADO` si el usuario no es ni el adoptante ni el publicador.

### GET /seguimientos/:id

HU-9.3. Una actualización suelta, para la pantalla "Actualización Seguimiento". Lleva mascota, adoptante y solicitud porque se puede entrar desde una notificación, sin haber pasado por el expediente: la pantalla no tendría de dónde sacar de qué animal se trata.

```json
{
  "id": 30, "numero": 1,
  "pregunta": "¿Está comiendo bien? ¿Cambió algo en su alimentación?",
  "estado": "COMPLETADO",
  "descripcion": "Come dos veces por día y subió 300 g",
  "fotoUrl": "/api/v1/archivos/seguimientos/x.jpg",
  "fechaPedido": "2026-09-01T22:46:30.000Z",
  "plazo": "2026-09-03T22:46:30.000Z",
  "fechaRespuesta": "2026-09-03T00:56:30.300Z",
  "mensaje": null,
  "solicitudId": 12, "tipo": "Adopcion", "rol": "PUBLICADOR",
  "mascota": { "id": 4, "nombre": "Rex", "imagenUrl": "https://…" },
  "adoptante": { "id": 7, "nombre": "Ana", "apellido": "Gomez" }
}
```

`mensaje` es lo que se muestra cuando NO hay nada cargado, con los textos literales de HU-9.3; en una completada es `null` y se muestran `descripcion` y `fotoUrl` (que en los otros estados son siempre `null`).

| `estado` | `mensaje` |
|---|---|
| `COMPLETADO` | `null` — se muestra la actualización real |
| `PENDIENTE` (dentro de las 48 h) | `Aún no se sube actualización de este seguimiento` |
| `VENCIDO` (pasadas las 48 h) | `No se subió actualización de seguimiento` |

Errores: `404 NO_ENCONTRADO` si el seguimiento no existe o su solicitud no está aprobada; `403 NO_AUTORIZADO` si el usuario no es ni el adoptante ni el publicador.

### POST /seguimientos/:id/actualizacion

`multipart/form-data`: `descripcion` (texto) + `foto` (imagen ≤5 MB, jpg/png/webp). Opcional:
`rotacion` (`90`|`180`|`270`) y/o `cropX`/`cropY`/`cropWidth`/`cropHeight` (enteros ≥0, px sobre
la `foto` original, los cuatro juntos o ninguno) para recortar/rotar antes de comprimir.

```json
{ "mensaje": "seguimiento cargado con exito", "seguimiento": { "id": 32, "estado": "COMPLETADO", "…": "…" } }
```

| HTTP | codigo | mensaje | Origen |
|---|---|---|---|
| 400 | `VALIDACION` | `Completar descripción` | HU-9.1, texto literal |
| 400 | `VALIDACION` | `Limite de caracteres superado` | HU-9.1, texto literal |
| 400 | `VALIDACION` | `Adjuntar imagen de prueba` | HU-9.1, texto literal |
| 400 | `RECORTE_INVALIDO` | `El recorte excede el tamaño de la imagen` | recorte fuera de los límites de la foto |
| 403 | `NO_AUTORIZADO` | `Solo quien tiene la mascota a su cargo puede subir la actualización` | solo el adoptante responde |
| 409 | `SEGUIMIENTO_VENCIDO` | `El plazo de 48 horas para responder este seguimiento venció` | HU-9.1 |
| 409 | `SEGUIMIENTO_COMPLETADO` | `Este seguimiento ya fue completado` | responder dos veces |

### POST /solicitudes/:solicitudId/seguimientos/preguntas

§6.11. Body JSON `{ "texto": "¿Ya le pusieron nombre?" }` (longitud en `LIMITES.seguimiento.pregunta`).

```json
{ "mensaje": "Pregunta enviada. Tiene 48 horas para responderla.", "programada": false, "detalle": { "…": "igual a GET /solicitudes/:id/seguimientos" } }
```

`programada: false` → se creó un pedido manual que el adoptante tiene que responder ya. `programada: true` → había una pregunta activa y la nueva quedó para el próximo pedido automático; el mensaje es `Hay una pregunta esperando respuesta: la tuya va a llegar en el próximo pedido.`

| HTTP | codigo | mensaje | Origen |
|---|---|---|---|
| 400 | `VALIDACION` | según `LIMITES.seguimiento.pregunta` | texto vacío o fuera de rango |
| 403 | `AMBITO_NO_PERMITIDO` | `Esto es del refugio. Cambiá a la vista de refugio para usarlo` | no viene desde la vista de refugio |
| 403 | `NO_AUTORIZADO` | `Solo el refugio que entregó la mascota puede enviar preguntas de seguimiento` | no es el refugio de la mascota |
| 409 | `SEGUIMIENTO_SIN_INICIAR` | `Vas a poder enviar preguntas después de que llegue la primera actualización` | la primera pregunta es fija |
| 409 | `SEGUIMIENTO_FINALIZADO` | `El seguimiento terminó: ya no se pueden enviar preguntas` | secuencia agotada / fin del tránsito |

### DELETE /solicitudes/:solicitudId/seguimientos/pregunta-programada

Da de baja lógica la pregunta programada y devuelve el detalle actualizado (mismo formato que `GET /solicitudes/:id/seguimientos`). `404 NO_ENCONTRADO` si no hay ninguna; `403` igual que el POST.

## 5. Pantallas (frontend)

- **GUI-21 Seguimiento**: usa `GET /solicitudes/:id/seguimientos`. Pinta cada item según `estado` (naranja = completado con fecha, gris = no completado, activo = pregunta a responder). El botón *Subir actualización* se habilita con `puedeSubirActualizacion`; en gris cuando es `false`. Muestra la cuenta regresiva con `proximoAviso`.
- **GUI-22 Subir actualización**: formulario descripción + foto. **La foto debe salir de la cámara nativa con la galería bloqueada** (regla transversal 9, requisito no negociable de mobile). Los permisos de cámara y su cartel son responsabilidad del front.

## 6. Reglas de negocio y validaciones

1. **Entran en seguimiento** las solicitudes activas de tipo `Adopcion` o `Transito` cuyo estado vigente es `Aprobada`. La fecha de aprobación (fecha de alta de esa fila de `Solicitud_Estado`) es el día 0 de la secuencia.
2. **Secuencia de días — vive en el código** (`seguimiento.secuencia.ts`), no es configurable por usuarios ni por catálogo:
   - Adopción: `[2, 5, 5, 5, 7, 7, 14, 14, 30, 30, 60, 90, 180, 365, 365]` → 15 pedidos, el último al día 1179. Después la secuencia se agota y no se generan más.
   - Tránsito: `[2, 2, 3, 4, 5, 5]` y luego siempre cada 5 días, hasta que termina el período de tránsito.
3. **Generación**: el pedido se materializa recién cuando llega su fecha (nunca por adelantado), con `plazo = fecha del pedido + 48 h`. Su pregunta sale así:
   1. El **primer pedido** de la secuencia lleva siempre la pregunta inicial (`es_inicial`): "¿Qué tal estuvo la primera noche en casa?".
   2. Si el refugio dejó una **pregunta programada** (§6.11), reemplaza a la aleatoria del siguiente pedido.
   3. Si no, una **al azar** del catálogo del flujo. No se repiten las preguntas ya respondidas ni la que está esperando respuesta; una que venció sin respuesta vuelve al sorteo. Agotado el catálogo se sortea sobre todas.
4. **Ventana de 48 h**: pasado el plazo sin respuesta el pedido queda `VENCIDO` y ya no se puede responder — hay que esperar el próximo (HU-9.1).
5. **Aviso al publicador**: al vencer un pedido se crea una `Notificacion` para quien publicó la mascota, tipo `SEGUIMIENTO_VENCIDO`, mensaje `Actualización de seguimiento no enviado — <mascota>` (HU-9.1). Se emite una sola vez por pedido.
6. **Solo el adoptante responde.** El publicador y los integrantes del refugio dueño de la mascota tienen acceso de lectura.
7. **Descripción y foto son obligatorias** (HU-9.1), con los textos de error literales de la tabla de §4. Longitud máxima en `LIMITES.seguimiento.descripcion`.
8. **Fin del tránsito**: al terminar el período de tránsito se dejan de generar pedidos; 5 días después los pedidos de esa solicitud se dan de baja lógica (HU-9.1, "el registro de seguimiento se borra a los 5 días").
9. **Auditoría**: alta con el usuario `SISTEMA` (es el sistema quien genera el pedido), modificación con el id del adoptante al responder. Bajas siempre lógicas.
10. **Revisar una actualización (HU-9.3)**: la pueden abrir el adoptante y el publicador (incluido el personal del refugio dueño). Es **solo lectura**: revisar no cambia el estado del pedido ni lo marca como visto. Si no hay actualización cargada nunca se inventa contenido — se devuelve la pregunta y el mensaje que corresponde según si el plazo sigue abierto.
11. **Preguntas del refugio**: el refugio que entregó la mascota (desde la vista de refugio) puede escribirle una pregunta propia al adoptante:
    - **Sin pregunta activa** (ningún pedido `PENDIENTE`): se crea en el momento un pedido manual (`es_manual = true`) con sus 48 h de plazo, y se notifica al adoptante (`SEGUIMIENTO_PREGUNTA_REFUGIO`). **No depende ni corre la secuencia de días**: si el próximo pedido automático caía mañana, mañana llega igual con su propia pregunta.
    - **Con una pregunta activa**: la activa no se puede modificar. La nueva queda *programada* y reemplaza a la pregunta aleatoria del próximo pedido automático. Hay a lo sumo una programada: una nueva pisa a la anterior, y se puede descartar.
    - No se puede antes de que llegue el primer pedido (la primera pregunta es fija) ni después de que terminó el seguimiento.
    - Un particular que publicó su propia mascota no tiene esta opción: es sólo para refugios.

## 7. Criterios de aceptación

- [ ] Con una solicitud aprobada hace ≥2 días, GUI-21 muestra el primer pedido con su pregunta y permite responder.
- [ ] Guardar con descripción + foto responde `seguimiento cargado con exito` y el item pasa a `COMPLETADO` con su fecha.
- [ ] Sin descripción → `Completar descripción`. Con descripción demasiado larga → `Limite de caracteres superado`. Sin foto → `Adjuntar imagen de prueba`.
- [ ] Pasadas 48 h sin responder, el item queda `VENCIDO`, deja de aceptar respuesta y el publicador recibe la notificación una única vez.
- [ ] Una solicitud recién aprobada (día 0) no tiene pedidos y devuelve `puedeSubirActualizacion: false`.
- [ ] El publicador ve el mismo historial con `rol: "PUBLICADOR"` y no puede subir actualizaciones.
- [ ] Un usuario ajeno a la solicitud recibe 403.
- [ ] (HU-9.3) El publicador abre una actualización completada y ve pregunta, descripción e imagen.
- [ ] (HU-9.3) Abre una sin completar dentro de las 48 h y ve solo la pregunta con `Aún no se sube actualización de este seguimiento`.
- [ ] (HU-9.3) Abre una sin completar pasadas las 48 h y ve solo la pregunta con `No se subió actualización de seguimiento`.
- [ ] (HU-9.3) El adoptante abre una actualización que cargó él y ve el mismo contenido.

## 8. Casos borde y errores

- **Secuencia agotada** (adopción pasado el día 1179): no se generan más pedidos, `proximoAviso: null`, `finalizado: true`.
- **Solicitud aprobada hace mucho**: se materializan de una todos los pedidos cuya fecha ya pasó; los que quedaron sin responder nacen ya vencidos y notifican.
- **Sin preguntas en el catálogo**: no se puede generar el pedido; se registra el problema y la solicitud queda sin pedidos nuevos en lugar de romper el listado.
- **Falla al guardar la imagen**: la foto se borra del storage si la escritura en base falla (mismo patrón que historia clínica).
- **Solicitud dada de baja o no aprobada**: no aparece en el listado y su detalle devuelve 404.

## 9. Notas y decisiones

- **2026-09-02 — Dónde corre la generación.** El ROADMAP sugiere resolver los cron jobs como jobs independientes y no inline en el endpoint de consulta. Acá la lógica vive en `seguimiento.secuencia.ts` (funciones puras, testeables sin base ni HTTP) y el service la aplica al leer. Se eligió sincronizar en la lectura porque **el proyecto todavía no tiene scheduler**: sin eso ningún pedido aparecería nunca y el módulo no sería demostrable. La operación es idempotente, así que el día que exista el scheduler alcanza con llamar a `sincronizarSolicitud` desde un job, sin tocar el resto.
- **2026-09-02 — Duración del período de tránsito: ASUNCIÓN A CONFIRMAR.** HU-9.2 dice que la secuencia de tránsito "depende del periodo de tránsito", pero **el modelo de datos no tiene ningún campo con la fecha de fin del tránsito** (`Solicitud` solo tiene `fecha_respuesta`). Se tomó un valor por defecto de 180 días en el código (`DIAS_TRANSITO_POR_DEFECTO`), aislado en una sola constante. Cuando el equipo defina dónde vive ese dato, se cambia ahí. Sigue la política de la sección 10 de REQUISITOS.md: se deja explícito en vez de asumirlo en silencio.
- **2026-09-02 — `Tipo_Solicitud.secuencia_dias` no se usa para esto.** Ese campo está documentado como la ventana de cancelación automática (6 meses) de solicitudes pendientes; reutilizarlo como duración del tránsito sería sobrecargarlo con dos significados distintos según el tipo.
- **2026-09-03 — DECISIÓN ABIERTA: la notificación no sabe a qué seguimiento apunta.** HU-9.3 permite llegar a una actualización "desde una notificación", pero `Notificacion` solo tiene `tipo`, `mensaje`, `leido` y `usuario_id` (MODELO_DATOS.md): **no guarda referencia a la entidad que la disparó**, así que hoy el front no puede armar el link directo. Se dejó así a propósito en lugar de cambiar el modelo por cuenta propia, porque `Notificacion` es del Módulo 4 y sus notificaciones vienen de Solicitud, Chat/Mensaje **y** Seguimiento — la forma correcta de esa referencia (genérica `entidad` + `entidad_id`, o una FK por entidad) es una decisión de diseño de ese módulo, no de éste. Mientras tanto el mensaje nombra la mascota, así que el camino "notificación → expediente de la mascota → actualización" ya funciona con lo que hay. Opciones a resolver con el equipo antes de implementar el Módulo 4:
  1. `notificacion_entidad` + `notificacion_entidad_id` genéricos (sirve para las tres fuentes; no da integridad referencial).
  2. FKs nullables por entidad (`seguimiento_id`, `solicitud_id`, `chat_id`): da integridad, pero suma una columna por fuente nueva.
  3. Dejarlo como está: se navega a la mascota y desde ahí a la actualización.
- **2026-09-26 — Preguntas del refugio: interpretación del pedido.** El pedido dice dos cosas que a primera vista chocan: que la pregunta del refugio "reemplaza a la pregunta aleatoria del siguiente pedido" y que se manda "para que me responda ahora" sin mover la secuencia. Se reconciliaron así: se manda **ya** cuando no hay nada activo, y queda **programada para el próximo pedido** cuando hay una pregunta activa (que no se puede tocar). Si el equipo quiere otro comportamiento, la decisión vive en `enviarPregunta` del service.
- **2026-09-26 — Dónde viven las preguntas del refugio.** Se guardan en `Pregunta_Seguimiento` con `solicitud_id` en vez de un campo de texto libre en `Seguimiento`: así todo pedido sigue teniendo su FK a una pregunta (sin ramas en el código que arma GUI-21) y la pregunta programada es simplemente "una de esa solicitud que ningún pedido usó". El catálogo queda definido como las filas con `solicitud_id` null.
- **2026-09-26 — Catálogo único para adopción y tránsito.** El listado nuevo de 25 preguntas + la inicial se carga igual en los dos flujos (el campo `es_adopcion` se mantiene por si más adelante divergen). El seed da de baja lógica las preguntas del catálogo anterior.
- **2026-09-02 — Textos de error literales.** `Completar descripción`, `Limite de caracteres superado` y `Adjuntar imagen de prueba` son texto evaluable de la consigna académica. Para no escribir validación genérica dentro del DTO (regla de AGENTS.md), `shared/validation/text.ts` acepta mensajes de error a medida y el DTO solo los compone.
