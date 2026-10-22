# Spec 029 — Vacunas como catálogo administrable

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-10-22

## 1. Objetivo

Que el administrador pueda crear, editar y dar de baja vacunas desde el panel web-admin, en vez
de que el plan de vacunación sea un enum de `schema.prisma` y una constante en código. Cierra el
ítem 26 de `DEUDA_TECNICA.md` y reemplaza la decisión de la spec 019 de que el plan es fijo.

## 2. Alcance

- **Incluye:**
  - Tabla `Vacuna` (catálogo) y tabla `Vacuna_Especie` (qué especies admite cada vacuna).
  - `Historia_Clinica` pasa de `tipo_vacuna` (enum) a `vacuna_id` (FK).
  - ABM completo en `/admin/catalogos/vacunas` (alta, edición, baja y reactivar) y su pantalla
    en web-admin.
  - Migración de datos: las 7 vacunas actuales y los registros de historia clínica existentes.
  - Los selectores de la app (alta de mascota, alta de historia clínica) y las medallas leen el
    catálogo desde la base.
- **NO incluye:**
  - Tabla `Vacuna_Mascota`: no hace falta (ver §3).
  - Reordenar vacunas: se ordenan por creación (`vacuna_id`), sin campo de orden.
  - Color de las medallas: la columna `vacuna_color` queda creada y sin uso (nullable) para una
    spec futura. No se expone en la API ni en el panel; mobile sigue con sus colores propios.
  - Recordatorios de próxima dosis ni dosis por edad.
  - Migrar las vacunas sin tipo anteriores a la spec 019 (`DEUDA_TECNICA.md` ítem 20).

## 3. Entidades involucradas

Cambios sobre `docs/MODELO_DATOS.md`. **Son dos tablas nuevas, no tres.**

Una vacuna aplicada a una mascota ya es un registro de `Historia_Clinica` (con `mascota_id`,
fecha de visita y `vacunacion = true`), inmutable y con auditoría. Una `Vacuna_Mascota` repetiría
esos datos y habría que mantener las dos tablas iguales.

### `Vacuna`

| Campo | Tipo | Notas |
|---|---|---|
| `vacuna_id` | PK | |
| `vacuna_codigo` | texto, único | Identificador estable (`ANTIRRABICA`). Se genera del nombre al crear y **no se edita**. Es lo que viaja en la API como `tipo` y lo que la app usa para el color. |
| `vacuna_nombre` | texto, único | Nombre visible. |
| `vacuna_descripcion` | texto, obligatorio | La que la app precarga en la historia clínica y muestra al tocar la medalla. Hasta `LIMITES.catalogo.descripcion.max` (200). |
| `vacuna_color` | texto, nullable | **Reservado, sin uso en esta spec.** Siempre nulo: no se carga ni se devuelve. La app usa su mapa propio por `tipo`; una vacuna nueva cae en el color por defecto. |

El orden en los selectores es el de creación (`vacuna_id` ascendente). La migración inserta las
7 vacunas actuales en orden de calendario, así que conservan el orden que tenían.
| auditoría | | `usuario_alta`, `fecha_alta`, `usuario_modificacion`, `fecha_modificacion`, `usuario_baja`, `fecha_baja` |

### `Vacuna_Especie` (N:M)

| Campo | Tipo | Notas |
|---|---|---|
| `vacuna_especie_id` | PK | |
| `vacuna_id` | FK NOT NULL | |
| `especie_id` | FK NOT NULL | |
| auditoría | | La baja es lógica: volver a asociar una especie quitada reactiva la fila. |

Único `(vacuna_id, especie_id)`. `ANTIRRABICA` se asocia a Perro y a Gato.

### `Historia_Clinica`

- Se elimina `historia_clinica_tipo_vacuna` y el enum `tipo_vacuna`.
- Campo nuevo `vacuna_id` (FK a `Vacuna`, nullable). Va junto con `historia_clinica_vacunacion
  = true`; nulo en los registros que no son vacuna.

### Migración

Una sola migración de Prisma, con SQL de datos a mano:

1. Crear `vacuna` y `vacuna_especie`.
2. Insertar las 7 vacunas del plan actual, en orden de calendario, con su `codigo` = valor del
   enum, `nombre` y `descripcion` de `src/shared/vacunas.ts`, y asociarlas a su especie
   (buscando la especie por nombre).
