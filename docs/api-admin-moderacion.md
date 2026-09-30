# API — Moderación admin: publicaciones, mascotas y solicitudes

Todos los endpoints bajo `/api/v1/admin`. Requieren JWT + rol `Administrador`. Errores siempre `{ error: { codigo, mensaje } }`. Bajas lógicas, cada acción escribe en `LogAuditoria`.

**Listados** (tablas de web-admin, paginación por offset): query `page` (1), `limit` (20, máx. 50). Respuesta `{ items, total, page, limit }`. `estados` es una lista de ids separados por coma (`?estados=1,3`). `incluirBajas` (`true`/`false`, default `false`) incluye los dados de baja.

**Acciones con `motivo`:** body `{ "motivo": "..." }`, 1–500 caracteres.

---

## Publicaciones

### `GET /admin/publicaciones`
Filtros: `estados`, `refugioId`, `usuarioId`, `q` (título o nombre de mascota), `incluirBajas`.

```json
{
  "id": 12,
  "titulo": "Firulais",
  "imagenUrl": "https://…",
  "estado": { "id": 1, "nombre": "Activa" },
  "mascota": { "id": 5, "nombre": "Firulais", "especie": "Perro" },
  "publicador": { "tipo": "REFUGIO", "id": 2, "nombre": "Huellitas" },
  "cantidadSolicitudes": 3,
  "cantidadReportes": 0,
  "fechaAlta": "…",
  "fechaBaja": null
}
```
`publicador.tipo`: `REFUGIO` | `ADOPTANTE`. `cantidadReportes` es 0 hasta que exista el módulo de reportes.

### `GET /admin/publicaciones/:id`
El ítem de arriba más `descripcion`, `ubicacion`, `requisitos[]`, `personalidad[]`, `desparasitado`, `imagenes[]`, `mascota` ampliada (fecha de nacimiento, género, tamaño, castrado, raza), `historialEstados[]` (`estado`, `fechaAlta`, `fechaBaja`, `usuarioAlta`) y `reportes[]` (vacío por ahora). Incluye las dadas de baja.

### `PATCH /admin/publicaciones/:id/estado`
Body `{ "accion": "PAUSAR" | "REACTIVAR" | "FINALIZAR", "motivo": "..." }`. Devuelve el detalle.
Errores: `409 TRANSICION_INVALIDA`, `409 MASCOTA_NO_DISPONIBLE` (reactivar con mascota no disponible), `409 PUBLICACION_DE_BAJA`.

### `PATCH /admin/publicaciones/:id/baja`
Body `{ motivo }`. Cierra el estado vigente y **notifica al dueño** con el motivo. Error `409 PUBLICACION_DE_BAJA` si ya estaba.

### `PATCH /admin/publicaciones/:id/reactivar`
Sin body. Revierte la baja y devuelve la publicación a su último estado.
Errores: `409 PUBLICACION_NO_DE_BAJA`, `409 MASCOTA_DE_BAJA`, `409 YA_PUBLICADA` (la mascota ya tiene otra publicación en curso).

---

## Mascotas

### `GET /admin/mascotas`
Filtros: `estados`, `especieId`, `refugioId`, `usuarioId`, `q` (nombre), `incluirBajas`.

```json
{
  "id": 5,
  "nombre": "Firulais",
  "especie": "Perro",
  "raza": "Beagle",
  "estado": { "id": 1, "nombre": "Disponible" },
  "duenio": { "tipo": "REFUGIO", "id": 2, "nombre": "Huellitas" },
  "tienePublicacionActiva": true,
  "fechaAlta": "…",
  "fechaBaja": null
}
```

### `GET /admin/mascotas/:id`
El ítem más `fechaNacimiento`, `genero`, `peso`, `tamanio`, `castrado`, `descripcion`, `imagenUrl` e `historiaClinica[]` (`id`, `fechaVisita`, `titulo`, `descripcion`, `vacunacion`, `tipoVacuna`, `documentoUrl`). **Historia clínica solo lectura**: no hay endpoints de edición (regla 8).

### `PATCH /admin/mascotas/:id/baja`
Body `{ motivo }`. Da de baja la mascota **y sus publicaciones activas**, y notifica al dueño.
Errores: `409 ADOPCION_EN_CURSO` (hay solicitudes `Pendiente` o `En_Revision`), `409 MASCOTA_DE_BAJA`.

### `PATCH /admin/mascotas/:id/reactivar`
Body `{ motivo }`. Revierte **solo la mascota**: las publicaciones que arrastró la baja se reactivan una por una con `/admin/publicaciones/:id/reactivar`.
Error `409 MASCOTA_NO_DE_BAJA`.

---

## Solicitudes (solo lectura)

Quien las resuelve es el refugio; el admin solo las consulta.

### `GET /admin/solicitudes`
Filtros: `estados`, `tipo` (nombre del tipo de solicitud, sin distinguir mayúsculas), `refugioId`, `solicitanteId`, `desde` / `hasta` (fecha de alta, inclusive), `q` (mascota, nombre/apellido o email del solicitante).

```json
{
  "id": 30,
  "mascota": { "id": 5, "nombre": "Firulais" },
  "solicitante": { "id": 9, "nombre": "Ana Pérez" },
  "refugio": { "id": 2, "nombre": "Huellitas" },
  "tipo": "Adopcion",
  "estado": { "id": 1, "nombre": "Pendiente" },
  "fechaAlta": "…"
}
```
`refugio` es `null` si la mascota es de un adoptante.

### `GET /admin/solicitudes/:id`
El ítem más `publicacionId`, `motivacion`, `comentario`, `fechaRespuesta`, `fechaInicioTransito`, `fechaFinTransito`, `fechaBaja` e `historialEstados[]`. `404 NO_ENCONTRADO` si no existe.

---

## Errores comunes

| Status | `codigo` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDACION` | Body, query o `:id` inválido |
| 401 / 403 | — / `ROL_NO_AUTORIZADO` | Sin token / sin rol admin |
| 404 | `NO_ENCONTRADO` | El recurso no existe |
