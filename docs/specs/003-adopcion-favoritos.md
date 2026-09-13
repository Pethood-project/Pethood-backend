# Spec 003 — Adopción y Favoritos

**Estado:** APROBADA
**Sprint:** 3 · **Responsable:** (asignar) · **Última actualización:** 2026-09-09

## 1. Objetivo

Permitir que un adoptante solicite adoptar una mascota publicada y guarde publicaciones en favoritos, y que el refugio gestione las solicitudes que recibe sobre sus mascotas.

## 2. Alcance

- **Incluye:** favoritos (alta/baja/listado, HU-6.6 y HU-7.2 — **ya implementado**, ver `src/modules/favoritos/`), y del lado Solicitud: crear solicitud (HU-7.1), historial propio del adoptante (HU-7.3), que quien publicó la mascota la acepte/rechace (HU-7.4), su historial recibido (HU-7.5), cancelación automática por vencimiento (HU-7.6) y el feed de solicitudes del adoptante (HU-7.7).
- **Implementado:** HU-7.1, HU-7.3, HU-7.4, HU-7.5 y HU-7.6, backend y app mobile. HU-7.7 queda pendiente.
- **NO incluye:** notificaciones al aceptar/rechazar (spec 004, Chat y Notificaciones), seguimiento post-adopción (spec 006).

## 3. Entidades involucradas

`Solicitud`, `Solicitud_Estado` (histórico), `Estado_Solicitud`, `Tipo_Solicitud`, `Publicacion`, `Favorito`, `Hogar` — ver `MODELO_DATOS.md`. Nombres reales de `Estado_Solicitud` (seedeados en `prisma/seed.ts`): `Pendiente, En_Revision, Aprobada, Rechazada, Cancelada`. `Tipo_Solicitud`: `Adopcion` y `Transito`, ambos con `secuenciaDias = 180` (ventana de la cancelación automática de HU-7.6).

HU-7.1 agregó columnas fuera del diagrama de clases (migración `20260908210000_hu71_solicitud_transito_y_hogar`): el período de tránsito en `Solicitud` y las respuestas del hogar en `Hogar`. Los campos exactos y el porqué están en `MODELO_DATOS.md`; el desvío quedó anotado en `REQUISITOS.md` §10.

**El hogar no cuelga de la solicitud.** Un usuario tiene un solo hogar vigente (índice parcial `hogar_usuario_activo_uq`) y el formulario lo actualiza en cada solicitud; el refugio lo alcanza por `solicitud.usuario`.

No es una simplificación: es el modelo correcto del dominio. Una persona tiene un hogar, y es donde va a vivir el animal.

Se evaluó y **descartó** la alternativa de un `Hogar` por solicitud con FK en `Solicitud`:

- Habilitaría declarar dos casas distintas en dos solicitudes simultáneas. Eso no es una funcionalidad, es un agujero: una de las dos declaraciones sería falsa y el refugio no tendría cómo saber cuál.
- Rompería el seguimiento post-adopción. `Seguimiento` cuelga de `Solicitud` y sus preguntas de tránsito son sobre la adaptación **al hogar** (`prisma/seed.ts`); con dos solicitudes aprobadas habría dos hogares "vigentes" para la misma persona.
- El único argumento a favor era conservar lo declarado el día del envío. No aplica: si el solicitante se mudó, la dirección que le sirve al refugio para ir a visitar la casa es la **actual**, no la vieja. Ninguna HU pide el histórico de hogares.

## 4. API

