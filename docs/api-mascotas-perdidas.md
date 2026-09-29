# Contrato de API — Mascotas perdidas y encontradas

Endpoints de **HU-13.1 (Registrar mascota perdida)**, listos para consumir desde `pethood-frontend`. Los cinco están implementados, testeados y verificados contra el servidor local con los avisos del seed. Alcance, reglas y criterios de aceptación: [spec 020](specs/020-mascotas-perdidas.md).

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md`.

Las pantallas que los consumen son **GUI-06 (Mascotas Perdidas)**, el portal, y **GUI-25 (Nueva publicación perdida/encontrada)**, el alta. El botón "Abrir chat" de cada tarjeta y el botón "Resuelto" **no** están en esta HU — ver "Pendiente para otros módulos".

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1` — en mobile la variable ya existe en `apps/mobile/.env`.

**Autenticación:** los cinco endpoints la exigen. Sirven para **cualquier usuario autenticado**, adoptante o miembro de refugio, desde cualquiera de sus dos perfiles: la cabecera `X-Ambito` no cambia nada acá, porque el aviso es siempre de la persona.

```
Authorization: Bearer <token>
```

**Formato de error** — siempre el mismo, en cualquier código de estado:

```json
{ "error": { "codigo": "ESTADO_INVALIDO", "mensaje": "Un aviso nuevo tiene que ser de una mascota perdida o encontrada" } }
```

El campo `mensaje` viene en español con voseo rioplatense y **se puede mostrar tal cual en el toast**, sin reescribirlo en el cliente.

**Fechas:** ISO 8601 crudo (`2026-09-29T14:21:43.285Z`). El formateo ("hace 2 días", "29/09") lo hace el cliente.

**Imágenes:** `imagenUrl` y cada ítem de `imagenes` son una ruta relativa (`/api/v1/archivos/perdidos/xxx.png`) a la que hay que anteponerle el host del backend, o una URL absoluta si el storage es R2. Los avisos del seed traen URLs de Unsplash, también absolutas.

**Errores de autenticación comunes a los cinco endpoints:**

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token de autenticación | No se mandó el header |
| 401 | `NO_AUTENTICADO` | Token inválido o expirado | Token vencido o corrupto |

---

## La tarjeta de aviso

Es la forma de cada aviso, tanto en el listado del portal como en la respuesta del alta.

```json
{
  "id": 14,
  "nombre": "Canela",
  "descripcion": "Perrita color canela con pañuelo rojo. Se perdió cerca del Parque Central.",
  "imagenUrl": "/api/v1/archivos/perdidos/a0befbf6-0feb-44a7-8f11-38ddb0f1698b.png",
  "imagenes": [
    "/api/v1/archivos/perdidos/a0befbf6-0feb-44a7-8f11-38ddb0f1698b.png",
    "/api/v1/archivos/perdidos/5c1e2d7a-9b3f-4e08-a1c4-7f2b6d9e0a13.jpg"
  ],
  "ubicacion": "Ciudad de Mendoza",
  "estado": { "id": 1, "nombre": "Perdido" },
  "especie": { "id": 1, "nombre": "Perro" },
  "fechaSuceso": "2026-09-28",
  "fechaAlta": "2026-09-29T14:21:43.285Z",
  "fechaResuelto": null,
  "reportante": {
    "id": 3,
    "nombre": "Ana",
    "apellido": "Gomez",
    "imagenUrl": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=1200&q=80"
  },
  "esPropio": true
}
```

