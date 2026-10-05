# Backend pendiente — panel de administrador (web-admin)

Qué necesita `apps/web-admin` del backend para reemplazar las pantallas con datos de ejemplo (`ListaMock`) y completar el panel del administrador global.

**Convenciones** (las mismas de `admin-usuarios`): rutas bajo `/api/v1/admin`, JWT + `requiereRol(ROL_API.ADMIN)`, Zod en `<modulo>.dto.ts`, errores `{ error: { codigo, mensaje } }`, bajas siempre lógicas (regla transversal 1), operaciones críticas en `LogAuditoria`. Los listados de tabla paginan por **offset** (`page`/`limit` → `{ items, total, page, limit }`, ver «Paginación» en `AGENTS.md`). Las acciones destructivas o de moderación llevan `motivo` (mismo `motivoBodySchema` de `admin-usuarios`).

## 0. Estado actual

| Área | Pantalla web-admin | Backend hoy |
| --- | --- | --- |
| Dashboard + export CSV | Real | `GET /admin/dashboard`, `GET /admin/dashboard/exportar/:entidad` |
| Usuarios | Real | `GET/PATCH /admin/usuarios…` |
| Refugios | Real | `GET/POST/PATCH /admin/refugios…` |
| Consultas y FAQs | Real | módulo `soporte` |
| Mascotas | Mock | Solo `/mascotas/mias` y `/mascotas/:id` (del dueño) |
| Publicaciones | Mock | Solo endpoints del dueño (`/publicaciones/mias`, etc.) |
| Solicitudes | Mock | Solo `/solicitudes/recibidas` (refugio) y `/mias` (adoptante) |
| Campañas | Mock | **No existe módulo** (solo el modelo `EstadoCampania` en el schema) |
| Moderación / reportes | Mock | **No existe módulo** (`ReporteProblema` sin FKs) |
| Catálogos | Placeholder | Solo lecturas (`/catalogos/especies`, `/estados-*`), sin ABM |

## 1. Publicaciones

Hoy todo está acotado al usuario o refugio dueño (`publicaciones.routes.ts`).

- `GET /admin/publicaciones` — `page`, `limit`, `estados` (ids, coma), `refugioId`, `usuarioId`, `q` (título o nombre de mascota), `incluirBajas` (default `false`).
  Item: `{ id, titulo, imagenUrl, estado: {id,nombre}, mascota: {id,nombre,especie}, publicador: {tipo: 'REFUGIO'|'ADOPTANTE', id, nombre}, cantidadSolicitudes, cantidadReportes, fechaAlta, fechaBaja }`.
- `GET /admin/publicaciones/:id` — ficha completa (misma forma que `GET /publicaciones/:id`) + historial de estados + reportes asociados. Sin restricción de ámbito.
- `PATCH /admin/publicaciones/:id/estado` — `{ accion: 'PAUSAR'|'REACTIVAR'|'FINALIZAR', motivo }`. Mismas transiciones que la ruta del dueño, reutilizando el servicio.
- `PATCH /admin/publicaciones/:id/baja` — `{ motivo }`. Baja lógica por moderación (HU-3.5): setea `usuarioBaja`/`fechaBaja`, cierra el estado vigente, notifica al dueño con el motivo.
- `PATCH /admin/publicaciones/:id/reactivar` — revierte la baja.

## 2. Mascotas

- `GET /admin/mascotas` — `page`, `limit`, `estados`, `especieId`, `refugioId`, `usuarioId`, `q`, `incluirBajas`.
  Item: `{ id, nombre, especie, raza, estado: {id,nombre}, duenio: {tipo, id, nombre}, tienePublicacionActiva, fechaAlta, fechaBaja }`.
- `GET /admin/mascotas/:id` — ficha. La historia clínica es inmutable (regla 8): solo lectura, sin endpoints de edición.
- `PATCH /admin/mascotas/:id/baja` y `/reactivar` — `{ motivo }`, solo para casos de moderación (mascota falsa, datos ofensivos). Debe rechazar la baja si tiene una adopción en curso.

## 3. Solicitudes

Solo lectura para el admin: quien resuelve es el refugio (`PATCH /solicitudes/:id/estado`).

- `GET /admin/solicitudes` — `page`, `limit`, `estados`, `tipo` (adopción/tránsito), `refugioId`, `solicitanteId`, `desde`, `hasta`, `q`.
  Item: `{ id, mascota: {id,nombre}, solicitante: {id,nombre}, refugio: {id,nombre}|null, tipo, estado, fechaAlta }`.
- `GET /admin/solicitudes/:id` — detalle con historial de estados.
- (Opcional, decisión abierta) `PATCH /admin/solicitudes/:id/baja` con `{ motivo }` para casos de fraude. Si no se acuerda, dejarlo fuera.

## 4. Campañas de donación

No existe módulo. El refugio también lo necesita (`/refugio/campanas`, GUI-36/37, HU-12.1 a 12.7), así que conviene definirlo completo y que el admin sea la vista global.