| Método | Ruta | Auth | Descripción | Estado |
|---|---|---|---|---|
| POST | /api/v1/favoritos | JWT | Guarda una mascota en favoritos (HU-7.2) | implementado |
| GET | /api/v1/favoritos | JWT | Lista favoritos del adoptante (HU-6.6) | implementado |
| DELETE | /api/v1/favoritos/:mascotaId | JWT | Quita de favoritos | implementado |
| POST | /api/v1/solicitudes | JWT | Crea una solicitud de adopción o tránsito sobre una publicación, con el hogar del solicitante (HU-7.1) | **implementado** |
| GET | /api/v1/solicitudes/elegibilidad | JWT | Chequeo previo de las precondiciones de HU-7.1, con `?publicacionId=` opcional | **implementado** |
| GET | /api/v1/solicitudes/mias | JWT | Historial propio de solicitudes, filtro `?estado=` (HU-7.3) | **implementado** |
| GET | /api/v1/solicitudes/recibidas | JWT (quien publicó la mascota) | Solicitudes que el actor puede gestionar, filtro `?estado=` (HU-7.5) | **implementado** |
| GET | /api/v1/solicitudes/:id | JWT (quien publicó la mascota **o** el solicitante) | Detalle con el hogar declarado, el período de tránsito y el histórico completo de estados (HU-7.5 y HU-7.3) | **implementado** |
| PATCH | /api/v1/solicitudes/:id/estado | JWT (quien publicó la mascota) | Acepta o rechaza una solicitud "Pendiente" (HU-7.4) | **implementado** |
| — | cron `cancelar-solicitudes-vencidas.job.ts` | usuario SISTEMA | Baja lógica de solicitudes "Pendiente" con más de `tipoSolicitud.secuenciaDias` días desde que entraron en ese estado (HU-7.6) | **implementado** |

Ejemplo, crear una solicitud de tránsito:

```json
POST /api/v1/solicitudes
{
  "publicacionId": 40,
  "tipoSolicitud": "Transito",
  "motivacion": "Vivimos en una casa con patio y ya criamos perros grandes.",
  "fechaInicioTransito": "2026-09-15",
  "fechaFinTransito": "2026-12-15",
  "hogar": {
    "direccion": "Av. Santa Fe 3450, Palermo",
    "tipoVivienda": "Casa",
    "espacioExterior": "Patio",
    "tieneNinios": false,
    "tieneMascotas": true,
    "detalleMascotas": "1 gato y otros 2 perros grandes",
    "experienciaPrevia": true,
    "horasSolo": 8,
    "descripcion": null
  }
}
→ 201 { "id": 1042, "estado": { "id": 1, "nombre": "Pendiente" },
        "transito": { "fechaInicio": "2026-09-15", "fechaFin": "2026-12-15" },
        "hogar": { "direccion": "Av. Santa Fe 3450, Palermo", ... }, ... }
```

En una adopción, `tipoSolicitud` es `"Adopcion"` y las dos fechas se omiten; si llegan igual, se descartan en vez de rechazar el request (el formulario que pasa de tránsito a adopción deja de mostrar esos campos y no puede quedar trabado por ellos). Las fechas viajan como `AAAA-MM-DD` en los dos sentidos: son días de calendario, no instantes.

Ejemplo, el chequeo previo que hace la UI antes de abrir el formulario:

```json
GET /api/v1/solicitudes/elegibilidad?publicacionId=40
→ 200 {
  "puedeSolicitar": false,
  "motivo": "LIMITE_ALCANZADO",
  "mensaje": "No podés solicitar otra mascota",
  "verificado": true, "pendientes": 5, "maximo": 5,
  "solicitudAbiertaId": null
}
```

Ejemplo, aceptar una solicitud:

```json
PATCH /api/v1/solicitudes/12/estado
{ "estado": "Aprobada", "comentario": "Bienvenido a la familia" }
→ 200 {
  "id": 12, "publicacionId": 5,
  "mascota": { "id": 5, "nombre": "Toby", "imagenUrl": "..." },
  "solicitante": { "id": 3, "nombre": "Ana", "apellido": "Pérez" },
  "tipoSolicitud": "Adopcion",
  "estado": { "id": 3, "nombre": "Aprobada" },
  "comentario": "Bienvenido a la familia",
  "motivacion": "...",
  "fechaAlta": "2026-08-20T12:00:00.000Z",
  "fechaRespuesta": "2026-09-02T18:00:00.000Z",
  "historial": [
    { "id": 3, "nombre": "Aprobada", "fecha": "2026-09-02T18:00:00.000Z" },
    { "id": 1, "nombre": "Pendiente", "fecha": "2026-08-20T12:00:00.000Z" }
  ]
}
```

Ejemplo, listar recibidas:

```json
GET /api/v1/solicitudes/recibidas?estado=Pendiente&limite=20&desplazamiento=0
→ 200 { "total": 1, "solicitudes": [ { "id": 12, "estado": { "id": 1, "nombre": "Pendiente" }, ... } ] }
```

