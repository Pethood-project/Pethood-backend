# Contrato de API — Mascotas perdidas y encontradas

Endpoints de **HU-13.1 (Registrar mascota perdida)** y **HU-13.2 (Reclamar mascota perdida/encontrada)**, listos para consumir desde `pethood-frontend`. Los nueve están implementados y testeados. Alcance, reglas y criterios de aceptación: [spec 020](specs/020-mascotas-perdidas.md) y [spec 024](specs/024-reclamar-mascota-perdida.md).

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md`.

Las pantallas que los consumen son **GUI-06 (Mascotas Perdidas)**, el portal, y **GUI-25 (Nueva publicación perdida/encontrada)**, el alta. El botón "Enviar mensaje" y el botón "Resuelto" del popup de detalle son de HU-13.2 y están más abajo; la sala que abre el reclamo se documenta en [`api-chats.md`](./api-chats.md) y [`api-chat-sala.md`](./api-chat-sala.md).

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1` — en mobile la variable ya existe en `apps/mobile/.env`.

**Autenticación:** los nueve endpoints la exigen. Sirven para **cualquier usuario autenticado**, adoptante o miembro de refugio, desde cualquiera de sus dos perfiles: la cabecera `X-Ambito` no cambia nada acá, porque el aviso es siempre de la persona.

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

**Errores de autenticación comunes a los nueve endpoints:**

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
  "ubicacion": "Calle Belgrano, Mendoza - Mendoza",
  "provincia": "Mendoza",
  "localidad": "Mendoza",
  "referencia": "Calle Belgrano",
  "distanciaKm": 3.5,
  "mapaUrl": "https://www.google.com/maps?q=-32.8908,-68.8456",
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
| `ubicacion` | Dónde se perdió o se encontró, **listo para mostrar**, con el mismo formato que la dirección del perfil: «referencia, localidad - provincia» (sin referencia, «localidad - provincia»). `null` sólo en avisos cargados antes de HU-13.1 |
| `provincia`, `localidad` | Las del catálogo de georef que eligió quien publicó. `null` en avisos viejos |
| `referencia` | El aclaratorio libre ("frente a la plaza"), o `null` si no lo cargó |
| `distanciaKm` | Kilómetros, con un decimal, desde el usuario hasta el lugar del aviso. Sólo si el pedido trajo `latitud` y `longitud` **y** el lugar se pudo ubicar en el mapa (ver "Geocodificación del lugar"); si no, `null`. En el alta se mide desde el teléfono de quien publica |
| `mapaUrl` | Link a Google Maps del lugar: con el punto exacto si se pudo geocodificar, o una búsqueda del texto del lugar si no. `null` sólo en avisos viejos sin localidad. **Nunca** apunta a las coordenadas del teléfono de quien reportó |
| `estado` | Perdido, Encontrado o Resuelto, para el badge |
| `especie` | `null` sólo en avisos cargados antes de HU-13.1 |
| `fechaSuceso` | Día en que se perdió o se encontró, `AAAA-MM-DD` (sin hora, como `fechaNacimiento` de mascota). No es la fecha de publicación. `null` sólo en avisos cargados antes de este campo |
| `fechaAlta` | Fecha de publicación. Define el orden del portal |
| `fechaResuelto` | `null` salvo en los avisos Resueltos |
| `reportante` | Quien publicó el aviso. Es la contraparte del chat de reencuentro (HU-13.2) |
| `esPropio` | `true` si el aviso es del usuario autenticado. Decide qué botón ofrece el detalle: con `false`, "Enviar mensaje"; con `true`, "Marcar como resuelto" |