| Campo | Qué es |
|---|---|
| `id` | Id del aviso. Es el que va en `cursor` para pedir la página siguiente |
| `nombre` | Nombre del animal, o `null` en un aviso Encontrado sin nombre: la tarjeta muestra la especie en su lugar ("Perro encontrado") |
| `imagenUrl` | La portada de la tarjeta del portal. Es siempre la primera de `imagenes` |
| `imagenes` | De 1 a 5 fotos, en el orden de la galería del detalle (la primera es la portada) |
| `ubicacion` | Dónde se perdió o se encontró, en texto libre. `null` sólo en avisos cargados antes de HU-13.1 |
| `estado` | Perdido, Encontrado o Resuelto, para el badge |
| `especie` | `null` sólo en avisos cargados antes de HU-13.1 |
| `fechaSuceso` | Día en que se perdió o se encontró, `AAAA-MM-DD` (sin hora, como `fechaNacimiento` de mascota). No es la fecha de publicación. `null` sólo en avisos cargados antes de este campo |
| `fechaAlta` | Fecha de publicación. Define el orden del portal |
| `fechaResuelto` | `null` salvo en los avisos Resueltos |
| `reportante` | Quien publicó el aviso. Es la contraparte del chat de reencuentro (HU-13.2) |
| `esPropio` | `true` si el aviso es del usuario autenticado: esa tarjeta no ofrece "Abrir chat" |

Las coordenadas **no vienen**: son las del teléfono de quien reportó, no las del animal (ver "Decisiones").

---

## `POST /api/v1/animales-perdidos` — Publicar aviso (HU-13.1)

### Headers

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### Body (multipart)

| Campo | Tipo | Reglas |
|---|---|---|
| `fotos` | archivo (repetido) | **Obligatorio, de 1 a 5.** jpg, png o webp, hasta 5 MB cada una. El orden en que llegan es el de la galería: la primera es la portada. Misma cadena que las fotos de una publicación |
| `nombre` | texto | **Obligatorio sólo si el estado es Perdido.** Hasta 30 caracteres, con trim. Vacío → `null` |
| `descripcion` | texto | Obligatorio. Hasta 300 caracteres, con trim |
| `ubicacion` | texto | Obligatorio. Hasta 80 caracteres, con trim. Texto libre |
| `fechaSuceso` | `AAAA-MM-DD` | Obligatorio. Día en que se perdió o se encontró (el campo "Fecha" del formulario). No puede ser futuro ni anterior a 1900 |
| `estadoId` | entero > 0 | Obligatorio. Perdido o Encontrado: los que `GET /estados-animal-perdido` marca con `seleccionableEnAlta: true` |
| `especieId` | entero > 0 | Obligatorio. De `GET /especies` |
| `latitud` | número | Obligatorio. Entre -90 y 90. Acepta punto o coma y todos los decimales del GPS |
| `longitud` | número | Obligatorio. Entre -180 y 180. Ídem |
| `rotacion`, `cropX`, `cropY`, `cropWidth`, `cropHeight` | número | Opcionales. Sólo se aplican si viaja **una** foto (con varias, un único recorte no tiene sentido y se ignoran). La app gira cada foto en el cliente antes de subirla, así que no los manda |

`latitud` y `longitud` son las **del dispositivo al momento de publicar** (la precondición de la HU es tener la ubicación habilitada). No representan dónde está el animal: eso lo dice `ubicacion`.

Ejemplo de los campos de texto:

```
nombre=Canela
descripcion=Perrita color canela con pañuelo rojo. Se perdió cerca del Parque Central.
ubicacion=Ciudad de Mendoza
fechaSuceso=2026-09-28
estadoId=1
especieId=1
latitud=-32.8812345678
longitud=-68.8401234567
```

### Reglas que aplica el backend

1. El reportante es **siempre el usuario autenticado**.
2. El estado inicial sólo puede ser **Perdido o Encontrado**, nunca Resuelto.
3. El nombre es obligatorio en un aviso Perdido; en uno Encontrado puede faltar.
4. No exige cuenta verificada (la HU no lo pide, a diferencia del alta de mascota).
5. Si la escritura en base falla después de subir las fotos, se borran.
6. El alta queda en el log de auditoría (`CREAR AnimalPerdido`).

### Respuesta — 201 Created