Errores: `400 VALIDACION`, `404 NO_ENCONTRADO` (no existe O el actor no puede verla — mismo código para no filtrar si existe), `409 SOLICITUD_YA_RESUELTA` (no está en "Pendiente", incluye la carrera de dos PATCH concurrentes).

Del alta (HU-7.1), en el orden en que se evalúan:

| Código | HTTP | Mensaje | Cuándo |
|---|---|---|---|
| `USUARIO_NO_VERIFICADO` | 403 | "Tenés que verificarte antes de solicitar una adopción" | Precondición de la HU (usuario sin verificar) |
| `SOLICITUD_DUPLICADA` | 409 | "Ya tenés una solicitud abierta para esta mascota" | Ya hay una solicitud viva suya sobre esa publicación |
| `LIMITE_SOLICITUDES` | 409 | "No podés solicitar otra mascota" | Ya tiene 5 en "Pendiente" (regla transversal 7) |
| `NO_ENCONTRADO` | 404 | "La publicación no existe" | Publicación dada de baja o inexistente |
| `PUBLICACION_PROPIA` | 403 | "No podés solicitar tu propia mascota" | La mascota es del solicitante |
| `MASCOTA_NO_DISPONIBLE` | 409 | "Esta mascota ya no está disponible" | Estado vigente distinto de `Disponible` |

Los dos primeros mensajes son **textos literales de los criterios de aceptación** de HU-7.1, no genéricos. Se sirven desde una sola tabla en `solicitudes.service.ts` para que `/elegibilidad` y el `POST` no puedan decir cosas distintas.

## 5. Pantallas (frontend)

| GUI | Pantalla | Dónde |
|---|---|---|
| GUI-7.1.1 | Formulario de solicitud, 4 pasos: tipo (+ período si es tránsito), hogar, motivo y confirmación | `components/solicitudes/SolicitudModal.tsx` + un archivo por paso |
| GUI-7.1.2 | Confirmación: la solicitud ya creada, con salida a "Ver mi solicitud" | `components/solicitudes/PasoExito.tsx` |
| GUI-10 / GUI-12 | El CTA que abre el formulario, en la ficha del animal y en cada tarjeta de Favoritos | `components/solicitudes/BotonSolicitar.tsx` |
| GUI-0.1.x | Los dos carteles de bloqueo (sin verificar / 5 pendientes) | variante `bloqueo` de `ConfirmDialog` |
| GUI-27 | Solicitudes, con las dos vistas: "Enviadas" (HU-7.3) y "Recibidas" (HU-7.4/7.5) | `app/solicitudes/index.tsx` |
| — | Detalle: el refugio lee las respuestas del hogar y el período; el solicitante ve lo mismo sin los botones | `app/solicitudes/[id].tsx` |

Es un modal y no una ruta del stack porque se abre desde dos lugares y el borrador vive lo que dura el formulario. El botón consulta `/elegibilidad` **al tocarlo**, no al montar: en la grilla de Favoritos serían tantas peticiones como tarjetas, y ninguna sirve hasta que el usuario decide.

## 6. Reglas de negocio y validaciones

1. Solo se puede resolver (aceptar/rechazar) una solicitud en estado vigente `Pendiente`; cualquier otro estado devuelve `409 SOLICITUD_YA_RESUELTA`.
2. "Quien publicó la mascota" no es siempre un refugio: un adoptante particular también puede ofrecer una mascota propia en adopción (`mascotas.dto.ts`, actor `ADOPTANTE` + destino `ADOPCION`). La autorización se resuelve por actor, no por rol fijo:
   - mascota de refugio (`mascota.refugioId` no nulo) → cualquier miembro de ESE refugio, sin importar quién la cargó — mismo criterio que el ámbito "REFUGIO" de `mascotas.repository.listarPorAmbito` y el dashboard de refugio (decisión de equipo: la resolución es organizacional, no personal de quien publicó).
   - mascota personal (`refugioId` nulo) → solo quien la publicó (`mascota.usuarioId`).