Las coordenadas del teléfono de quien reportó **no vienen** (ver "Decisiones"). Las del lugar tampoco vienen sueltas: se usan para `distanciaKm` y `mapaUrl`.

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
| `provincia` | texto | Obligatorio. Hasta 80 caracteres, con trim. Del catálogo de georef del cliente (`constants/Provincias.ts`), como en el perfil |
| `localidad` | texto | Obligatorio. Hasta 80 caracteres, con trim. Una localidad de esa provincia, del mismo catálogo |
| `referencia` | texto | Opcional. Hasta 120 caracteres, con trim. Aclaración libre del lugar. Vacío → `null` |
| `fechaSuceso` | `AAAA-MM-DD` | Obligatorio. Día en que se perdió o se encontró (el campo "Fecha" del formulario). No puede ser futuro ni anterior a 1900 |
| `estadoId` | entero > 0 | Obligatorio. Perdido o Encontrado: los que `GET /estados-animal-perdido` marca con `seleccionableEnAlta: true` |
| `especieId` | entero > 0 | Obligatorio. De `GET /especies` |
| `latitud` | número | Obligatorio. Entre -90 y 90. Acepta punto o coma y todos los decimales del GPS |
| `longitud` | número | Obligatorio. Entre -180 y 180. Ídem |
| `lugarLatitud`, `lugarLongitud` | número | Opcionales, **las dos juntas**. El punto del lugar que el usuario vio en el mapa antes de publicar: el de `POST /lugar/preview` o el de `POST /lugar/link`. Sin ellas, el backend geocodifica el lugar |
| `rotacion`, `cropX`, `cropY`, `cropWidth`, `cropHeight` | número | Opcionales. Sólo se aplican si viaja **una** foto (con varias, un único recorte no tiene sentido y se ignoran). La app gira cada foto en el cliente antes de subirla, así que no los manda |

`latitud` y `longitud` son las **del dispositivo al momento de publicar** (la precondición de la HU es tener la ubicación habilitada). No representan dónde está el animal: eso lo dicen `provincia`, `localidad` y `referencia`. Sólo se usan, sin exponerse, como respaldo del filtro por cercanía cuando el lugar no se pudo geocodificar.

**Como en el perfil, el backend no valida que la provincia y la localidad sean del catálogo:** el catálogo vive en el cliente. Sí valida largo y que no vengan vacías.

Ejemplo de los campos de texto:

```
nombre=Canela
descripcion=Perrita color canela con pañuelo rojo. Se perdió cerca del Parque Central.
provincia=Mendoza
localidad=Mendoza
referencia=Calle Belgrano
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
5. **El punto del lugar:** si vienen `lugarLatitud` y `lugarLongitud`, usa ese; si no, geocodifica el lugar antes de guardar (ver abajo). Si no lo encuentra, el aviso se publica igual.
6. Si la escritura en base falla después de subir las fotos, se borran.
7. El alta queda en el log de auditoría (`CREAR AnimalPerdido`), con `lugar=elegido|geocodificado|sin-ubicar` en el detalle.

### Geocodificación del lugar

La usan el alta (cuando no viene el punto) y `POST /lugar/preview`. Con el mismo geocoder que la dirección del perfil (`node-geocoder`, proveedor de `GEOCODER_PROVIDER`, OpenStreetMap por defecto):

1. Busca «referencia, localidad, provincia, Argentina».
2. Si no hay referencia, o con ella no encuentra nada, busca «localidad, provincia, Argentina».
3. Si tampoco, el aviso queda sin coordenadas del lugar: `distanciaKm` sale `null` y `mapaUrl` es una búsqueda del texto.

Cada intento espera **como mucho 6 segundos**: un proveedor caído no traba el alta. En el peor caso el alta tarda unos 12 segundos más; lo normal, contra OpenStreetMap, es entre 1 y 3.

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
| 400 | `VALIDACION` | La provincia es obligatoria · La provincia no puede superar los 80 caracteres |
| 400 | `VALIDACION` | La localidad es obligatoria · La localidad no puede superar los 80 caracteres |
| 400 | `VALIDACION` | La referencia no puede superar los 120 caracteres |
| 400 | `VALIDACION` | La fecha no es válida (también si falta) · La fecha no puede ser futura · La fecha no puede ser anterior a 1900 |
| 400 | `VALIDACION` | El estado es obligatorio · El estado no es válido |
| 400 | `VALIDACION` | La especie es obligatoria · La especie no es válida |
| 400 | `VALIDACION` | La latitud es obligatoria · La latitud no es válida · La latitud debe estar entre -90 y 90 (ídem longitud, entre -180 y 180) |
| 400 | `VALIDACION` | La ubicación del lugar no es válida (falta una de las dos, o está fuera de rango) |
| 400 | `ESTADO_INVALIDO` | Un aviso nuevo tiene que ser de una mascota perdida o encontrada |
| 404 | `NO_ENCONTRADO` | El estado no existe |
| 404 | `NO_ENCONTRADO` | La especie no existe |
| 404 | `NO_ENCONTRADO` | El usuario no existe |

---

## `POST /api/v1/animales-perdidos/lugar/preview` — Ver el lugar en el mapa antes de publicar

Igual que el preview de la dirección del perfil: geocodifica el lugar **sin guardar nada** y devuelve el link de Google Maps para que el usuario lo abra y verifique el pin. El punto que devuelve es el que después se manda en el alta como `lugarLatitud`/`lugarLongitud`.

### Body (JSON)

```json
{ "provincia": "Mendoza", "localidad": "Godoy Cruz", "referencia": "Plaza departamental" }
```

Mismas reglas que en el alta: `provincia` y `localidad` obligatorias, `referencia` opcional.

### Respuesta 200

```json
{ "lugar": { "mapaUrl": "https://www.google.com/maps?q=-32.9283499,-68.9050558", "latitud": -32.9283499, "longitud": -68.9050558 } }
```

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | Los de provincia, localidad y referencia del alta |
| 422 | `LUGAR_NO_UBICADO` | No pudimos ubicar ese lugar en el mapa. Podés pegar el link de Google Maps a mano. |

---

## `POST /api/v1/animales-perdidos/lugar/link` — Corregir el lugar con un link de Google Maps

El "corregir a mano": lee el punto de un link de Google Maps que pega el usuario, igual que la edición manual de la ubicación del perfil. Entiende los links completos (`@lat,lng`, `!3d..!4d..`, `?q=lat,lng`) y los cortos (`maps.app.goo.gl`, siguiendo la redirección con un tope de 4 s). **No guarda nada.**

### Body (JSON)

```json
{ "mapaUrl": "https://maps.app.goo.gl/abc123" }
```

### Respuesta 200

La misma forma que el preview: `{ "lugar": { "mapaUrl", "latitud", "longitud" } }`. `mapaUrl` es el link con el punto leído, no el que se pegó.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | El link del mapa es obligatorio · El link del mapa no puede superar los 500 caracteres · El link del mapa no es un link válido |
| 422 | `LINK_MAPA_INVALIDO` | No pudimos leer la ubicación de ese link. Pegá el link de Google Maps del lugar. |

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
| `provincias` | **un parámetro por valor** | todas | `?provincias=Mendoza&provincias=San%20Juan`. Hasta 24 |
| `localidades` | **un parámetro por valor**, cada uno «provincia\|localidad» | todas | `?localidades=Mendoza%7CMaip%C3%BA&localidades=San%20Juan%7CRivadavia`. Hasta 20. Con provincia porque el mismo nombre de localidad existe en varias provincias (unos 200 en el catálogo) |
| `latitud`, `longitud` | número | — | Las del **usuario que consulta**. Van juntas. Con ellas cada tarjeta trae `distanciaKm` |
| `radioKm` | número | sin límite | Entre 1 y 500. **Requiere `latitud` y `longitud`**. Deja sólo los avisos a esa distancia o menos |

**Ojo con `provincias` y `localidades`:** a diferencia de los otros filtros, **no se separan por coma**, porque hay nombres del catálogo que la tienen ("Tierra del Fuego, Antártida e Islas del Atlántico Sur"). Se repite el parámetro una vez por valor. En `localidades`, provincia y localidad van separadas por `|`, que ningún nombre del catálogo usa. La coincidencia es exacta: los valores salen de `GET /animales-perdidos/ubicaciones`.

**Provincias y localidades se combinan con Y, como el resto:** con `provincias=Mendoza&provincias=San Juan&localidades=Mendoza|Godoy Cruz` sólo salen los avisos de Godoy Cruz. La app no manda localidades de provincias que no estén elegidas.

**Cómo se mide la cercanía:** con la fórmula de Haversine, igual que el filtro de publicaciones, desde el usuario hasta **el lugar geocodificado** del aviso. Si el lugar no se pudo geocodificar, se usa como respaldo el punto desde donde se publicó, para que ese aviso no quede afuera de todas las búsquedas por cercanía. Ese punto nunca se devuelve ni se usa para `distanciaKm`.

Los filtros se combinan con **Y** entre sí, y dentro de cada uno las opciones elegidas van con **O**. Ejemplo — perros perdidos o encontrados en Maipú o Las Heras (Mendoza), publicados desde el 1 de septiembre, a 10 km o menos del usuario:

```
GET /api/v1/animales-perdidos?especies=1&estados=1,2&provincias=Mendoza&localidades=Mendoza%7CMaip%C3%BA&localidades=Mendoza%7CLas%20Heras&fechaDesde=2026-09-01&latitud=-32.9264&longitud=-68.8447&radioKm=10
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
      "ubicacion": "Entrada de Chacras, Chacras de Coria - Mendoza",
      "provincia": "Mendoza",
      "localidad": "Chacras de Coria",
      "referencia": "Entrada de Chacras",
      "distanciaKm": 9.8,
      "mapaUrl": "https://www.google.com/maps?q=-33.0005,-68.8795",
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
| 400 | `VALIDACION` | El estado no es válido · La especie no es válida · La localidad no es válida |
| 400 | `VALIDACION` | Podés elegir hasta 20 opciones a la vez |
| 400 | `VALIDACION` | La localidad no es válida (también si no viene como «provincia\|localidad») · La provincia no es válida |
| 400 | `VALIDACION` | La ubicación no es válida (vino `latitud` sin `longitud` o al revés) · La latitud no es válida · La longitud no es válida |
| 400 | `VALIDACION` | Para filtrar por cercanía necesitamos tu ubicación (`radioKm` sin coordenadas) |
| 400 | `VALIDACION` | El radio no es válido |
| 400 | `VALIDACION` | El límite tiene que ser un número entre 1 y 50 |
| 400 | `VALIDACION` | El cursor no es válido |
| 400 | `CURSOR_INVALIDO` | No pudimos seguir cargando los avisos |