3. Agregar `vacuna_id` a `historia_clinica` y completarlo con `UPDATE ... FROM vacuna WHERE
   vacuna_codigo = historia_clinica_tipo_vacuna::text`.
4. Eliminar `historia_clinica_tipo_vacuna` y el enum.

Antes de aplicarla en una base con datos reales, contar los registros con `tipo_vacuna` y
verificar que después tengan `vacuna_id` (misma cantidad).

## 4. API (contrato backend)

Se mantiene el patrón de `docs/api-admin-catalogos.md`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/admin/catalogos/vacunas` | admin | Lista (con `incluirBajas`, `q`, paginado). `id` pasa a ser **numérico**. |
| POST | `/api/v1/admin/catalogos/vacunas` | admin | Crea una vacuna. |
| PUT | `/api/v1/admin/catalogos/vacunas/:id` | admin | Edita nombre, descripción y especies. |
| PATCH | `/api/v1/admin/catalogos/vacunas/:id/baja` | admin | Baja lógica. |
| PATCH | `/api/v1/admin/catalogos/vacunas/:id/reactivar` | admin | Reactiva. |
| GET | `/api/v1/especies/:especieId/vacunas` | autenticado | Sin cambios de contrato; suma `id`. Orden de creación. |

`PERMISOS.vacunas` pasa a `{ alta: true, edicion: true, baja: true }`.

**`POST` body**

```json
{ "nombre": "Parvovirus canino", "descripcion": "…", "especieIds": [1] }
```

`codigo` no se recibe: lo genera el servidor.

**Respuesta** (igual que el resto de los catálogos, más lo propio):

```json
{
  "id": 8, "codigo": "PARVOVIRUS_CANINO", "nombre": "Parvovirus canino",
  "descripcion": "…",
  "especies": [{ "id": 1, "nombre": "Perro" }],
  "fechaAlta": "…", "fechaBaja": null,
  "cantidadUsos": 0, "puedeDarseDeBaja": true, "bloqueoBaja": null
}
```

**Endpoints que ya usan vacunas** (`POST /mascotas`, `GET /mascotas/:id`,
`POST /mascotas/:id/historias-clinicas`, publicaciones): **el contrato no cambia**. `tipoVacuna`
sigue siendo el `codigo` de la vacuna; el servidor lo resuelve a `vacuna_id`. Así la app no se
rompe y no hay que sincronizar un deploy.

Errores nuevos o con significado nuevo:

| HTTP | Código | Cuándo |
|---|---|---|
| 400 | `VALIDACION` | Nombre o descripción fuera de límites, `especieIds` vacío. |
| 404 | `ESPECIE_NO_ENCONTRADA` | Una especie de `especieIds` no existe o está de baja. |
| 409 | `CATALOGO_DUPLICADO` / `CATALOGO_DUPLICADO_DE_BAJA` | El nombre ya existe (activo o de baja). |
| 409 | `YA_DE_BAJA` / `NO_DE_BAJA` | Baja de una vacuna ya dada de baja / reactivar una activa. |

## 5. Pantallas (frontend)

**web-admin, Catálogos → Vacunas** (reutiliza `CatalogosTabla` y `CatalogoFormModal`):

- Tabla con nombre, especies, estado y acciones.
- Modal de alta y edición: nombre, descripción y especies (selección múltiple, al menos una).
  Validaciones inline con los límites de `limits.ts`.
- Baja con modal de confirmación; reactivar sin confirmación. Toasts en voseo.
- Estados: cargando, vacío, error.

**mobile:** sin pantallas nuevas. Las medallas siguen con el mapa de `constants/Vacunas.ts` por
`tipo`; una vacuna nueva cae en el color por defecto (hoy el de `primovacunacion`). El tipo
`TipoVacuna` de `services/vacunas.ts` deja de ser una unión de 7 strings y pasa a `string`.

## 6. Reglas de negocio y validaciones

1. Solo el administrador gestiona vacunas (backend, `requiereRol`).
2. `nombre` único entre todas las vacunas, activas o de baja.
3. `codigo` se genera una vez a partir del nombre (mayúsculas, guiones bajos, sin tildes) y no
   cambia nunca, aunque se edite el nombre. Si ya existe, se agrega un sufijo numérico.
4. Una vacuna admite al menos una especie, y solo especies activas.
5. **Baja de una vacuna:** siempre se puede si está activa, aunque haya registros que la usen.
   Deja de ofrecerse en los selectores de alta, pero las medallas de los registros existentes
   siguen mostrándose. Esto difiere de los demás catálogos (que bloquean la baja si están en
   uso) porque la historia clínica es inmutable y entonces nunca se podría dar de baja una
   vacuna que alguna vez se aplicó.
6. Quitar una especie de una vacuna no modifica los registros existentes. Las medallas de una mascota salen de todos sus registros vigentes con `vacuna_id`, aunque
   la vacuna esté de baja o ya no esté asociada a la especie de la mascota (una por vacuna, con
   la fecha más reciente, en orden de creación de la vacuna). Hoy se descartan las que la
   especie no admite; con la regla 5 y la 6 eso escondería vacunas realmente aplicadas.
7. Reactivar exige que al menos una de sus especies siga activa.
8. Los selectores de la app solo listan vacunas activas y con la especie de la mascota.
9. Toda operación escribe `LogAuditoria` (`CREAR`, `MODIFICAR`, `BAJA`, `REACTIVAR`), igual que
   el resto de los catálogos.

## 7. Criterios de aceptación

- [ ] Dado el admin, cuando crea una vacuna válida, entonces aparece en la tabla y en
      `GET /especies/:id/vacunas` de sus especies, con `codigo` generado.
- [ ] Dado un nombre ya existente, cuando se crea, entonces `409 CATALOGO_DUPLICADO`.
- [ ] Dada una vacuna usada en historias clínicas, cuando se da de baja, entonces ya no sale
      en el selector del alta, pero la medalla de la mascota que la tiene sigue visible.
- [ ] Dada una vacuna de baja, cuando se reactiva, entonces vuelve a salir en el selector.
- [ ] Dada una edición de nombre, cuando se guarda, entonces `codigo` no cambia.
- [ ] Dado un usuario no admin, cuando llama a cualquier endpoint de gestión, entonces `403`.
- [ ] Después de migrar, la cantidad de `historia_clinica` con `vacuna_id` igual a la cantidad
      que tenía `tipo_vacuna`, y las medallas se ven igual que antes.
- [ ] La app mobile sin actualizar sigue funcionando (el contrato de `tipoVacuna` no cambió).

## 8. Casos borde y errores

- Vacuna nueva sin entrada en el mapa de colores de mobile: la medalla usa el color por defecto.
- Especie dada de baja después de asociarla: la vacuna deja de ofrecerse para esa especie; no se
  toca la asociación.
- Dos admins crean el mismo nombre a la vez: la restricción única responde `409`.
- `tipoVacuna` con un `codigo` de una vacuna de baja en el alta de historia clínica:
  `404`/`400` como un código inexistente (no se puede aplicar una vacuna dada de baja).
- Migración sobre una base sin las especies Perro y Gato: la migración inserta las vacunas, el
  seed (idempotente) completa las asociaciones. Documentado en el seed.

## 9. Notas y decisiones

- **2026-10-22:** pasar de enum a tabla, con `Vacuna` + `Vacuna_Especie` y sin `Vacuna_Mascota`
  (la historia clínica ya cumple ese rol). Pedido del equipo.
- **Contrato estable:** se conserva `tipo` = `codigo` en los endpoints existentes para no
  forzar un deploy conjunto con la app.
- **2026-10-22, color:** fuera de esta spec. Los colores siguen en mobile; se deja la columna
  `vacuna_color` nullable y sin uso para una spec futura (probablemente un color base del que
  la app derive `fondo`, `borde` y `tinta`).
- **2026-10-22, orden:** el de creación, sin campo `orden` (se descartó para no mantener un
  campo que nadie edita).
- **2026-10-22, aprobada.**
- **2026-10-22, antirrábica:** tenía dos descripciones (la del perro aclaraba «obligatoria por
  ley»). Con una sola `Vacuna` queda una: «A partir de los 3 a 4 meses: Vacuna Antirrábica
  (obligatoria por ley).» para perro y gato.
- **Al implementar:** actualizar `docs/MODELO_DATOS.md`, `docs/api-admin-catalogos.md` y marcar
  el ítem 26 de `DEUDA_TECNICA.md` como resuelto; reemplazar `src/shared/vacunas.ts` y
  `listarVacunasDeEspecie` por un repository; el seed (`prisma/seed/catalogos.ts`) siembra las 7
  vacunas.