**Lado admin**
- `GET /admin/campanias` — `page`, `limit`, `estados`, `refugioId`, `q`, `incluirBajas`.
  Item: `{ id, titulo, refugio: {id,nombre}, estado: {id,nombre}, montoObjetivo, montoConfirmado, montoDeclarado, fechaInicio, fechaFin }`.
- `GET /admin/campanias/:id` — detalle + donaciones declaradas y confirmadas.
- `PATCH /admin/campanias/:id/estado` — `{ accion: 'PAUSAR'|'FINALIZAR', motivo }` (moderación de campañas sospechosas).
- `PATCH /admin/campanias/:id/baja` y `/reactivar` — `{ motivo }`.

**Lado refugio** (no es del admin, pero desbloquea la pantalla): `GET/POST /refugio/campanias`, `PUT /refugio/campanias/:id`, `PATCH .../estado`, `POST .../donaciones/:id/confirmar`. Reglas: máx. 5 activas por refugio (regla 7); el monto declarado no mueve la barra hasta que el refugio confirma (regla 11); cron de transición de estados (regla 10).

Nota: el export del dashboard ya acepta la entidad `campanias`. Hoy no hay datos que exportar hasta que exista el módulo.

## 5. Moderación y reportes (Módulo 3, HU-3.1 a HU-3.7)

`ReporteProblema` existe en `schema.prisma` sin FKs ni módulo. **Decisión previa**: a qué apunta el reporte. Propuesta: `tipo` (`PUBLICACION`|`USUARIO`|`RESENIA`) + `entidadId` + `usuarioReportanteId` (agregar a `MODELO_DATOS.md`).

- `POST /reportes` (usuarios: HU-3.1 a 3.3) — `{ tipo, entidadId, motivo }`. Un reporte por usuario y entidad.
- `GET /admin/reportes` — `page`, `limit`, `tipo`, `resuelto`, `desde`, `hasta`. Item: `{ id, tipo, entidad: {id, etiqueta}, motivo, reportante: {id,nombre}, resuelto, fechaAlta }`. Alimenta el KPI `reportesPendientes` del dashboard.
- `GET /admin/reportes/:id` — detalle con la entidad reportada y reportes previos sobre ella.
- `PATCH /admin/reportes/:id/resolver` — `{ respuesta, accion: 'DESESTIMAR'|'BAJA_PUBLICACION'|'SUSPENDER_USUARIO' }`. Aplica la acción reutilizando `/admin/publicaciones/:id/baja` o `/admin/usuarios/:id/suspender`, guarda `respuesta` y marca `resuelto`.

## 6. Catálogos (ABM)

Hoy solo hay lecturas. Para el ABM de Especie, Raza, Vacuna y estados:

- `GET/POST/PUT /admin/catalogos/:catalogo` y `PATCH /admin/catalogos/:catalogo/:id/baja` (`:catalogo` ∈ `especies`, `razas`, `vacunas`, `estados-mascota`, `estados-publicacion`, `estados-solicitud`, `estados-campania`, `estados-refugio`, `estados-animal-perdido`, `tipos-solicitud`).
- Regla: no dar de baja un valor en uso (409 `CATALOGO_EN_USO`, como `CATEGORIA_CON_FAQS`).
- Los estados son parte de la lógica de negocio: sugerencia de permitir solo editar la descripción de los estados y limitar alta/baja a Especie, Raza y Vacuna.

## 7. Export CSV por pantalla

Cada listado tiene un ícono de descarga que llama a `GET /admin/dashboard/exportar/:entidad` (ya existe). Entidades usadas: `usuarios`, `mascotas`, `publicaciones`, `solicitudes`, `campanias`.

Pendiente: que el export acepte los **mismos filtros** que el listado (`?estados=…&refugioId=…&q=…`), para exportar lo que se está viendo y no toda la tabla. Sigue siendo por streams (regla 12).

## 8. Resumen de endpoints nuevos

| Módulo | Endpoints |
| --- | --- |
| admin-publicaciones | `GET /`, `GET /:id`, `PATCH /:id/estado`, `/:id/baja`, `/:id/reactivar` |
| admin-mascotas | `GET /`, `GET /:id`, `PATCH /:id/baja`, `/:id/reactivar` |
| admin-solicitudes | `GET /`, `GET /:id` (+ baja opcional) |
| admin-campanias | `GET /`, `GET /:id`, `PATCH /:id/estado`, `/:id/baja`, `/:id/reactivar` (+ módulo `campanias` del refugio) |
| reportes | `POST /reportes`, `GET /admin/reportes`, `GET /admin/reportes/:id`, `PATCH /admin/reportes/:id/resolver` |
| admin-catalogos | `GET/POST/PUT /admin/catalogos/:catalogo`, `PATCH .../:id/baja` |

Orden sugerido por dependencias: publicaciones → mascotas → solicitudes (solo lecturas, sin decisiones abiertas) → reportes (necesita definir FKs) → campañas (módulo completo) → catálogos.