`CURSOR_INVALIDO` es un `cursor` con formato correcto pero que no corresponde a ningún aviso. Si el aviso del cursor se dio de baja mientras el usuario scrolleaba, **no** es un error: la paginación sigue.

---

## `GET /api/v1/animales-perdidos/ubicaciones` — Opciones del filtro por lugar

Cada provincia que tiene avisos visibles, con **sólo las localidades que tienen avisos**, las dos en orden alfabético. Es lo que llena los desplegables de "Provincia" y "Localidad" en la pantalla de filtros: con el catálogo completo, sólo Mendoza tendría unas 200 localidades, casi todas sin resultados.

### Headers

```
Authorization: Bearer <token>
```

### Respuesta 200

```json
[
  { "provincia": "Mendoza", "localidades": ["Chacras de Coria", "Godoy Cruz", "Guaymallén", "Maipú"] },
  { "provincia": "San Juan", "localidades": ["Rivadavia"] }
]
```

Sin avisos, `[]`. Cada provincia se manda tal cual en `?provincias=`, y cada localidad junto a su provincia en `?localidades=provincia|localidad`. Los avisos viejos sin provincia no aparecen acá.

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

## `POST /api/v1/animales-perdidos/:id/reclamo` — Reclamar el aviso (HU-13.2)

Abre la **sala de reencuentro** con quien publicó el aviso y deja adentro la tarjeta del aviso. Si la sala ya existe, la devuelve.

Es el botón **"Enviar mensaje"** del popup de detalle de GUI-06.

### Headers

```
Authorization: Bearer <token>
```

`X-Ambito` no cambia nada: el aviso es de la persona y la sala también, así que un miembro de refugio reclama como persona aunque esté en vista refugio. La sala queda con `refugio_id` en `NULL` y las dos partes la ven desde su perfil **personal**.

### Body

No recibe body.

### Respuesta — 200 OK

```json
{ "chatId": 42, "nueva": true }
```

| Campo | Tipo | Qué es |
|---|---|---|
| `chatId` | number | La sala. El cliente navega a ella y la pinta con `GET /chats/:chatId`, que existe justamente para abrir una sala sin pasar por el listado. |
| `nueva` | boolean | `false` si la sala ya existía. |