3. Ver o resolver una solicitud que no es del actor devuelve `404 NO_ENCONTRADO`, igual que si no existiera — no se distingue "no es tuya" de "no existe" (mismo criterio que `favoritos.service.ts` con los favoritos de otro usuario).
4. Resolver una solicitud es atómico (transacción `Serializable`): revalida que siga "Pendiente" en el mismo momento de escribir, así dos PATCH concurrentes sobre la misma solicitud no pueden pisarse — el que pierde la carrera recibe `409` en vez de dejar el histórico inconsistente.
5. Resolver una solicitud escribe en `LogAuditoria` (acción `APROBAR`/`RECHAZAR`, detalle `"<estado anterior> -> <estado nuevo>"`).
6. Máximo 5 solicitudes "Pendiente" simultáneas por adoptante (regla transversal 7 de `AGENTS.md`). Se cuenta sobre el estado **vigente** del histórico y no sobre `fechaRespuesta`: una "En_Revision" tampoco tiene respuesta y no debe sumar al tope.
8. **El alta es atómica**: hogar + solicitud + primer estado "Pendiente" en una sola transacción. Una solicitud sin estado vigente rompe todas las lecturas del módulo, que resuelven el estado actual con `historicoEstados[0]`.
9. **El detalle lo ven las dos puntas**, quien publicó la mascota y el propio solicitante; resolver sigue siendo solo de quien publicó. Son dos criterios distintos sobre la misma consulta (`visiblePor` / `gestionablePor` en el service), no dos endpoints.
10. **`tienePatio` no se pregunta**: se deriva de `espacioExterior` (`Patio` o `Jardin` → verdadero). Ver `MODELO_DATOS.md`.
11. **El detalle de otras mascotas se descarta** si el usuario respondió que no tiene: el campo solo se muestra con el interruptor encendido, y un texto huérfano confundiría al refugio.
12. Crear una solicitud escribe en `LogAuditoria` (acción `CREAR`).
7. Cancelación automática (HU-7.6): más de `tipoSolicitud.secuenciaDias` días desde que la solicitud entró en "Pendiente" (no desde `solicitud.fechaAlta` si en algún momento pasó por otro estado intermedio) → baja lógica con `usuario_baja = "SISTEMA"` y nuevo estado "Cancelada" en el histórico. Corre por `cancelarSiPendiente`, con la misma revalidación atómica (transacción `Serializable`) que HU-7.4: si un humano resuelve la solicitud en el instante entre que el cron la lee y la cancela, el cron no pisa esa resolución.

## 7. Criterios de aceptación

- [x] Quien publicó la mascota puede listar las solicitudes que recibió.
- [x] Puede filtrar ese listado por estado.
- [x] Puede ver el detalle de una solicitud con el histórico completo de estados.
- [x] Puede aceptar una solicitud "Pendiente" con un comentario opcional.
- [x] Puede rechazar una solicitud "Pendiente" con un comentario opcional.
- [x] Intentar resolver una solicitud ya resuelta devuelve `409 SOLICITUD_YA_RESUELTA`.
- [x] Un miembro de otro refugio no puede ver ni resolver una solicitud que no es de su refugio (`404`).
- [x] Un adoptante particular puede gestionar las solicitudes de su propia mascota publicada, aunque no pertenezca a ningún refugio.
- [x] Un adoptante no puede ver ni resolver la solicitud de OTRO adoptante sobre una mascota que no es suya (`404`).
- [x] Dos PATCH concurrentes sobre la misma solicitud no corrompen el histórico: uno gana, el otro recibe `409`.
- [x] Una solicitud "Pendiente" con más días que `tipoSolicitud.secuenciaDias` se cancela sola vía el cron, con `usuario_baja = "SISTEMA"`.
- [x] El cron respeta `secuenciaDias` por tipo (no un valor fijo de 180 hardcodeado).
- [x] El cron no cancela una solicitud que un humano ya resolvió (`En_Revision`, `Aprobada`, `Rechazada`).
- [x] Un adoptante verificado puede crear una solicitud de adopción sobre una publicación.
- [x] Puede crear una de tránsito indicando fecha de inicio y de fin.
- [x] Si elige tránsito y no completa el período, ve el texto literal "Tenés que completar el campo", y las dos puntas se reportan juntas.
- [x] Un fin anterior o igual al inicio se rechaza; un inicio anterior a hoy también.
- [x] Un usuario sin verificar ve "Tenés que verificarte antes de solicitar una adopción" y no llega al formulario.
- [x] Con 5 solicitudes "Pendiente" ve "No podés solicitar otra mascota".
- [x] No puede solicitar dos veces la misma publicación, ni su propia mascota, ni una que ya no está `Disponible`.
- [x] Las respuestas del hogar se guardan y las lee quien resuelve, con la misma pregunta que se le mostró al solicitante.
- [x] La segunda solicitud del mismo usuario arranca con el hogar ya cargado.
- [x] El solicitante ve el detalle y el estado de lo que mandó, sin los botones de aceptar/rechazar.
- [ ] Feed de solicitudes en el inicio del adoptante (HU-7.7, pendiente).