La tarjeta del aviso recién creado (ver "La tarjeta de aviso"), con `esPropio: true`.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `FOTO_REQUERIDA` | Agregá una foto del animal |
| 400 | `ARCHIVO_INVALIDO` | La imagen debe ser jpg, png o webp |
| 400 | `ARCHIVO_DEMASIADO_GRANDE` | La imagen supera el máximo de 5MB |
| 400 | `DEMASIADOS_ARCHIVOS` | Podés subir hasta 5 fotos |
| 400 | `VALIDACION` | El nombre es obligatorio |
| 400 | `VALIDACION` | El nombre no puede superar los 30 caracteres |
| 400 | `VALIDACION` | La descripción es obligatoria |
| 400 | `VALIDACION` | La descripción no puede superar los 300 caracteres |
| 400 | `VALIDACION` | La ubicación es obligatoria |
| 400 | `VALIDACION` | La ubicación no puede superar los 80 caracteres |
| 400 | `VALIDACION` | La fecha no es válida (también si falta) · La fecha no puede ser futura · La fecha no puede ser anterior a 1900 |
| 400 | `VALIDACION` | El estado es obligatorio · El estado no es válido |
| 400 | `VALIDACION` | La especie es obligatoria · La especie no es válida |
| 400 | `VALIDACION` | La latitud es obligatoria · La latitud no es válida · La latitud debe estar entre -90 y 90 (ídem longitud, entre -180 y 180) |
| 400 | `ESTADO_INVALIDO` | Un aviso nuevo tiene que ser de una mascota perdida o encontrada |
| 404 | `NO_ENCONTRADO` | El estado no existe |
| 404 | `NO_ENCONTRADO` | La especie no existe |
| 404 | `NO_ENCONTRADO` | El usuario no existe |

---

## `GET /api/v1/animales-perdidos` — Portal (HU-13.1)

### Headers

```
Authorization: Bearer <token>
```

### Query params

Todos son opcionales: sin ninguno se ve el portal completo, primera página.

| Param | Formato | Default | Reglas |
|---|---|---|---|
| `cursor` | entero > 0 | — | Id del último aviso que el cliente ya tiene. Ausente = primera página |
| `limite` | entero | `20` | Entre 1 y 50 |
| `fechaDesde` | `AAAA-MM-DD` | — | Desde el inicio de ese día, sobre la fecha de publicación |
| `fechaHasta` | `AAAA-MM-DD` | — | Hasta el final de ese día. **Requiere `fechaDesde`**: la HU pide "desde" obligatoria para filtrar por fecha |
| `estados` | ids separados por coma | todos | `?estados=1,2` |
| `especies` | ids separados por coma | todas | `?especies=2` |
| `ubicaciones` | **un parámetro por valor** | todas | `?ubicaciones=Maip%C3%BA&ubicaciones=Las%20Heras`. Hasta 20 |

**Ojo con `ubicaciones`:** a diferencia de los otros filtros, **no se separa por coma**, porque una ubicación en texto libre puede tenerla ("Godoy Cruz, Mendoza"). Se repite el parámetro una vez por valor. La coincidencia es exacta pero **sin distinguir mayúsculas**: elegir "Godoy Cruz" trae también los avisos escritos "godoy cruz".

Los filtros se combinan con **Y** entre sí, y dentro de cada uno las opciones elegidas van con **O**. Ejemplo — perros perdidos o encontrados en Maipú o Las Heras, publicados desde el 1 de septiembre:

```
GET /api/v1/animales-perdidos?especies=1&estados=1,2&ubicaciones=Maip%C3%BA&ubicaciones=Las%20Heras&fechaDesde=2026-09-01
```

### Respuesta 200

