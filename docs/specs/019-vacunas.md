# Spec 019 — Vacunas de la mascota

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-28

## 1. Objetivo

Que las vacunas de una mascota dejen de ser texto libre y pasen a ser datos: se eligen de un
plan de vacunación fijo por especie, viven en la historia clínica de la mascota y se ven como
medallas de color en su ficha y en su publicación. Une en un solo lugar lo que hoy está
repartido entre la publicación (campo de texto «Vacunas») y la historia clínica (tilde
«¿Es vacuna?»).

## 2. Alcance

- **Incluye:**
  - Plan de vacunación de perros y gatos, con nombre corto y descripción de para qué sirve
    cada vacuna, servido por especie.
  - Alta de mascota (HU-6.1): elegir varias vacunas a la vez, cada una con su fecha de
    aplicación. Se crean como registros de historia clínica en la misma transacción.
  - Alta de historia clínica (HU-8.1): lo primero es elegir «Vacuna» u «Otro registro». Una
    vacuna se elige de un selector, con fecha, y la descripción se precarga con la del plan.
    «Otro registro» (visita, inyección, operación…) sigue igual que antes.
  - Medallas: en la ficha de la mascota (HU-6.4) y en la de la publicación, una por vacuna,
    con un color fijo por vacuna en toda la app. Tocarla muestra para qué sirve.
  - Se elimina el campo `vacunas` de la publicación (alta y edición, spec 018).
- **NO incluye:**
  - Agregar vacunas desde «Editar mascota»: después del alta se cargan solo desde la historia
    clínica (decisión del 2026-09-27, §9).
  - Editar el plan de vacunación desde el panel admin: es fijo en código (§9).
  - Especies sin plan (hoy solo existen Perro y Gato): el selector sale vacío.
  - Recordatorios de próxima dosis.
  - Migrar las vacunas cargadas antes de esta spec (`DEUDA_TECNICA.md` ítem 20).

## 3. Entidades involucradas

Cambios sobre `docs/MODELO_DATOS.md`:

- **`Historia_Clinica`**: campo nuevo `historia_clinica_tipo_vacuna` (enum `tipo_vacuna`,
  nullable). Va junto con `historia_clinica_vacunacion = true`. Nulo en los registros que no
  son vacuna.
- **Enum `tipo_vacuna`**: `PRIMOVACUNACION`, `MULTIPLE`, `REFUERZO_MULTIPLE`,
  `TRIVALENTE_FELINA`, `REFUERZO_TRIVALENTE_LEUCEMIA`, `REFUERZO_LEUCEMIA`, `ANTIRRABICA`.
- **`Publicacion`**: se elimina `publicacion_vacunas`.

Migración: `20260927120000_vacunas_historia_clinica`.

### Plan de vacunación

Vive en `src/shared/vacunas.ts` (nombre, especie y descripción de cada vacuna).

| Tipo | Especie | Nombre | Descripción |
|---|---|---|---|
| `PRIMOVACUNACION` | Perro | Primovacunación | 6 a 8 semanas: Primovacunación con Puppy / Polivalente (Parvovirus y Moquillo). |
| `MULTIPLE` | Perro | Vacuna Múltiple | 9 a 12 semanas: Vacuna Múltiple o Séxtuple (Parvovirus, Moquillo, Hepatitis, Parainfluenza y Leptospirosis). |
| `REFUERZO_MULTIPLE` | Perro | Refuerzo Múltiple | 14 a 16 semanas: Refuerzo de la vacuna Múltiple/Óctuple. |
| `ANTIRRABICA` | Perro | Antirrábica | A partir de los 3 a 4 meses: Vacuna Antirrábica (obligatoria por ley). |
| `TRIVALENTE_FELINA` | Gato | Trivalente Felina | 8 semanas: Vacuna Trivalente Felina (Panleucopenia, Calicivirus y Rinotraqueítis). |
| `REFUERZO_TRIVALENTE_LEUCEMIA` | Gato | Refuerzo Trivalente + Leucemia | 12 semanas: Refuerzo de la Trivalente Felina + Leucemia Felina (FeLV) (recomendada si el gato tiene acceso al exterior o convivencia con otros gatos). |
| `REFUERZO_LEUCEMIA` | Gato | Refuerzo Leucemia Felina | 16 semanas: Segundo refuerzo de Leucemia Felina (si aplica). |
| `ANTIRRABICA` | Gato | Antirrábica | A partir de los 3 a 4 meses: Vacuna Antirrábica. |