**200 y no 201 porque es idempotente.** El botón no se esconde después del primer reclamo, así que volver a tocarlo es el caso normal: devuelve la misma sala y **no** duplica la tarjeta. La sala es por **aviso y por reclamante**: el mismo aviso reclamado por cinco personas abre cinco salas, y dos personas que ya tenían una conversación por una adopción abren además otra por el aviso (el motivo está en la [spec 024 §3](specs/024-reclamar-mascota-perdida.md)).

### Errores

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 400 | `RECLAMO_PROPIO` | Este aviso es tuyo: no podés reclamarlo | El reclamante es el reportante. El front ya esconde el botón con `esPropio`. |
| 400 | `VALIDACION` | El id no es válido | `:id` no es un entero positivo |
| 404 | `NO_ENCONTRADO` | No encontramos ese aviso | No existe, o está dado de baja |
| 409 | `AVISO_RESUELTO` | Este caso ya está resuelto | El aviso está en estado Resuelto |
| 409 | `REPORTANTE_INACTIVO` | No podemos abrir la conversación: la cuenta de quien publicó el aviso fue dada de baja | — |

---

## `POST /api/v1/animales-perdidos/:id/resuelto` — Cerrar el caso (HU-13.2)

El reportante marca que el animal volvió. El aviso pasa a **Resuelto**, se le llena `fechaResuelto` y **sus salas quedan en sólo lectura**, con un mensaje de sistema "Volvió con su dueño" en cada una.

Es el botón **"Resuelto"** del popup de detalle de GUI-06, que sólo aparece en un aviso propio.

### Headers

```
Authorization: Bearer <token>
```

### Body

No recibe body.

### Respuesta — 200 OK

La **tarjeta de aviso** completa (la misma forma de arriba), ya con `estado.nombre: "Resuelto"` y `fechaResuelto` llena, para que el cliente reemplace el ítem del portal en memoria sin refetch.

### Qué significa "cerrar la sala"

**Sólo lectura, no baja lógica.** La conversación sigue apareciendo en el listado y se puede leer; lo que no acepta son mensajes nuevos (409 `CHAT_CERRADO` en el envío). Dar de baja la sala justo cuando el caso se resolvió es lo peor para coordinar la entrega real del animal, que no termina cuando alguien toca el botón.

El estado **se deriva** del aviso: no hay columna en `chat`. El cliente lo recibe resuelto en `soloLectura` de la cabecera (ver [`api-chat-sala.md`](./api-chat-sala.md)).

Si el mensaje de cierre falla, **el caso queda resuelto igual**: lo único que se pierde es esa línea en la sala.

### Errores

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 400 | `VALIDACION` | El id no es válido | `:id` no es un entero positivo |
| 403 | `SIN_PERMISO` | Sólo quien publicó el aviso puede resolverlo | Lo intenta un reclamante |
| 404 | `NO_ENCONTRADO` | No encontramos ese aviso | No existe, o está dado de baja |
| 409 | `AVISO_RESUELTO` | Este caso ya está resuelto | Ya estaba Resuelto. "Resuelto" es terminal hasta HU-13.3. |

---

## Notas para las pantallas

### GUI-06 — Mascotas Perdidas (portal)