```json
{
  "avisos": [
    {
      "id": 6,
      "nombre": null,
      "descripcion": "Encontré una gatita tricolor muy chiquita, de unos 2 meses, en la entrada de Chacras. La tengo en casa con comida y abrigo.",
      "imagenUrl": "https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=1200&q=80",
      "imagenes": ["https://images.unsplash.com/photo-1583337130417-3346a1be7dee?w=1200&q=80"],
      "ubicacion": "Luján de Cuyo",
      "estado": { "id": 2, "nombre": "Encontrado" },
      "especie": { "id": 2, "nombre": "Gato" },
      "fechaSuceso": "2026-09-28",
      "fechaAlta": "2026-09-29T14:20:39.819Z",
      "fechaResuelto": null,
      "reportante": { "id": 11, "nombre": "Sofia", "apellido": "Lopez", "imagenUrl": null },
      "esPropio": false
    }
  ],
  "hayMas": true,
  "proximoCursor": 6
}
```

| Campo | Qué es |
|---|---|
| `avisos` | Una página de tarjetas, del aviso más reciente al más viejo |
| `hayMas` | `true` si quedan avisos por pedir |
| `proximoCursor` | Id a mandar como `cursor` para la página siguiente. `null` cuando ya no hay más |

**Cómo se pagina:** para la página siguiente se repite **el mismo pedido, con los mismos filtros**, agregando `cursor=<proximoCursor>`. Con `hayMas: false` se deja de pedir. Si el usuario cambia los filtros, se vuelve a arrancar sin `cursor`.

No viene `total`: el scroll infinito sólo necesita saber si hay más.

### Garantías del listado

- **Orden:** por `fechaAlta` descendente (más reciente primero), con el id como desempate. Es el orden por defecto que pide la HU.
- **Incluye avisos en cualquier estado, Resuelto también.** Sólo excluye los dados de baja.
- **Paginación estable:** un aviso nuevo publicado mientras el usuario scrollea no corre la página ni repite tarjetas. Recorrer el portal página por página da exactamente el mismo resultado que pedirlo entero (verificado con el seed).
- **Sin resultados es `200`**, no un error: `{ "avisos": [], "hayMas": false, "proximoCursor": null }`. El empty state lo pinta el cliente.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | Para filtrar por fecha, elegí la fecha "desde" |
| 400 | `VALIDACION` | La fecha "desde" no puede ser posterior a "hasta" |
| 400 | `VALIDACION` | La fecha "desde" no es válida · La fecha "hasta" no es válida |
| 400 | `VALIDACION` | El estado no es válido · La especie no es válida · La ubicación no es válida |
| 400 | `VALIDACION` | Podés elegir hasta 20 opciones a la vez |
| 400 | `VALIDACION` | El límite tiene que ser un número entre 1 y 50 |
| 400 | `VALIDACION` | El cursor no es válido |
| 400 | `CURSOR_INVALIDO` | No pudimos seguir cargando los avisos |

`CURSOR_INVALIDO` es un `cursor` con formato correcto pero que no corresponde a ningún aviso. Si el aviso del cursor se dio de baja mientras el usuario scrolleaba, **no** es un error: la paginación sigue.

---

## `GET /api/v1/animales-perdidos/ubicaciones` — Opciones del filtro por ubicación

Las ubicaciones que ya tienen los avisos visibles, **sin repetir variantes de mayúsculas** ("Maipú" y "maipú" son una sola opción) y en orden alfabético. Es lo que llena el selector múltiple de "Ubicación" en la pantalla de filtros.

### Headers

```
Authorization: Bearer <token>
```

### Respuesta 200

```json
["Ciudad de Mendoza", "Godoy Cruz", "Guaymallén", "Las Heras", "Luján de Cuyo", "Maipú"]
```

Sin avisos, `[]`. Cada valor se manda tal cual en `?ubicaciones=` del portal.

**Es provisorio:** cuando exista el catálogo de Provincia/Localidad, el filtro va a salir de ahí y este endpoint desaparece (ver "Pendiente para otros módulos").

### Errores

Solo los de autenticación.

