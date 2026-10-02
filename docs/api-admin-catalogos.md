# API — ABM de catálogos (admin)

Todos los endpoints bajo `/api/v1/admin`. Requieren JWT + rol `Administrador`. Errores siempre `{ error: { codigo, mensaje } }`.

Los catálogos son tablas paramétricas: **las bajas nunca son en cascada**. Un valor con registros activos que lo usan **no se puede dar de baja**, y el backend te lo dice en cada ítem (`puedeDarseDeBaja` + `bloqueoBaja`) para que la UI deshabilite el botón sin adivinar.

## Catálogos (`:catalogo`)

| `:catalogo` | Tabla | Alta | Edición | Baja / reactivar | Qué se edita |
| --- | --- | --- | --- | --- | --- |
| `especies` | Especie | sí | sí | sí | `nombre`, `descripcion` |
| `razas` | Raza | sí | sí | sí | `nombre` (la especie no se cambia) |
| `vacunas` | — (enum de código) | no | no | no | **solo lectura** |
| `estados-mascota` | EstadoMascota | no | sí | no | `descripcion` |
| `estados-publicacion` | EstadoPublicacion | no | sí | no | `descripcion` |
| `estados-solicitud` | EstadoSolicitud | no | sí | no | `descripcion` |
| `estados-campania` | EstadoCampania | no | sí | no | `descripcion` |
| `estados-refugio` | EstadoRefugio | no | sí | no | `descripcion` |
| `estados-animal-perdido` | EstadoAnimalPerdido | no | sí | no | `descripcion` |
| `tipos-solicitud` | TipoSolicitud | no | sí | no | `descripcion`, `secuenciaDias` |

Por qué: los estados y tipos son parte de la lógica de negocio (el código los busca por nombre), por eso no se les toca el `nombre` ni se agregan/borran. Las vacunas son un plan fijo (`shared/vacunas.ts` + enum `TipoVacuna`), no hay tabla que administrar.

Un `:catalogo` que no existe responde `404 CATALOGO_NO_ENCONTRADO`.

---

## `GET /admin/catalogos/:catalogo`

Query (todas opcionales): `page` (1), `limit` (20, máx. 50), `q` (busca en `nombre`), `incluirBajas` (`true`/`false`, default `false`), `especieId` (solo `razas`).

**Respuesta:**