`ANTIRRABICA` es un único tipo para las dos especies: es la misma vacuna y su medalla tiene
que verse igual (verde) en un perro que en un gato.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/especies/:especieId/vacunas` | autenticado | Plan de la especie, en orden de calendario |
| POST | `/api/v1/mascotas` | ver HU-6.1 | Acepta `vacunas` (nuevo) |
| GET | `/api/v1/mascotas/:id` | ver HU-6.4 | Devuelve `vacunas` (nuevo) |
| POST | `/api/v1/mascotas/:mascotaId/historias-clinicas` | ver spec 005 | Acepta `tipoVacuna` (nuevo); ya no acepta `vacunacion` |
| PATCH | `/api/v1/historias-clinicas/:id` | ver spec 005 | En una vacuna, tipo y título no se editan |
| GET | `/api/v1/publicaciones`, `/api/v1/publicaciones/:id` | ver spec 018 | `vacunas` pasa de texto a lista; suma `publicadoPor` |
| POST / PUT | `/api/v1/publicaciones` | ver spec 018 | Ya no aceptan `vacunas` |

**`GET /especies/:especieId/vacunas`** → `200`

```json
[
  { "tipo": "PRIMOVACUNACION", "nombre": "Primovacunación", "descripcion": "6 a 8 semanas: …" },
  { "tipo": "ANTIRRABICA", "nombre": "Antirrábica", "descripcion": "A partir de los 3 a 4 meses: …" }
]
```

Errores: `VALIDACION` (400, id inválido), `NO_ENCONTRADO` (404, especie inexistente). Una
especie sin plan devuelve `[]`.

**`POST /mascotas`** — campo multipart nuevo y opcional `vacunas`, un JSON (una lista de pares
no entra en un multipart, que solo sabe de strings):

```
vacunas: '[{"tipo":"PRIMOVACUNACION","fecha":"2025-03-01"},{"tipo":"ANTIRRABICA","fecha":"2025-05-15"}]'
```

Cada vacuna se da de alta como registro de historia clínica con `titulo` = nombre de la
vacuna, `descripcion` = la del plan, `fechaVisita` = `fecha`, `vacunacion = true` y su
`tipoVacuna`. Errores (`VALIDACION`, 400): «Las vacunas: formato inválido» (JSON roto), «La vacuna
no es válida», fecha vacía o futura, «Esa vacuna no corresponde a la especie de la mascota»,
«La fecha de la vacuna X no puede ser anterior al nacimiento», «No podés cargar la misma
vacuna dos veces». Si falla cualquiera, no se crea nada.

**Medallas** — `GET /mascotas/:id` y la publicación (`vacunas`) devuelven:

```json
"vacunas": [
  { "tipo": "ANTIRRABICA", "nombre": "Antirrábica", "descripcion": "…", "fechaAplicacion": "2025-05-15" }
]
```

Una por tipo con registro vigente en la historia clínica, con la aplicación más reciente, en
el orden del calendario.

**Publicado por** — la publicación suma `publicadoPor`: la persona que la publicó, solo si no
es de un refugio. En una de refugio es `null`, para no exponer a su personal.

```json
"refugio": null,
"publicadoPor": { "nombre": "Carla", "apellido": "Ruiz" }
```

**`POST /mascotas/:mascotaId/historias-clinicas`** — dos variantes según `tipoVacuna`:

```
// Vacuna
tipoVacuna: "ANTIRRABICA"   // obligatorio para que sea vacuna
fechaVisita: "2025-05-15"   // obligatoria, no futura, no anterior al nacimiento
descripcion: "…"            // opcional: si no viene, la del plan