---

## `GET /api/v1/estados-animal-perdido` — Estados del aviso

### Headers

```
Authorization: Bearer <token>
```

### Respuesta 200

```json
[
  { "id": 1, "nombre": "Perdido", "seleccionableEnAlta": true },
  { "id": 2, "nombre": "Encontrado", "seleccionableEnAlta": true },
  { "id": 3, "nombre": "Resuelto", "seleccionableEnAlta": false }
]
```

El filtro del portal ofrece los tres; el selector del alta, **sólo los de `seleccionableEnAlta: true`**. La regla vive en el backend, igual que en `GET /estados-mascota`: el front no decide qué estado es válido para publicar.

### Errores

Solo los de autenticación.

---

## `GET /api/v1/especies` — Especies

Ya existía (catálogos de HU-6.1). Devuelve `[{ "id": 1, "nombre": "Perro" }, { "id": 2, "nombre": "Gato" }]` y alimenta tanto el filtro del portal como el selector del alta.

---

## Notas para las pantallas

### GUI-06 — Mascotas Perdidas (portal)

1. **Scroll infinito con `proximoCursor`.** Al llegar al final, si `hayMas` es `true`, pedir la página siguiente con los mismos filtros y el cursor. No calcular offsets.
2. **Nombre vacío:** si `nombre` es `null`, mostrar la especie en su lugar ("Gato encontrado").
3. **Badge de estado** con `estado.nombre`. Los avisos Resueltos también aparecen: la HU los quiere visibles.
4. **Botón "Abrir chat":** se puede dejar maquetado, oculto cuando `esPropio` es `true`, pero **sin acción** hasta HU-13.2.
5. **Pantalla de filtros:** fecha "desde" (obligatoria para filtrar por fecha) y "hasta" (opcional); estados de `GET /estados-animal-perdido`; ubicaciones de `GET /animales-perdidos/ubicaciones`; especies de `GET /especies`. Todos de selección múltiple menos la fecha.
6. **Estados de la pantalla:** cargando / vacío / error. El vacío es `avisos: []`, no un error.

### GUI-25 — Nueva publicación perdida/encontrada