1. **Scroll infinito con `proximoCursor`.** Al llegar al final, si `hayMas` es `true`, pedir la página siguiente con los mismos filtros y el cursor. No calcular offsets.
2. **Nombre vacío:** si `nombre` es `null`, mostrar la especie en su lugar ("Gato encontrado").
3. **Badge de estado** con `estado.nombre`. Los avisos Resueltos también aparecen: la HU los quiere visibles.
4. **Botón "Enviar mensaje"** (HU-13.2): visible cuando `esPropio` es `false` y el aviso no está Resuelto. Llama a `POST /animales-perdidos/:id/reclamo` y navega a `/chats/<chatId>` con el id que devuelve.
5. **Botón "Marcar como resuelto"** (HU-13.2): en su lugar cuando `esPropio` es `true` y el aviso no está Resuelto, con modal de confirmación (regla transversal 6). Llama a `POST /animales-perdidos/:id/resuelto` y reemplaza el aviso del portal con la tarjeta que devuelve.
6. **Aviso Resuelto:** la leyenda "Volvió con su dueño" en la tarjeta y en el detalle, y ninguno de los dos botones.
7. **Pantalla de filtros:** fecha "desde" (obligatoria para filtrar por fecha) y "hasta" (opcional); estados de `GET /estados-animal-perdido`; especies de `GET /especies`, las dos de selección múltiple; provincias y localidades (varias de cada una, en desplegables) de `GET /animales-perdidos/ubicaciones`; y un radio en km para la cercanía.
8. **Estados de la pantalla:** cargando / vacío / error. El vacío es `avisos: []`, no un error.
9. **Ubicación del usuario:** mandar `latitud` y `longitud` siempre que se tengan, aunque no haya radio: así cada tarjeta trae `distanciaKm`. Sin permiso de ubicación el portal funciona igual, sin distancias ni filtro por cercanía.
10. **Detalle:** `ubicacion` ya viene armada para mostrar; `mapaUrl` alimenta el botón "Ver en Google Maps".

### GUI-25 — Nueva publicación perdida/encontrada