```json
{
  "catalogo": "especies",
  "permisos": { "alta": true, "edicion": true, "baja": true },
  "items": [
    {
      "id": 1,
      "nombre": "Gato",
      "descripcion": null,
      "fechaAlta": "2026-08-01T12:00:00.000Z",
      "fechaBaja": null,
      "cantidadUsos": 4,
      "puedeDarseDeBaja": false,
      "bloqueoBaja": {
        "codigo": "CATALOGO_EN_USO",
        "mensaje": "No se puede dar de baja: está en uso por 4 registro(s) activo(s)."
      }
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

- `permisos` es **por catálogo**: la UI lo usa para mostrar/ocultar «Nuevo», «Editar» y «Dar de baja» / «Reactivar».
- `puedeDarseDeBaja` es **por ítem**. Si es `false`, `bloqueoBaja.codigo` dice por qué:

| `bloqueoBaja.codigo` | Significa | Qué hace la UI |
| --- | --- | --- |
| `CATALOGO_SIN_BAJA` | El catálogo entero no admite bajas (estados, tipos, vacunas) | No mostrar el botón de baja |
| `CATALOGO_EN_USO` | Tiene `cantidadUsos` registros activos que lo usan | Botón deshabilitado con tooltip = `mensaje` |
| `YA_DE_BAJA` | Ya está dado de baja (`fechaBaja` no nula) | Mostrar «Reactivar» en vez de «Dar de baja» |

- `cantidadUsos` es informativo también en los catálogos sin baja (cuántos registros usan ese estado hoy).
- Qué cuenta como «uso» (solo registros vivos, sin baja): especie → razas + animales perdidos; raza → mascotas; estados → filas vigentes del histórico / entidades con ese estado; tipo de solicitud → solicitudes.

**Campos extra según catálogo:**
- `razas`: `"especie": { "id": 1, "nombre": "Perro" }`.
- `tipos-solicitud`: `"secuenciaDias": 7`.
- `vacunas`: `id` es un **string** (el tipo, ej. `"ANTIRRABICA"`), más `"especie": "Perro" | "Gato"`. `fechaAlta`/`fechaBaja` vienen `null` y siempre `puedeDarseDeBaja: false`.

---

## `POST /admin/catalogos/:catalogo`

Solo `especies` y `razas` (otro catálogo → `403 OPERACION_NO_PERMITIDA`).

```json
// especies
{ "nombre": "Conejo", "descripcion": "opcional" }
// razas
{ "nombre": "Mestizo", "especieId": 1 }
```

Límites: `nombre` 2–50, `descripcion` máx. 200 (`LIMITES.catalogo`, solo web-admin).

**200** → el ítem creado (misma forma que en el listado).

Errores: `400 VALIDACION`, `404 ESPECIE_NO_ENCONTRADA` (raza con especie inexistente o de baja), `409 CATALOGO_DUPLICADO`, `409 CATALOGO_DUPLICADO_DE_BAJA` (el nombre existe pero está dado de baja: el mensaje trae el id, ofrecé reactivarlo).

---

## `PUT /admin/catalogos/:catalogo/:id`

Edita solo los campos de la tabla de arriba. Campos que no correspondan al catálogo se **ignoran**.

```json
// especies
{ "nombre": "Conejo", "descripcion": "..." }
// razas
{ "nombre": "Mestizo" }
// estados-*
{ "descripcion": "Texto que ve el equipo" }
// tipos-solicitud
{ "descripcion": "...", "secuenciaDias": 7 }
```

`secuenciaDias`: entero 1–365. `descripcion` vacía → `null`.

**Respuesta:** el ítem actualizado.

Errores: `400 VALIDACION`, `403 OPERACION_NO_PERMITIDA` (vacunas), `404 NO_ENCONTRADO`, `409 YA_DE_BAJA` (reactivalo antes de editar), `409 CATALOGO_DUPLICADO` / `CATALOGO_DUPLICADO_DE_BAJA`.

---

## `PATCH /admin/catalogos/:catalogo/:id/baja`

Sin body. Baja lógica.

**Respuesta:** el ítem con `fechaBaja` cargada.

| Status | `codigo` | Cuándo |
| --- | --- | --- |
| 403 | `CATALOGO_SIN_BAJA` | Catálogo sin bajas (estados, tipos, vacunas) |
| 409 | `CATALOGO_EN_USO` | Tiene registros activos que lo usan |
| 409 | `YA_DE_BAJA` | Ya estaba dado de baja |
| 404 | `NO_ENCONTRADO` | El id no existe |

La UI no debería llegar a estos errores si respeta `puedeDarseDeBaja`; siguen ahí por si el dato cambió entre el listado y el click (otro usuario creó una mascota con esa raza, por ejemplo).

## `PATCH /admin/catalogos/:catalogo/:id/reactivar`

Sin body. Solo `especies` y `razas`. Revierte la baja.

Errores: `403 OPERACION_NO_PERMITIDA`, `404 NO_ENCONTRADO`, `409 NO_DE_BAJA`, `409 ESPECIE_DE_BAJA` (reactivar una raza cuya especie está de baja: reactivá la especie primero).

---

## Notas

- Sin borrado físico (regla transversal 1). Cada alta/edición/baja/reactivación escribe en `LogAuditoria` (`entidad: "Catalogo:<catalogo>"`).
- Dar de baja una especie **no** baja sus razas: por eso una especie con razas activas está `CATALOGO_EN_USO`. Hay que dar de baja las razas primero.
- Los selectores de los formularios (`GET /especies`, `/especies/:id/razas`, `/estados-*`) siguen igual y solo listan valores sin baja.