1. **Selector de estado** sólo con los que tienen `seleccionableEnAlta: true`.
2. **Nombre obligatorio sólo si eligió Perdido.** Conviene marcar el asterisco según el estado elegido.
3. **Fotos:** de 1 a 5 (`LIMITES.animalPerdido.imagenes.max`), desde la cámara o la galería. Cada una pasa por la vista previa donde se puede girar, sin el recorte nativo del sistema. La primera es la portada.
4. **Detalle del aviso:** la tarjeta del portal usa `imagenUrl`; el popup de detalle muestra `imagenes` en una galería que se desliza.
5. **Coordenadas:** tomarlas del dispositivo al guardar. Si el usuario no dio permiso de ubicación, la HU lo tiene como precondición: pedirlo antes de dejarlo publicar.
6. **Fecha** del suceso con el calendario (`DateField`), por defecto hoy; no puede ser futura. Se manda como `AAAA-MM-DD`.
7. **Contadores** de 30 (nombre), 300 (descripción) y 80 (ubicación). Los límites ya están espejados en `apps/mobile/shared/validation/limits.ts` (`LIMITES.animalPerdido`).
8. **Al publicar,** el aviso vuelve con la misma forma de la tarjeta del portal: se puede insertar arriba de la lista sin volver a pedirla.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **Esta HU cubre alta y portal, nada más** | La HU se titula "Registrar", pero sus criterios mezclan el botón "Abrir chat" (que es HU-13.2, "abre chat de reencuentro") y el botón "Resuelto" (que es HU-13.3, gestión de estados). Se dejaron en sus HUs para diseñarlos una sola vez. |
| **Columna nueva `animal_perdido_nombre`, obligatoria sólo en Perdido** | La HU pide un nombre de hasta 30 caracteres y el modelo no lo tenía. No puede salir de `mascota_id` porque es opcional y un animal encontrado no tiene mascota. Es opcional en Encontrado porque quien encuentra un animal no sabe cómo se llama. |
| **Ubicación en texto libre, provisoria** | El equipo va a definir un catálogo de Provincia/Localidad para toda la app (también lo necesita HU-11.3) y aplicarlo después en cada lugar. Mientras tanto, texto libre como la ubicación del perfil. Anotado en `DEUDA_TECNICA.md` (ítem 21). |
| **El filtro por ubicación sale de las ubicaciones ya cargadas** | Con texto libre no hay catálogo del cual sacar las opciones de un selector múltiple. Comparar sin distinguir mayúsculas evita que "Maipú" y "maipú" sean dos opciones; los acentos sí se distinguen. |
| **`ubicaciones` va con un parámetro por valor, no con comas** | Un texto libre puede tener coma. Los filtros por id (`estados`, `especies`) siguen el formato con comas del resto de la API. |
| **Columna nueva `animal_perdido_fecha_suceso`, obligatoria en el alta** | El formulario de la pantalla 26 del diseño tiene un campo "Fecha" que el modelo no tenía (agregada el 2026-09-29, al implementar el front). Es el día en que se perdió o se encontró, que no tiene por qué ser el de la publicación: el portal sigue ordenando y filtrando por `fechaAlta`, como pide la HU. Viaja como `AAAA-MM-DD`, sin hora, para que un día cargado en Argentina no se corra al anterior en otra zona horaria. |
| **FK directa `especie_id`** | Llegar a la especie por `mascota_id` → raza → especie no sirve para un animal encontrado, que no tiene mascota asociada. |
| **Columnas nuevas nullables en base, obligatorias en el alta** | Igual que los campos que HU-6.1 le sumó a `Mascota`: los avisos cargados antes no quedan inválidos. El seed completa los suyos. |
| **Las coordenadas siguen obligatorias pero no se exponen** | Son las del teléfono al momento de publicar (`MODELO_DATOS.md`), no la ubicación del animal, que la da `ubicacion`. No hay mapa que las use, y mostrarlas revelaría dónde estaba quien reportó. |
| **Coordenadas sin redondear** | El GPS entrega 10 o más decimales. `parsearDecimal` no servía: no acepta negativos (y en Argentina las dos coordenadas lo son) y rechaza el exceso de decimales. Se sumó `parsearCoordenada` en `shared/validation`. |
| **Paginación por cursor** | Con offset, cada aviso nuevo publicado mientras el usuario scrollea corre la página y repite o saltea tarjetas. Queda como **estándar del proyecto para los listados de la app móvil** (`AGENTS.md`); las tablas de web-admin siguen por offset. |
| **Id como desempate del orden** | Dos avisos del mismo instante tienen que salir siempre en el mismo orden, o el cursor los repetiría o saltearía. Lo sostiene el índice parcial `animal_perdido_listado_idx`. |
| **Sin `total`** | Contarlo con los filtros aplicados es una segunda query que el portal no necesita: el scroll sólo pregunta si hay más. |
| **Cursor inexistente → `400 CURSOR_INVALIDO`** | Con un id que no existe, Prisma devuelve una página vacía sin avisar y el cliente creería que llegó al final. Mismo criterio que el historial del chat. |
| **El aviso es de la persona, desde cualquier perfil** | Varios criterios de la HU dicen "usuario refugio", pero el actor declarado es el adoptante: se tomó como un error de copia y el actor es cualquier usuario autenticado. La sala de reencuentro (HU-13.2) también es entre personas, sin `refugioId`. |
| **Sin tope de avisos activos** | La cuota anti-spam de la regla transversal 7 es de `Publicacion`. Si hace falta un límite para avisos, se evalúa con HU-13.3. |
| **Archivo demasiado grande → `400`, no `413`** | Es el código de toda la API para ese caso (`ARCHIVO_DEMASIADO_GRANDE`). Cambiarlo implicaría tocar el middleware de subida que usan todos los módulos. |
| **Mensajes de validación en español en todos los módulos** | De paso se corrigieron dos helpers compartidos: `idSchema` devolvía "Expected number, received nan" en inglés cuando faltaba un id (pasaba también en el alta de mascota) y no concordaba en género ("La especie no es válido"). Se sumó `limitePaginaSchema` para que `limite` también falle en español. |
| **Sin SQL a mano para las ubicaciones** | Agruparlas sin distinguir mayúsculas en SQL pedía un `$queryRaw`, y el del chat es el único del proyecto a propósito. Se traen los valores distintos con Prisma y se agrupan en el servicio: son pocos. |