// Otro registro: igual que antes (titulo y descripcion obligatorios), sin tipoVacuna
```

`titulo` se ignora en una vacuna: es el nombre de la vacuna. `vacunacion` ya no se recibe: lo
deriva el backend (`tipoVacuna` presente). La respuesta suma `tipoVacuna` (`null` si no es
vacuna). Errores nuevos: «La vacuna no es válida», «Esa vacuna no corresponde a la especie de
la mascota», «La fecha de la vacuna X no puede ser anterior al nacimiento».

## 5. Pantallas (frontend, `apps/mobile`)

- **Crear mascota** (`app/mascotas/crear.tsx`): sección «Vacunas» debajo de
  castrado/esterilizado. Sin especie: «Elegí la especie para ver sus vacunas». Con especie,
  el plan como medallas apagadas que se encienden al tocarlas (varias a la vez); cada una
  elegida pide «Fecha de <vacuna>». El ícono ⓘ de cada una abre para qué sirve. Cambiar de
  especie vacía la selección.
- **Nuevo registro de historia clínica** (`historia-clinica/nuevo.tsx`): primero «¿Qué vas a
  registrar?» con dos tarjetas, «Vacuna» y «Otro registro». Vacuna: selector «Vacuna» con el
  plan de la especie de la mascota, vista previa de la medalla, «Fecha de aplicación» y
  «Descripción» precargada (editable). Otro registro: el formulario de siempre, sin el tilde
  «¿Es vacuna?». Cambiar de «Vacuna» a «Otro registro» vacía la descripción (el texto de la
  vacuna no se arrastra); volver a «Vacuna» la precarga otra vez con la elegida.
- **Historia clínica** (lista y detalle): un registro de vacuna se pinta con el color de su
  vacuna. En «Editar», una vacuna muestra su medalla en lugar del título.
- **Ficha de la mascota** y **ficha de la publicación**: bloque «Vacunas» / «Salud» con las
  medallas; tocar una abre su detalle (nombre, fecha de aplicación y descripción). Sin
  vacunas: «No tiene vacunas registradas».
- **Ficha de la publicación** (rediseño, pantallas 9c/9d del deck `pantallas/` del front;
  piezas en `components/publicaciones/FichaPublicacion.tsx`): todo en una tarjeta montada
  sobre la foto, cada sección con el mismo encabezado (ícono + título). En orden:
  - Nombre grande y estado de la mascota.
  - «Publicado por»: el refugio o, si es de una persona, su nombre (`publicadoPor`) con
    iniciales; debajo, la ubicación de la publicación.
  - Estado de la publicación como banner de color (Activa / Pausada / Finalizada), solo sobre
    lo propio.
  - «Personalidad»: chips rellenos, concordados con el sexo.
  - «Características»: 6 cuadrantes — especie, raza, edad, tamaño, peso y sexo. El castrado
    ya no va acá.
  - «Salud»: dos cuadrantes, «Castrado/Castrada» (naranja de marca, escudo) y
    «Desparasitado/Desparasitada» (marrón claro, comprimido), con los colores de
    `PALETA.salud` si son `true`, y en gris con «No» abajo si son `false`. Debajo, la
    subsección «Vacunas» con sus medallas.
  - «Sobre <nombre>»: la descripción (≤200) en una caja de color, en letra de cuerpo.
  - «Requisitos para adoptar»: medallas neutras sin ícono (≤20 caracteres, spec 018).
  - Fuera de la tarjeta: las acciones de quien la gestiona, o el CTA fijo de quien adopta.
- **Crear/editar publicación**: sale el campo de texto «Vacunas».

**Colores**: fijos por tipo en `PALETA.vacuna` (`constants/theme.js`), mapeados en
`constants/Vacunas.ts`. Antirrábica es verde siempre.

## 6. Reglas de negocio y validaciones

1. Una vacuna tiene que ser del plan de la especie de la mascota (backend siempre; el front
   solo ofrece las de la especie).
2. La fecha de aplicación es obligatoria, no futura y no anterior a la fecha de nacimiento
   (backend siempre; front además, para UX).
3. En el alta de mascota no se repite un mismo tipo (backend; el front no lo permite).
4. Las vacunas de la mascota salen **siempre** de su historia clínica: registros vigentes con
   `tipoVacuna`. No se desnormalizan en `Mascota` ni en `Publicacion`.
5. Historia clínica sigue siendo inmutable (spec 005): editar una vacuna es baja + alta, y
   arrastra `vacunacion`, `tipoVacuna` y el título. Dar de baja el registro quita la medalla.
6. Un refuerzo repetido (dos registros del mismo tipo) muestra una sola medalla, con la fecha
   más reciente.

## 7. Criterios de aceptación

- [ ] Al crear un perro se pueden tildar Primovacunación y Antirrábica con sus fechas; la
      ficha muestra las dos medallas y la historia clínica dos registros «Primovacunación» y
      «Antirrábica».
- [ ] A un gato no se le ofrecen vacunas de perro, y el backend rechaza una si llega igual.
- [ ] Al cargar en historia clínica una «Vacuna» → «Vacuna Múltiple», la descripción se
      completa sola con la del plan y, al guardar, la ficha suma la medalla.
- [ ] La medalla de Antirrábica es verde en la ficha de la mascota, en la publicación y en la
      historia clínica, sea perro o gato.
- [ ] Tocar una medalla muestra para qué sirve la vacuna.
- [ ] El formulario de publicación ya no pide vacunas y su ficha muestra las medallas.
- [ ] En «Salud», una publicación desparasitada muestra el cuadrante marrón y una castrada el
      naranja; si no lo están, el cuadrante sale en gris con «No».
- [ ] En «Características» de la publicación se ven 6 cuadrantes (especie, raza, edad, tamaño,
      peso y sexo) y no el castrado.
- [ ] Una publicación de una persona muestra su nombre en «Publicado por»; una de refugio,
      el nombre del refugio.
- [ ] En historia clínica, elegir «Vacuna» → una vacuna y pasar a «Otro registro» deja la
      descripción vacía.

## 8. Casos borde y errores

- Especie sin plan: selector vacío con aviso; el alta de mascota funciona sin vacunas.
- Mascota sin fecha de nacimiento (posible en altas de otros flujos): no se chequea la fecha
  contra el nacimiento.
- Vacunas cargadas antes de esta spec: `vacunacion = true` y `tipoVacuna` nulo. Siguen en la
  historia clínica con la etiqueta genérica «Vacuna», pero no generan medalla
  (`DEUDA_TECNICA.md` ítem 20).
- El texto de `publicacion_vacunas` se descartó en la migración: no se puede traducir a un
  tipo con fecha.

## 9. Notas y decisiones

- 2026-09-27: spec redactada y aprobada en el mismo intercambio en que se pidió la
  implementación. Decisiones del equipo en ese intercambio:
  - Al crear la mascota, **una fecha por vacuna** (no la de hoy ni una sola para todas): la
    historia clínica queda con fechas reales.
  - El campo de texto de la publicación **se elimina** y la publicación muestra las medallas
    de la historia clínica.
  - **No** se agregan vacunas desde «Editar mascota»: solo desde historia clínica.
- 2026-09-27: el plan es un enum de Prisma + constante en código y no un catálogo editable
  (como `Especie`), porque el código ramifica por tipo (especie que lo admite, color fijo de
  la medalla). Un catálogo editable rompería el color fijo por vacuna.
- 2026-09-27: se conserva `historia_clinica_vacunacion` (está en el diagrama de clases) y se
  deriva de `tipoVacuna` en las altas nuevas.
- 2026-09-28: ajustes de presentación pedidos por el equipo, sin cambios de API: desparasitado
  pasa a medalla (y desaparece «Sin desparasitar»), la descripción de la vacuna no se arrastra
  a «Otro registro», y la ficha y la tarjeta de la publicación concuerdan en género los rasgos
  de personalidad y «Castrado/Castrada» con el sexo de la mascota (como ya hacían los
  formularios). Los rasgos se siguen guardando en masculino; solo cambia la etiqueta.
- 2026-09-28: castrado sale del cuadrante de «Características» (lo reemplaza el sexo) y pasa
  a ser medalla de «Salud», como desparasitado; las dos más grandes que las vacunas. Los
  requisitos para adoptar pasan a medallitas y se limitan a 20 caracteres (spec 018). Solo en
  la ficha de la publicación: la ficha de la mascota conserva su cuadrante «Castrado/a».
- 2026-09-28: rediseño de la ficha de la publicación a partir de las pantallas 9c/9d del deck:
  tarjeta única, encabezado común por sección, 6 cuadrantes de características, castrado y
  desparasitado como cuadrantes que se muestran siempre (en gris con «No» si son `false`,
  reemplaza la decisión anterior de ocultarlos) y `publicadoPor` en la API.