## 8. Casos borde y errores

Solicitud de un refugio/adoptante ajeno (`404`, indistinguible de "no existe" para no filtrar información) · doble PATCH concurrente sobre la misma solicitud (conflicto de serialización de Postgres, el que pierde recibe `409`) · comentario vacío (válido, es opcional) · usuario sin ninguna mascota publicada pidiendo `/recibidas` (lista vacía, no error) · el cron corre dos veces seguidas sobre la misma solicitud vencida (idempotente: la segunda vez ya tiene `fechaBaja` y no vuelve a aparecer en `listarSinRespuesta`).

## 9. Notas y decisiones

- 2026-09-09: HU-7.1 y HU-7.3 implementadas, backend y mobile. Decisiones que quedaron:
  - **Un hogar vigente por usuario** en vez de uno por solicitud (§3). Discutido y confirmado: la alternativa habilitaba declarar dos casas distintas a la vez y dejaba ambiguo a qué hogar se refiere el seguimiento post-adopción. El razonamiento completo, en §3.
  - **El período de tránsito va en `Solicitud`**, no en `Hogar`: es de esa solicitud, y `hogar_inicio_disponibilidad`/`fin_disponibilidad` se pisarían entre dos tránsitos.
  - **`GET /elegibilidad` aparte del `POST`.** El chequeo previo existe para que la UI muestre el cartel del bloqueo en vez de hacerle completar cuatro pasos a alguien que no puede solicitar. No reemplaza la validación del alta: es UX, y el `POST` vuelve a correr las mismas reglas desde la misma tabla de mensajes.
  - **`GET /favoritos` devuelve `publicacionId` y `solicitudAbiertaId`** para que la grilla decida el botón de cada tarjeta con una sola petición, en vez de una por tarjeta.
  - Textos literales de la HU respetados palabra por palabra en los tres mensajes que la HU fija. La referencia a GUI-0.1.4 quedó anotada como inconsistencia en `REQUISITOS.md` §10.5.
  - Sin aplicar todavía: la migración `20260908210000_hu71_solicitud_transito_y_hogar` está escrita pero no corrió (Docker no levantaba en la máquina donde se implementó). Correr `docker compose up -d && npx prisma migrate deploy`.

- 2026-09-02: spec inicial, escrita junto con la implementación de HU-7.4/7.5 (backend). El nombre del estado de aceptación en el catálogo es `Aprobada`, no "Aceptada". Fixtures de prueba en `prisma/seed-solicitudes.ts`. HU-7.1/7.3/7.6/7.7 quedan documentadas como contrato pendiente para un PR siguiente.
- 2026-09-02: corregido el alcance para cubrir también al adoptante particular que publica su propia mascota (no solo refugios) — se había pasado por alto en la primera pasada. Autoridad de refugio confirmada como organizacional (cualquier miembro, no solo quien cargó la mascota). Se agregó revalidación atómica del estado (transacción `Serializable`) para cerrar una carrera entre dos PATCH concurrentes que la primera versión no contemplaba.
- 2026-09-02: HU-7.6 implementada. `src/jobs/cancelar-solicitudes-vencidas.job.ts`, función pura + entrypoint CLI (`require.main === module`), pensado para invocarse desde crontab/systemd timer del sistema operativo — no hay scheduler embebido en el proceso Node (ver razones en la conversación de planificación: sin orquestador en `docker-compose.yml`, `node-cron` sumaría una dependencia y un riesgo de doble ejecución si el server escala a más de una instancia). Reusa el mismo patrón de transacción `Serializable` que `resolverSiPendiente` (`solicitudes.repository.ts` → `cancelarSiPendiente`) para no pisar una resolución humana concurrente. Probado con datos reales: una solicitud vencida ad-hoc (200 días) se canceló correctamente (baja lógica + estado "Cancelada" + entrada en `LogAuditoria`), y una segunda corrida del job no la vuelve a tocar (idempotente).