---

## Pendiente para otros módulos

### HU-13.2 — Reclamar mascota perdida/encontrada (y el botón "Abrir chat")

El botón está en los criterios de HU-13.1 pero quedó afuera porque **nada en el sistema crea todavía una sala entre dos personas por un aviso**. Lo que ya hay y lo que falta:

- **Lo que ya hay:** el portal entrega `reportante` y `esPropio`, así que el botón se puede maquetar. El módulo de chat tiene un único lugar que crea salas, `asegurarChatDeSolicitud`, y un `buscarChatEntre` que encuentra la sala entre dos personas.
- **Por qué no se reutiliza tal cual:** `asegurarChatDeSolicitud` usa la sala que ya exista entre las dos personas ("la sala es entre las partes"). Para un aviso eso no sirve: HU-13.3 pide cerrar "el chat asociado" al marcar Resuelto, y cerrar una sala compartida cortaría una conversación que no tiene nada que ver con el aviso.
- **Lo que falta decidir e implementar:**
  1. Cómo se vincula una sala con un aviso: por ejemplo, una columna `chat.animal_perdido_id` (cambio de modelo, con su migración).
  2. Un endpoint que, dado un aviso, devuelva la sala de reencuentro entre el reportante y quien reclama, o la cree si no existe. Con `refugioId` nulo (sala entre personas, como documenta el modelo `Chat`) y sin `solicitudId`.
  3. Que `CONSTITUTION §7` ("no hay chat sin interacción previa") quede satisfecha por el propio reclamo.
  4. Qué pasa si el que reclama es el mismo reportante (hoy `esPropio` ya lo detecta del lado del cliente).

### HU-13.3 — Gestión de estados (y el botón "Resuelto")

- **Pasar a Resuelto:** llenar `animal_perdido_fecha_resuelto`, que hoy sólo se escribe desde el seed, y cerrar la sala asociada del punto anterior.
- **Histórico de estados:** si Resuelto es terminal, alcanzan la FK, `fecha_resuelto` y las columnas de auditoría. Si un aviso se puede reabrir o pasar de Perdido a Encontrado, conviene una tabla `AnimalPerdidoEstado` con el mismo patrón que `PublicacionEstado` (una fila vigente por aviso y el historial completo).
- **Editar y dar de baja el aviso** (baja lógica, sólo el reportante).
- **Tope anti-spam** de avisos activos por usuario, si el equipo lo quiere.

### Catálogo de Provincia/Localidad

Cuando exista (ítem 21 de `DEUDA_TECNICA.md`): reemplazar `animal_perdido_ubicacion` por una FK a `Localidad` con una migración de datos, cambiar el filtro `ubicaciones` por ids separados por coma, y eliminar `GET /animales-perdidos/ubicaciones`. Lo mismo aplica a la ubicación del perfil y de la publicación.

### Vincular la mascota propia

`animal_perdido.mascota_id` existe pero el alta todavía no lo recibe. Cuando se quiera, el alta de un aviso Perdido podría ofrecer elegir una mascota registrada del usuario y precargar nombre, especie y foto.