1. **Selector de estado** sólo con los que tienen `seleccionableEnAlta: true`.
2. **Nombre obligatorio sólo si eligió Perdido.** Conviene marcar el asterisco según el estado elegido.
3. **Fotos:** de 1 a 5 (`LIMITES.animalPerdido.imagenes.max`), desde la cámara o la galería. Cada una pasa por la vista previa donde se puede girar, sin el recorte nativo del sistema. La primera es la portada.
4. **Detalle del aviso:** la tarjeta del portal usa `imagenUrl`; el popup de detalle muestra `imagenes` en una galería que se desliza.
5. **Coordenadas:** tomarlas del dispositivo al guardar. Si el usuario no dio permiso de ubicación, la HU lo tiene como precondición: pedirlo antes de dejarlo publicar.
6. **Fecha** del suceso con el calendario (`DateField`), por defecto hoy; no puede ser futura. Se manda como `AAAA-MM-DD`.
7. **Contadores** de 30 (nombre), 300 (descripción) y 120 (referencia). Los límites ya están espejados en `apps/mobile/shared/validation/limits.ts` (`LIMITES.animalPerdido`).
8. **Al publicar,** el aviso vuelve con la misma forma de la tarjeta del portal: se puede insertar arriba de la lista sin volver a pedirla.
9. **Lugar:** provincia y localidad con los mismos selectores buscables del perfil (`constants/Provincias.ts`), y la referencia opcional como texto libre. Conviene precargar la provincia y la localidad del perfil, editables.
10. **Lugar en el mapa:** como la dirección del perfil, con `POST /lugar/preview` se muestra el link de Google Maps para verificar el pin, y con `POST /lugar/link` se corrige pegando un link. El punto que quede se manda en el alta (`lugarLatitud`/`lugarLongitud`). Mientras el preview se recalcula, no mandar el punto anterior.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **HU-13.1 cubrió alta y portal, nada más** | La HU se titula "Registrar", pero sus criterios mezclan el botón "Abrir chat" y el botón "Resuelto". Se dejaron para diseñarlos una sola vez: los dos entraron en HU-13.2 (spec 024), el segundo porque "cierra el caso y el chat asociado" no se podía implementar antes de que la sala existiera. |
| **Columna nueva `animal_perdido_nombre`, obligatoria sólo en Perdido** | La HU pide un nombre de hasta 30 caracteres y el modelo no lo tenía. No puede salir de `mascota_id` porque es opcional y un animal encontrado no tiene mascota. Es opcional en Encontrado porque quien encuentra un animal no sabe cómo se llama. |
| **El lugar como la dirección del perfil: provincia y localidad de georef, más referencia libre** | Es el criterio que el equipo adoptó en el Módulo 11 para el perfil (catálogo de georef embebido en el cliente, guardado como texto). Reemplazó al texto libre del primer corte de HU-13.1 (2026-09-30). La referencia es opcional porque muchas veces no hay nada más preciso que decir que el barrio. |
| **Provincia y localidad como texto, no como FK** | Igual que en el perfil: el catálogo vive en el cliente y no hay tablas de provincias ni localidades. Si algún día se pasan a tablas, se migran las tres ubicaciones juntas (perfil, publicación y aviso). |
| **El lugar se geocodifica al publicar** | Sin coordenadas del lugar no hay distancia ni link a Maps preciso. Se hace en el alta y no al listar, para no depender del geocoder en cada pedido. Si falla, el aviso se publica igual: el lugar en texto sigue siendo la información principal. |
| **Primero con la referencia, después sin ella** | La referencia es texto libre y muchas veces el geocoder no la entiende ("frente a la plaza"). Probar después con localidad y provincia deja al menos el centro de la localidad. |
| **El filtro por lugar sólo ofrece lugares con avisos** | Con el catálogo completo, sólo Mendoza tiene unas 200 localidades: una lista así de pastillas no se puede usar, y casi todas darían cero resultados. |
| **`localidades` va con un parámetro por valor, no con comas** | Hay nombres del catálogo con coma. Los filtros por id (`estados`, `especies`) siguen el formato con comas del resto de la API. |
| **Cada localidad viaja con su provincia («provincia\|localidad»)** | Unos 200 nombres de localidad del catálogo se repiten en más de una provincia (Rivadavia está en Mendoza y en San Juan). Con varias provincias elegidas, sólo el nombre no alcanza para saber cuál se eligió. |
| **Provincias y localidades con Y** | Si el usuario eligió localidades, espera ver esas: que una provincia elegida sumara todos sus avisos contradiría el desplegable de localidad. |
| **El punto del lugar lo puede mandar el cliente** | Es el que el usuario vio y verificó en el mapa, o el del link que pegó: cualquiera de los dos es un dato suyo, como el link del perfil. Además ahorra geocodificar dos veces. Sin punto, el alta geocodifica como antes. |
| **Preview y link sin guardar nada** | El aviso todavía no existe: a diferencia del perfil, que guarda el link corregido en el momento, acá el punto queda en el formulario hasta publicar. |
| **Cercanía desde el lugar, con respaldo en el teléfono de quien publicó** | La distancia que importa es hasta donde se perdió o se encontró el animal. Si el geocoder no ubicó el lugar, el punto de publicación es la mejor aproximación para no dejar el aviso afuera de toda búsqueda por cercanía; como sólo decide si entra o no en el radio, no se filtra. |
| **`distanciaKm` y `mapaUrl` nunca con las coordenadas del teléfono** | Revelarían dónde estaba quien reportó. Por eso sin lugar geocodificado la distancia es `null` y el link busca el texto. |
| **El alta devuelve la distancia desde quien publica** | Es la que vería esa persona en el portal, así la tarjeta que el cliente inserta arriba sin recargar trae el mismo dato. Es su propia ubicación: no expone a nadie. |
| **Columna nueva `animal_perdido_fecha_suceso`, obligatoria en el alta** | El formulario de la pantalla 26 del diseño tiene un campo "Fecha" que el modelo no tenía (agregada el 2026-09-29, al implementar el front). Es el día en que se perdió o se encontró, que no tiene por qué ser el de la publicación: el portal sigue ordenando y filtrando por `fechaAlta`, como pide la HU. Viaja como `AAAA-MM-DD`, sin hora, para que un día cargado en Argentina no se corra al anterior en otra zona horaria. |
| **FK directa `especie_id`** | Llegar a la especie por `mascota_id` → raza → especie no sirve para un animal encontrado, que no tiene mascota asociada. |
| **Columnas nuevas nullables en base, obligatorias en el alta** | Igual que los campos que HU-6.1 le sumó a `Mascota`: los avisos cargados antes no quedan inválidos. El seed completa los suyos. |
| **Las coordenadas del teléfono siguen obligatorias pero no se exponen** | Son las del teléfono al momento de publicar (`MODELO_DATOS.md`), no la ubicación del animal, que la dan provincia, localidad y referencia. Mostrarlas revelaría dónde estaba quien reportó. |
| **Coordenadas sin redondear** | El GPS entrega 10 o más decimales. `parsearDecimal` no servía: no acepta negativos (y en Argentina las dos coordenadas lo son) y rechaza el exceso de decimales. Se sumó `parsearCoordenada` en `shared/validation`. |
| **Paginación por cursor** | Con offset, cada aviso nuevo publicado mientras el usuario scrollea corre la página y repite o saltea tarjetas. Queda como **estándar del proyecto para los listados de la app móvil** (`AGENTS.md`); las tablas de web-admin siguen por offset. |
| **Id como desempate del orden** | Dos avisos del mismo instante tienen que salir siempre en el mismo orden, o el cursor los repetiría o saltearía. Lo sostiene el índice parcial `animal_perdido_listado_idx`. |
| **Sin `total`** | Contarlo con los filtros aplicados es una segunda query que el portal no necesita: el scroll sólo pregunta si hay más. |
| **Cursor inexistente → `400 CURSOR_INVALIDO`** | Con un id que no existe, Prisma devuelve una página vacía sin avisar y el cliente creería que llegó al final. Mismo criterio que el historial del chat. |
| **El aviso es de la persona, desde cualquier perfil** | Varios criterios de la HU dicen "usuario refugio", pero el actor declarado es el adoptante: se tomó como un error de copia y el actor es cualquier usuario autenticado. La sala de reencuentro (HU-13.2) también es entre personas, sin `refugioId`. |
| **Sin tope de avisos activos** | La cuota anti-spam de la regla transversal 7 es de `Publicacion`. Si hace falta un límite para avisos, se evalúa con HU-13.3. |
| **Archivo demasiado grande → `400`, no `413`** | Es el código de toda la API para ese caso (`ARCHIVO_DEMASIADO_GRANDE`). Cambiarlo implicaría tocar el middleware de subida que usan todos los módulos. |
| **Mensajes de validación en español en todos los módulos** | De paso se corrigieron dos helpers compartidos: `idSchema` devolvía "Expected number, received nan" en inglés cuando faltaba un id (pasaba también en el alta de mascota) y no concordaba en género ("La especie no es válido"). Se sumó `limitePaginaSchema` para que `limite` también falle en español. |
| **SQL a mano sólo para el radio** | Prisma no calcula distancias: el filtro por cercanía usa un `$queryRaw` con Haversine, igual que `idsPublicacionCerca` de publicaciones, y después el listado con cursor se restringe a esos ids. Las opciones del filtro se traen con Prisma (`distinct`) y se agrupan en el servicio. |

