# Pedido de web-admin al backend — detalle del objeto reportado (spec 008)

**Estado:** implementado en la spec 008 (§4). Diferencias: `reportesRecibidos` se omitió (lo cubren `reportesPendientes`/`reportesTotales`); `Campania` no tiene alias ni CBU en el modelo, así que `vista` no los trae hasta el Módulo 12; `montoActual` suma las donaciones activas. La baja de aviso (`PATCH /admin/animales-perdidos/:id/baja`) se hizo; la de campaña sigue esperando el Módulo 12.

**Contexto:** la pantalla Moderación de web-admin (`/admin/moderacion`) ya lista y resuelve reportes. Para que el admin decida sin salir del modal, el detalle del reporte muestra el objeto reportado con fotos y datos.

**Hoy se resuelve en el cliente** con endpoints existentes: `PUBLICACION` (`GET /admin/publicaciones/:id`) y `REFUGIO` (`GET /admin/refugios/:id`). Para los demás tipos no hay endpoint de detalle, así que el modal muestra solo etiqueta, estado y motivo.

## Resumen: cuántas rutas cambian

**Ninguna ruta nueva es obligatoria.** Son dos rutas existentes que se amplían y, a lo sumo, una ruta nueva.

| Ruta | Cambio | Prioridad |
|---|---|---|
| `GET /admin/reportes/:id` | Agrega `objeto.vista` (persona, reseña, aviso, campaña) y `objeto.reportesPendientes` / `reportesTotales` | Alta |
| `GET /admin/reportes` | Agrega `objeto.imagenUrl` y `objeto.reportesPendientes` por ítem | Media / baja |
| `PATCH /admin/animales-perdidos/:id/baja` | **Nueva.** Baja del aviso reportado (deuda #28) | Opcional, ver §4 |
| Baja de campaña | Depende del Módulo 12 (HU-12.5), no es de este pedido | — |

No cambia ningún contrato que hoy use web-admin: los campos nuevos son **opcionales** y el panel los ignora si no vienen, así que el backend puede entregarlos de a uno. Nada de esto toca el modelo de datos.

## 1. `objeto.vista` en `GET /admin/reportes/:id` (prioridad alta)

Un campo opcional dentro de `objeto`, con forma según `tipo`. Una sola llamada en vez de un detalle por tipo, y no obliga a web-admin a conocer cada módulo. Las rutas de archivo van relativas (`/api/v1/archivos/...`), como en el resto de la API.

| `tipo` | `vista` |
|---|---|
| `USUARIO` | `{ nombre, apellido, email, telefono, imagenUrl, verificado, estado, fechaAlta, provincia, localidad, refugios: [{id, nombre}], reportesRecibidos: { pendientes, total } }` |
| `RESENA` | `{ puntuacion, comentario, fecha, autor: {id, nombre, apellido}, receptor: {tipo: 'REFUGIO' \| 'PERSONA', id, nombre} }` |
| `ANIMAL_PERDIDO` | `{ nombre, estado, descripcion, imagenes[], ubicacion, fechaSuceso, reportante: {id, nombre, apellido} }` |
| `CAMPANIA` | `{ titulo, descripcion, estado, montoObjetivo, montoActual, fechaInicio, fechaFin, imagenes[], refugio: {id, nombre} }` (cuando exista el Módulo 12; incluir alias/CBU, es lo que se denuncia) |
| `MENSAJE` | ya está resuelto con `contexto[]`; sin cambios |

**Web-admin ya lo consume:** el tipo `VistaObjetoReporte` en `frontend/apps/web-admin/src/types/admin-reportes.ts` fija los nombres exactos, discriminado por `tipo` (la `vista` lleva también `tipo`). Mientras el backend no lo mande, esos cuatro tipos muestran «Todavía no hay más detalle».

`PUBLICACION` y `REFUGIO` no necesitan `vista`: el cliente usa sus endpoints actuales.

## 2. Contador de reincidencia (prioridad media)

En el ítem del listado y en el detalle: `objeto.reportesPendientes` y `objeto.reportesTotales` (mismo `tipo` + `objetoId`). Hoy solo `PUBLICACION` lo tiene (vía `reportes[]`). Con esto el admin prioriza los objetos reportados varias veces sin abrir cada uno. El índice `(tipo, objeto_id)` ya lo soporta.

## 3. Miniatura en el listado (prioridad baja)

`objeto.imagenUrl` en cada ítem de `GET /admin/reportes` (portada de la publicación o aviso, logo del refugio, avatar de la persona; `null` si no aplica) para mostrar una miniatura en la tabla.

## 4. Acciones sobre el objeto que hoy no existen (ya anotadas en spec 008)

- Baja de `ANIMAL_PERDIDO` (deuda #28): sin endpoint, ni de dueño ni de admin.
- Baja de `CAMPANIA` (HU-12.5): depende del Módulo 12.
- Suspender al autor de un `MENSAJE`: se puede con `PATCH /admin/usuarios/:id/suspender`, pero el detalle del reporte debería traer `objeto.contexto[].usuario.id` (ya lo trae) y el autor del reportado resaltado; sin pedido adicional.

Sin estas bajas el admin solo puede resolver el reporte y, a lo sumo, suspender a la persona o al refugio.