---

## Pendiente para otros módulos

### HU-13.3 — Gestión de estados (lo que no entró en HU-13.2)

El paso a **Resuelto** y el cierre de las salas ya están: los implementó HU-13.2 (spec 024), porque "cierra el caso y el chat asociado" no se podía hacer antes de que existiera la sala. Queda:

- **Histórico de estados:** hoy "Resuelto" es **terminal** y alcanzan la FK, `fecha_resuelto` y las columnas de auditoría. Si un aviso se puede **reabrir** o pasar de Perdido a Encontrado, conviene una tabla `AnimalPerdidoEstado` con el mismo patrón que `PublicacionEstado` (una fila vigente por aviso y el historial completo). El sólo lectura de las salas se deriva del estado del aviso, así que reabrir un caso reabre sus salas sin tocar `chat`.
- **Editar y dar de baja el aviso** por el reportante (baja lógica).
- **Tope anti-spam** de avisos activos por usuario, si el equipo lo quiere.
- **Cerrar las salas de un aviso dado de baja por moderación:** hoy quedan vivas y escribibles. Anotado en `DEUDA_TECNICA.md`.

### Avisos viejos sin provincia

Los avisos cargados con el primer corte de HU-13.1 (texto libre) pasaron su texto a `localidad` con la migración `20260930120000_hu131_animal_perdido_provincia_localidad`, pero quedaron **sin provincia ni coordenadas del lugar**: no aparecen en las opciones del filtro por lugar ni tienen distancia. Los del seed se completan solos al correrlo; los cargados a mano en una base de desarrollo, no. Cuando exista la edición del aviso (HU-13.3) se pueden corregir desde la app.

### Vincular la mascota propia

`animal_perdido.mascota_id` existe pero el alta todavía no lo recibe. Cuando se quiera, el alta de un aviso Perdido podría ofrecer elegir una mascota registrada del usuario y precargar nombre, especie y foto.
