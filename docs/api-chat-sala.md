# Contrato de API — Chat (sala de conversación y tiempo real)

Endpoints y eventos de **HU-5.2 (Envío y recepción de mensajes en la sala de chat)**, listos para consumir desde `pethood-frontend`. Está implementado y testeado.

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md`.

La pantalla que lo consume es **GUI-14 (Conversación)**, a la que se llega desde GUI-08 (Chat Adoptante) y GUI-31 (Chat Refugio). El listado de conversaciones es **HU-5.1** y está en [`api-chats.md`](./api-chats.md) — conviene leer ese primero: las convenciones y la forma del contacto se definen ahí.

**Alcance de esta HU:** historial, envío, marcado de leídos, cabecera de la sala y la infraestructura de websockets. **Crear la sala sigue siendo de otra HU** y buscar conversaciones es HU-5.3.

---

## Convenciones comunes

Las mismas de [`api-chats.md`](./api-chats.md), sin excepciones:

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1`

**Autenticación REST:** obligatoria, `Authorization: Bearer <token>`.

**Formato de error** — siempre el mismo, en cualquier código de estado y **también por el socket**:

```json
{ "error": { "codigo": "SIN_ACCESO_AL_CHAT", "mensaje": "No tenés acceso a esta conversación" } }
```

El campo `mensaje` viene en español con voseo rioplatense y **se puede mostrar tal cual en el toast**.

**Imágenes:** `imagenUrl` es una ruta relativa (`/api/v1/archivos/chats/xxx.jpg`). Hay que anteponerle el host del backend para renderizarla.

**Fechas:** ISO 8601 crudo (`2026-09-01T14:05:00.000Z`). **La hora la formatea el cliente.**

---

## El objeto `Mensaje`

**Una sola forma, en los dos canales.** Es lo que devuelve el historial, lo que devuelve el POST de envío y lo que viaja en el evento `chat:mensaje-nuevo`. El cliente usa **un solo tipo y un solo mapper**, y puede mezclar en la misma lista mensajes que llegaron por caminos distintos.

```json
{
  "id": 412,
  "chatId": 8,
  "contenido": "Dale, te espero el sábado a las 10",
  "imagenUrl": null,
  "imagenes": [],
  "adjuntos": [],
  "usuarioId": 41,
  "tipo": "TEXTO",
  "entregado": true,
  "leido": false,
  "fechaLectura": null,
  "solicitud": null,
  "fechaAlta": "2026-09-01T14:05:00.000Z"
}
```

| Campo | Qué es |
|---|---|
| `id` | Id del mensaje. **Es la clave de deduplicación** (ver "Doble entrega") y el cursor de paginación |
| `chatId` | Redundante dentro del historial, imprescindible en el evento de socket |
| `contenido` | Texto, **sin truncar**. Cadena vacía (`""`) en un mensaje de solo foto o en uno de tipo `SOLICITUD` |
| `imagenUrl` | **Primera** foto, o `null`. Es siempre `imagenes[0]`: existe para los clientes que sólo saben de una |
| `imagenes` | **Todas** las fotos, en el orden en que se enviaron. Vacío si el mensaje es solo texto. Hasta 5. Puede contener la URL de un video |
| `adjuntos` | Las **mismas** URLs de `imagenes`, cada una con su `tipo`: `{ url, tipo: "IMAGEN" \| "VIDEO" }`. Es el campo a usar de ahora en más |
| `usuarioId` | **Id del emisor.** El cliente lo compara con su sesión para decidir el lado de la burbuja |
| `tipo` | `"TEXTO"` o `"SOLICITUD"`. Ver "Mensajes de sistema" |
| `entregado` | Le llegó al destinatario, aunque no lo haya abierto → **segundo tilde** |
| `leido` | El destinatario lo leyó → **doble tilde pintado**. Un mensaje leído está siempre entregado |
| `fechaLectura` | Cuándo lo leyó, ISO 8601 crudo, o `null` si todavía no |
| `solicitud` | Sólo en los de `tipo: "SOLICITUD"`. Ver "Mensajes de sistema" |
| `fechaAlta` | ISO 8601 crudo |

### ⚠️ `entregado` y `leido` son de la SALA, no del mensaje

El estado no vive en el mensaje sino en cada participante: `usuario_chat_ultima_lectura` y
`usuario_chat_ultima_entrega` dicen hasta qué momento tiene la sala leída y recibida. Un
mensaje está `leido` cuando **todos los que no lo emitieron** tienen una marca posterior a su
fecha.

Dos consecuencias para el cliente:

1. **Los tres estados avanzan de a bloques.** Cuando el otro abre la conversación, todos los
   mensajes anteriores pasan a leídos de una, y comparten la misma `fechaLectura`. No hay
   forma de que el mensaje 5 esté leído y el 4 no.
2. **`leido` en un mensaje AJENO habla de vos**, no del otro: es "¿el destinatario lo leyó?",
   y el destinatario de lo que te mandaron sos vos. El cliente sólo lo pinta en los propios.

Esto reemplaza al booleano `mensaje_leido`, que no tenía dueño y rompía con tres o más
participantes. La columna sigue existiendo en la base y poblándose, pero **ninguna respuesta
de la API sale de ella**.

### Mensajes de sistema: la solicitud embebida

Un mensaje con `tipo: "SOLICITUD"` no es una burbuja: es la **tarjeta del pedido** que
PetHood deja en la sala cuando se envía una solicitud. Lo emite el usuario SISTEMA (su
`usuarioId` no es ninguno de los participantes), su `contenido` va vacío y trae la solicitud
resuelta:

```json
{
  "id": 400,
  "chatId": 8,
  "contenido": "",
  "imagenUrl": null,
  "imagenes": [],
  "adjuntos": [],
  "usuarioId": 1,
  "tipo": "SOLICITUD",
  "entregado": true,
  "leido": true,
  "fechaLectura": "2026-09-01T12:30:00.000Z",
  "solicitud": {
    "id": 1042,
    "tipo": "Adopcion",
    "estado": "Pendiente",
    "fechaAlta": "2026-09-01T12:27:00.000Z",
    "mascota": {
      "id": 5,
      "nombre": "Max",
      "especie": "Perro",
      "fechaNacimiento": "2024-02-12T00:00:00.000Z",
      "imagenUrl": "/api/v1/archivos/publicaciones/max.jpg"
    }
  },
  "fechaAlta": "2026-09-01T12:27:00.000Z"
}
```

| Campo de `solicitud` | Qué es |
|---|---|
| `id` | Para navegar al detalle: `GET /solicitudes/:id`. **El chat no lo duplica** |
| `tipo` | `"Adopcion"` o `"Transito"`, del catálogo |
| `estado` | Estado **vigente**: "Pendiente", "Aceptada", "Rechazada"… El color lo decide el cliente |
| `fechaAlta` | Cuándo se envió, ISO 8601 crudo |
| `mascota.nombre` | Puede ser `null`: el texto de relleno lo pone el cliente |
| `mascota.fechaNacimiento` | ISO crudo o `null`. **La edad la calcula el cliente**, igual que en HU-6.6 |
| `mascota.imagenUrl` | La de la publicación, o la de la mascota si aquélla no tiene |

El `estado` se resuelve **en el momento del pedido**, no cuando se creó el mensaje: si el
refugio ya respondió, la tarjeta del historial muestra el estado nuevo. Es a propósito —
una tarjeta que dijera "En revisión" para siempre mentiría.

**No viene `esMio`.** Viaja `usuarioId` y el cliente compara: es un dato, no una vista. (El `esMio` que sí existe en el preview de HU-5.1 está ahí por otro motivo — evitarle al listado conocer al emisor de cada última línea.)

---

## `GET /api/v1/chats/:chatId` — Cabecera de la sala

Con esto **la pantalla se pinta sola**, sin depender de lo que le haya pasado el listado por navegación. Existe porque abrir el chat desde una notificación push (HU-4.3) o por deep link no pasa por GUI-08.

### Respuesta 200

```json
{
  "chatId": 8,
  "contacto": {
    "tipo": "USUARIO",
    "id": 41,
    "nombre": "Ana Pérez",
    "imagenUrl": "/api/v1/archivos/usuarios/ana.jpg",
    "activo": true
  },
  "enLinea": true,
  "minutosRespuesta": 120,
  "solicitud": {
    "id": 1042,
    "tipo": "Adopcion",
    "estado": "Pendiente",
    "fechaAlta": "2026-09-01T12:27:00.000Z",
    "mascota": {
      "id": 5,
      "nombre": "Max",
      "especie": "Perro",
      "fechaNacimiento": "2024-02-12T00:00:00.000Z",
      "imagenUrl": "/api/v1/archivos/publicaciones/max.jpg"
    }
  }
}
```

`contacto` es **exactamente el mismo objeto** que el del listado (HU-5.1) y lo resuelve el mismo código: mismos campos, misma regla adoptante↔refugio, mismo significado de `activo`.

| Campo | Qué es |
|---|---|
| `enLinea` | Snapshot de presencia al momento del pedido. **A partir de ahí lo actualiza `chat:presencia`** |
| `minutosRespuesta` | En cuántos MINUTOS suele responder el contacto en esta sala, o `null`. Alimenta el "responde en ~2 h" del header |
| `solicitud` | La solicitud **vigente** de la sala —la última tarjeta que se dejó—, o `null` si no hay ninguna. Una conversación con un refugio acumula pedidos; acá va el más reciente. Alimenta el subtítulo "Solicitud #1042 · Max" |

**`minutosRespuesta` viaja como número y no como texto** por el mismo motivo que las fechas
van en ISO: "~2 h" es una decisión de UI y el redondeo depende del idioma.

Se calcula sobre los últimos 60 mensajes de la sala, midiendo cada vez que el contacto
contesta: desde el primer mensaje nuestro sin responder hasta su respuesta. Es la **mediana**
y no el promedio — una sola respuesta al otro día corre un promedio a un número que no
describe nada. Con menos de dos respuestas devuelve `null`: con un solo dato no hay
tendencia, y es preferible no decir nada a inventar una expectativa.

**Un refugio nunca viene `enLinea: true`**: es una institución, no una sesión. Sólo las personas se conectan.

### Errores

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `NO_AUTENTICADO` | Sin token, o vencido |
| 403 | `SIN_ACCESO_AL_CHAT` | No sos participante activo de esa sala |
| 404 | `NO_ENCONTRADO` | El `:chatId` no es un número |
| 404 | `CHAT_SIN_CONTACTO` | La sala no tiene ninguna contraparte activa: no hay cabecera que pintar |

---

## `GET /api/v1/chats/:chatId/mensajes` — Historial

### Query params

| Param | Tipo | Default | Qué hace |
|---|---|---|---|
| `antesDe` | id de mensaje | — | Devuelve los mensajes **anteriores** a ese. Sin él, la primera página (la más reciente) |
| `limite` | entero | `30` | Máximo `50` |

### Respuesta 200

```json
{
  "mensajes": [
    { "id": 412, "chatId": 8, "contenido": "Dale, te espero el sábado a las 10", "imagenUrl": null, "usuarioId": 41, "leido": false, "fechaAlta": "2026-09-01T14:05:00.000Z" },
    { "id": 411, "chatId": 8, "contenido": "", "imagenUrl": "/api/v1/archivos/chats/e3f1.jpg", "usuarioId": 7, "leido": true, "fechaAlta": "2026-09-01T13:58:00.000Z" }
  ],
  "hayMas": true,
  "proximoCursor": 411
}
```

### ⚠️ Orden: DESCENDENTE, del más reciente al más viejo

`mensajes[0]` es **el último mensaje de la conversación**. Es el orden que consume una `FlatList inverted` de React Native sin dar vuelta nada, el que devuelve el índice sin un `Sort` extra, y el que hace que el cursor signifique "seguir hacia atrás".

**El cliente no tiene que invertir la página.** Si la lista no es invertida, ahí sí hay que dar vuelta el array.

Es el mismo desempate que usa el último mensaje del listado (`fechaAlta DESC, id DESC`), así que **la última línea que muestra GUI-08 es siempre la primera fila que devuelve la sala**.

| Campo | Qué es |
|---|---|
| `hayMas` | `true` si quedan mensajes más viejos por traer |
| `proximoCursor` | Id a mandar como `antesDe` para la página siguiente. `null` cuando ya se llegó al principio |

### Cómo paginar

1. Primera carga: `GET /chats/8/mensajes` → guardás `proximoCursor`.
2. El usuario scrollea hacia arriba y `hayMas` es `true`: `GET /chats/8/mensajes?antesDe=411`.
3. Repetir hasta que `hayMas` sea `false`.

**Es cursor y no offset a propósito:** mientras el usuario scrollea pueden entrar mensajes nuevos, y con `?page=2` esa ventana se corre — se saltea o se duplica lo que quedó en el borde. Con un id de mensaje el punto de corte es fijo.

### Errores

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `NO_AUTENTICADO` | Sin token, o vencido |
| 403 | `SIN_ACCESO_AL_CHAT` | No sos participante activo |
| 400 | `VALIDACION` | `limite` fuera de rango o `antesDe` no numérico |
| 400 | `CURSOR_INVALIDO` | El `antesDe` es un mensaje de **otra** sala |
| 404 | `NO_ENCONTRADO` | El `:chatId` no es un número |

Una sala sin mensajes devuelve **200** con `{ "mensajes": [], "hayMas": false, "proximoCursor": null }` — es un estado normal, no un error.

---

## `POST /api/v1/chats/:chatId/mensajes` — Enviar

**El envío es REST, no socket.** El socket sólo entrega (ver "Decisiones").

### Request

Dos formatos, según lleve foto o no:

**`multipart/form-data`** (texto y/o fotos):

| Campo | Tipo | Obligatorio |
|---|---|---|
| `contenido` | texto, ≤1000 caracteres | Solo si no hay `foto` |
| `foto` | jpg/png/webp (≤5 MB) — o **un video** mp4/mov/webm (≤30 MB). **Se puede repetir hasta 5 veces** | Solo si no hay `contenido` |
| `rotacion` | `90` \| `180` \| `270` | No — sin rotación por defecto. **Sólo con una `foto`** |
| `cropX`, `cropY`, `cropWidth`, `cropHeight` | enteros ≥0, en píxeles sobre la `foto` original | No — los cuatro juntos o ninguno. **Sólo con una `foto`** |

**El campo se sigue llamando `foto` aunque acepte varias**: multipart admite repetir el mismo
nombre, así que un cliente que manda una sola sigue funcionando sin cambiar nada. Las fotos se
guardan **en el orden en que viajan**, y ese es el orden de `imagenes`.

**`rotacion` y el recorte sólo se aplican cuando el mensaje lleva UNA sola foto.** Un único
rectángulo no puede aplicarse a imágenes distintas, así que con dos o más adjuntos esos
parámetros se ignoran. No es un error: el mensaje se envía igual y las fotos se comprimen sin
editar.

### Video (HU-5.2, ampliación)

El campo `foto` también acepta **un** video. Se llama igual a propósito: es el nombre que el
cliente ya manda y multipart no distingue por nombre, así que renombrarlo a `adjunto`
obligaría a versionar el endpoint por una cuestión cosmética.

| Regla | Valor | Quién la hace cumplir |
|---|---|---|
| Formatos | `video/mp4`, `video/quicktime` (.mov de iOS), `video/webm` | Backend (`multer`), 400 `ARCHIVO_INVALIDO` |
| Tamaño | **≤30 MB** — excepción explícita a los 5 MB de REQUISITOS.md §4, ver abajo | Backend, 400 `ARCHIVO_DEMASIADO_GRANDE` |
| Duración | ≤15 s | **El cliente.** Ver abajo |
| Cantidad | 1 por mensaje | Backend, 400 `DEMASIADOS_ARCHIVOS` |
| Mezcla con fotos | No se permite | Backend, 400 `ADJUNTOS_MEZCLADOS` |
| Pie de texto | Sí, igual que con una foto | — |

#### Por qué 30 MB y no 5

Los 5 MB de REQUISITOS.md §4 son la regla transversal para imágenes y documentos, y **para
video no alcanzan**. Un teléfono graba 1080p a unos 13 Mbps:

| Calidad | 15 s pesan | En 5 MB entran |
|---|---|---|
| 480p | 3,8 MB | 20 s |
| 720p | 9,4 MB | 8 s |
| **1080p (lo normal)** | **24,9 MB** | **3 s** |
| 4K | 84,4 MB | 0,9 s |

Con 5 MB el usuario manda **3 segundos**, que no sirve para nada. 30 MB cubren los 15 s a
1080p con margen y siguen rechazando un 4K de 15 s, que se avisa con un mensaje claro.

**Bajar el peso en vez de subir el tope no era una opción disponible:** recomprimir en el
servidor necesita `ffmpeg`, y hacerlo en el cliente necesita un módulo nativo de
transcodificación que rompería las pruebas con Expo Go. `expo-image-picker` sólo permite
bajar la calidad de grabación en iOS, no en Android.

> **Esto hay que reflejarlo en REQUISITOS.md §4**, que hoy dice 5 MB para todo archivo. Es
> una excepción acotada al video de chat: imágenes y documentos siguen en 5 MB, en todos los
> módulos y también en el chat.

**Las imágenes del chat siguen topeadas en 5 MB.** El `fileSize` de multer es uno por
instancia y no conoce el mimetype hasta que el archivo ya entró, así que el techo del request
es el del video (30 MB) y después `validarTamanioAdjuntos` le aplica a cada archivo el tope de
su tipo. Corre **antes** de comprimir: una vez que `sharp` achicó la imagen, el peso que se
mide ya no es el que subió el usuario.

**La duración la hace cumplir el cliente, no el backend.** Medirla en el servidor necesita
`ffmpeg`. Los 15 segundos existen para que el usuario no elija de la galería un video largo y
se lo rechacen **después** de haberlo subido entero.

**El video se guarda tal cual, sin transcodificar ni recomprimir.** `sharp` no procesa video
y `comprimirImagen` lo deja pasar. Tampoco se genera miniatura en el servidor: la tarjeta con
el ícono de reproducir la arma el cliente.

**`rotacion` y el recorte no aplican a un video**: se ignoran aunque vengan.

> ⚠️ **Deuda conocida de almacenamiento.** Los adjuntos de chat van a disco local
> (`uploads/chats/`) y **en Render el disco es efímero: cada deploy los borra**. Ya era así
> con las fotos; con videos de hasta 30 MB el problema se acelera. La migración a object
> storage es un PR propio que tiene que tocar todos los módulos a la vez (ver el cierre de
> este documento) — `shared/r2.ts` ya existe pero hoy sólo lo usa la foto de perfil.

**`application/json`** (solo texto):

```json
{ "contenido": "Dale, te espero el sábado a las 10" }
```

**Texto y foto pueden ir juntos** — el pie de foto es un mensaje válido. Lo que no se acepta es un mensaje sin ninguno de los dos.

La foto única se recorta (si vinieron `cropX`/`cropY`/`cropWidth`/`cropHeight`) y rota (si vino `rotacion`) antes de comprimirse en el servidor (`sharp`, ancho máx. 1600px), igual que en el alta de mascota. El recorte se aplica primero y sus coordenadas son siempre sobre la imagen original que se subió, no sobre una ya rotada. `RECORTE_INVALIDO` (400) si el rectángulo excede la imagen; `VALIDACION` (400) si `rotacion` no es 0/90/180/270 o si el recorte viene incompleto.

**`adjuntos` reemplaza a `imagenes` sin romperla.** Desde que un mensaje puede llevar video,
el nombre `imagenes` dejó de describir lo que trae: `adjuntos` es la misma lista con el tipo
ya resuelto por el backend, **el cliente no deduce nada de la extensión del archivo**. Es el
mismo criterio con el que el listado entrega el contacto ya resuelto. `imagenes` e
`imagenUrl` se mantienen intactas para no romper a los clientes que ya las consumen.

### Respuesta 201

El objeto `Mensaje` completo, **ya persistido**: cuando el cliente recibe el 201, el `id` y la `fechaAlta` son los definitivos y el broadcast a los participantes ya salió.

```json
{
  "id": 413,
  "chatId": 8,
  "contenido": "Perfecto, ahí estaré",
  "imagenUrl": null,
  "usuarioId": 7,
  "leido": false,
  "fechaAlta": "2026-09-01T14:07:12.000Z"
}
```

### Errores

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token de autenticación | Sin token |
| 403 | `SIN_ACCESO_AL_CHAT` | No tenés acceso a esta conversación | No sos participante activo |
| 400 | `MENSAJE_VACIO` | Escribí un mensaje o adjuntá una foto | Ni texto ni foto |
| 400 | `VALIDACION` | El mensaje no puede superar los 1000 caracteres | Texto demasiado largo |
| 400 | `ARCHIVO_INVALIDO` | Adjuntá una imagen (jpg, png o webp) o un video (mp4, mov o webm) | Formato no admitido |
| 400 | `ARCHIVO_DEMASIADO_GRANDE` | La imagen supera el máximo de 5MB | Imagen pesada |
| 400 | `ARCHIVO_DEMASIADO_GRANDE` | El video supera el máximo de 30MB | Video pesado |
| 400 | `DEMASIADOS_ARCHIVOS` | Podés subir hasta 5 archivos | Más de 5 en el mismo mensaje |
| 400 | `DEMASIADOS_ARCHIVOS` | Podés adjuntar un solo video por mensaje | Más de un video |
| 400 | `ADJUNTOS_MEZCLADOS` | Mandá el video solo: no se puede combinar con fotos en el mismo mensaje | Video + foto juntos |
| 409 | `CONTACTO_INACTIVO` | No podés escribirle: la cuenta de este contacto fue dada de baja | El otro se dio de baja |
| 404 | `CHAT_SIN_CONTACTO` | Esta conversación ya no tiene contraparte | Sala sin ningún otro participante activo |

**Sobre el 413:** el exceso de tamaño va como **400**, no 413. El middleware de upload es compartido con HU-6.1, publicaciones e historia clínica; devolver 413 sólo acá rompería la consistencia de la API por un matiz semántico. Si algún día se cambia, se cambia para todos los módulos a la vez.

**`CONTACTO_INACTIVO` es la contracara de `activo: false` del listado:** con una cuenta dada de baja se puede **leer** la conversación pero no escribirle. El cliente debería deshabilitar el input antes de llegar acá; el backend lo garantiza igual.

---

## `POST /api/v1/chats/:chatId/leidos` — Marcar como leída

Sin body. Marca como leídos **todos los mensajes ajenos** de la sala.

### Cuándo llamarlo

- **Al montar la pantalla de la conversación.**
- **Cuando la app vuelve a foco** con la conversación abierta.

**No** al renderizar cada mensaje: `mensaje_leido` es un booleano **único por mensaje, sin dueño**, así que el estado más fino que el modelo puede representar es "esta sala está leída". Un request por mensaje visible escribiría decenas de veces el mismo bit.

### Respuesta 200

```json
{ "chatId": 8, "noLeidos": 0, "marcados": 3 }
```

| Campo | Qué es |
|---|---|
| `noLeidos` | Siempre `0` — se acaba de marcar todo. Viaja para que **actualices el ítem del listado de HU-5.1 en memoria**, sin refetch |
| `marcados` | Cuántos cambiaron de estado en esta llamada. `0` al reabrir una sala ya leída, que es el caso normal |

### Cómo se entera la pantalla del listado (HU-5.1)

Dos vías, y conviene usar las dos:

1. **La respuesta HTTP**, en el dispositivo que marcó: actualizás el ítem con `noLeidos: 0` y listo.
2. **El evento `chat:no-leidos`** por socket, en los **otros dispositivos** del mismo usuario.

### Errores

Los de autenticación, más `403 SIN_ACCESO_AL_CHAT` y `404 NO_ENCONTRADO`.

---

## `POST /api/v1/chats/:chatId/entregados` — Acusar recibo

Sin body. Marca como **entregados** todos los mensajes ajenos de la sala: es el segundo
tilde del emisor.

### Cuándo llamarlo

**Apenas llega un `chat:mensaje-nuevo`**, estés donde estés: en la conversación, en el
listado o en cualquier otra pantalla. Eso es lo que distingue entregado de leído — entregado
significa "le llegó al dispositivo", no "lo abrió".

Conviene **agrupar**: si entran cinco mensajes seguidos, un solo llamado al final los cubre a
todos, porque el acuse es de sala y no de mensaje.

**No** hace falta llamarlo al abrir la conversación: `/leidos` ya adelanta la entrega, porque
no se puede haber leído algo que no llegó.

### Respuesta 200

```json
{ "chatId": 8, "marcados": 2, "hasta": "2026-09-01T14:05:00.000Z" }
```

| Campo | Qué es |
|---|---|
| `marcados` | Cuántos pasaron de "sin entregar" a "entregado" en esta llamada. `0` al reacusar lo ya acusado, que es el caso normal con varios dispositivos |
| `hasta` | La marca que quedó guardada: la fecha del último mensaje ajeno. `null` en una sala sin mensajes del otro |

### Errores

Los mismos de `/leidos`: autenticación, `403 SIN_ACCESO_AL_CHAT` y `404 NO_ENCONTRADO`.

---

# WebSockets

## Conexión y autenticación

**El servidor de sockets vive en el mismo proceso y el mismo puerto que la API REST**, sobre el mismo `http.Server`.

```
ws://<host>/socket.io
```

El JWT **no viaja en headers** —un websocket sólo tiene handshake— sino en `handshake.auth`:

```js
import { io } from 'socket.io-client';

const socket = io(EXPO_PUBLIC_API_URL, {
  auth: { token }, // el MISMO token del Bearer de REST
});
```

Se tolera tanto `"<token>"` como `"Bearer <token>"`.

**No va en la query string a propósito:** ahí terminaría escrito en los logs de acceso y en el historial de cualquier proxy intermedio.

Se verifica con el mismo verificador que usa REST. Si falla, **la conexión no llega a establecerse**:

```js
socket.on('connect_error', (err) => {
  // err.message === 'NO_AUTENTICADO'
});
```

### Token vencido con el socket abierto

El handshake se verifica **una sola vez**. Para que un socket abierto no se convierta en una sesión eterna, el servidor programa la desconexión para el momento exacto en que vence el token:

1. Emite `chat:error` con `{ error: { codigo: "NO_AUTENTICADO", mensaje: "Tu sesión expiró, volvé a iniciar sesión" } }`.
2. Cierra el socket.

**Qué tiene que hacer el cliente:** al recibir ese `chat:error`, refrescar el token (`POST /auth/refresh`, que ya existe) y reconectar con el nuevo en `auth.token`. Si se hace bien, el usuario no ve nada.

## Salas

| Sala | Quién está | Para qué |
|---|---|---|
| `usuario:<usuarioId>` | **Todos** los sockets del usuario, unidos apenas se autentican | Recibir mensajes de cualquier chat sin tenerlo abierto, y sincronizar dispositivos |
| `chat:<chatId>` | Sólo quien tiene esa conversación abierta, y sólo tras verificar que participa | Presencia y recibos de lectura |

## Eventos

### `chat:unirse` — cliente → server

Entrar a una conversación. **Responde por ack.**

```js
socket.emit('chat:unirse', { chatId: 8 }, (respuesta) => {
  if (respuesta.ok) { /* respuesta.datos === { chatId: 8 } */ }
  else { /* respuesta.error === { codigo, mensaje } */ }
});
```

El servidor **verifica que seas participante activo antes de unirte** — la misma comprobación que el REST, el mismo código. Un usuario no puede escuchar una sala en la que no participa.

| `codigo` posible | Cuándo |
|---|---|
| `SIN_ACCESO_AL_CHAT` | No sos participante activo |
| `VALIDACION` | `chatId` ausente o no numérico |

### `chat:salir` — cliente → server

```js
socket.emit('chat:salir', { chatId: 8 });
```

Llamalo al desmontar la pantalla. **No implica desconectarse**: seguís en línea y seguís recibiendo `chat:mensaje-nuevo` de todos tus chats por tu sala personal.

### `chat:mensaje-nuevo` — server → cliente

Llega un mensaje. **El payload es un objeto `Mensaje` idéntico al del historial** — mismo tipo, mismo mapper.

```js
socket.on('chat:mensaje-nuevo', (mensaje) => { /* ... */ });
```

**Quién lo recibe:** todos los participantes activos, tengan o no la conversación abierta, en todos sus dispositivos. Va a las salas **personales** justamente para que lo reciba también quien está mirando el listado: es lo que actualiza el badge y el preview de HU-5.1 en vivo.

**El emisor lo recibe también** — ver abajo.

### ⚠️ Doble entrega: deduplicá por `mensaje.id`

**Quien envía un mensaje lo recibe dos veces**: en la respuesta 201 del POST y en el broadcast. Es por diseño:

- El envío es REST, así que **el servidor no sabe qué socket lo originó** y no tiene a quién excluir.
- Un usuario puede tener varios dispositivos: excluir "al emisor" dejaría al resto sin el mensaje.

**El cliente deduplica por `mensaje.id` al insertar.** No es trabajo extra: hay que hacerlo igual al reconectar, donde el refetch del historial y los eventos encolados se superponen.

### `chat:leido` — server → sala del chat

Alguien leyó la conversación: **habilita el doble tilde pintado**.

```json
{ "chatId": 8, "usuarioId": 41, "hasta": "2026-09-01T14:05:00.000Z" }
```

Al recibirlo, marcá como leídos **tus propios mensajes de esa sala con `fechaAlta <= hasta`**.
`hasta` evita tener que asumir que la lectura alcanzó a toda la conversación: si llegó un
mensaje tuyo justo después, ése sigue sin leer.

Sólo llega a quien tiene la conversación abierta; el que no la tiene abierta ve el estado
correcto cuando entra.

### `chat:entregado` — server → sala del chat

A alguien **le llegaron** los mensajes, aunque no los haya abierto: es el **segundo tilde**.

```json
{ "chatId": 8, "usuarioId": 41, "hasta": "2026-09-01T14:05:00.000Z" }
```

Mismo payload y mismo tratamiento que `chat:leido`, un paso antes. Se emite cuando el otro
llama a `POST /chats/:chatId/entregados`, tenga o no la sala abierta; lo escucha sólo quien
está mirando la conversación, que es el único con burbujas que actualizar.

### `chat:no-leidos` — server → sala personal

```json
{ "chatId": 8, "noLeidos": 0 }
```

Para el listado de HU-5.1 en los **otros dispositivos** de quien leyó. El dispositivo que disparó el marcado ya tiene el dato en la respuesta HTTP.

### `chat:presencia` — server → sala del chat

```json
{ "chatId": 8, "usuarioId": 41, "enLinea": true }
```

Alimenta el subtítulo del header. El estado inicial sale de `GET /chats/:chatId`; este evento lo actualiza.

- `enLinea: true` cuando el contacto **entra a la conversación**.
- `enLinea: false` cuando cae **su último socket** (con el celular y la web abiertos, cerrar uno no lo desconecta).

### `chat:error` — server → cliente

Error **no solicitado**, o sea que no responde a ningún evento que hayas mandado. Hoy el único caso es el vencimiento del token.

```json
{ "error": { "codigo": "NO_AUTENTICADO", "mensaje": "Tu sesión expiró, volvé a iniciar sesión" } }
```

Misma forma que el error de REST: el cliente reusa su parser y muestra el `mensaje` tal cual.

## Errores por el socket

No hay códigos HTTP, así que:

- **Errores de un evento que mandaste** → por el **ack**, correlacionado con el pedido: `{ ok: false, error: { codigo, mensaje } }`.
- **Errores no solicitados** → por `chat:error`.
- **Errores de conexión** → `connect_error`.

En los tres casos el objeto `error` tiene **la misma forma que en REST**.

## Reconexión — responsabilidad compartida

**El servidor no encola nada.** Socket.io reconecta solo, pero los mensajes que llegaron mientras el socket estaba caído **no se reenvían**.

**Lo que tiene que hacer el cliente al reconectar:**

1. Volver a emitir `chat:unirse` de la conversación abierta (Socket.io **no** rejoinea salas solo).
2. **Refetchear el historial** desde el mensaje más nuevo que tenga en memoria.
3. Deduplicar por `id` al mezclar.

```js
socket.on('connect', () => {
  if (chatAbierto) {
    socket.emit('chat:unirse', { chatId: chatAbierto });
    refetchHistorial();
  }
});
```

La fuente de verdad es **la base**, no el socket: el tiempo real es una optimización de entrega. Por eso el envío funciona aunque el websocket esté caído.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **Enviar por REST y no por socket** | La respuesta 201 confirma la persistencia con el `id` y la `fecha` reales; con un ack de socket habría que reimplementar la semántica de error que HTTP ya tiene. La foto obliga: multipart no viaja por socket sin base64 (+33% y todo en memoria), y partir texto por un canal y foto por otro daría dos caminos y dos manejos de error para la misma acción. Reusa entero el pipeline existente (`autenticar`, Zod, multer, `sharp`, `errorHandler`). Y sobre todo: **si el socket está caído el mensaje se manda igual**; al revés, la funcionalidad se cae entera. Como efecto lateral, nada escribe por socket y la superficie de ataque se achica. |
| **El socket es solo de lectura (server → cliente)** | Sólo `chat:unirse` y `chat:salir` van del cliente al server, y no escriben nada: administran a qué sala pertenece el socket. |
| **Websockets en el MISMO proceso que el HTTP** | El diagrama de Etapa 6 lo muestra como componente propio, pero eso es una caja lógica: está desplegado en el mismo servicio de Render. Un proceso aparte exigiría un segundo servicio **y** un adapter de Redis para propagar eventos entre instancias — justamente el trabajo que hoy no hace falta. Compartiendo proceso se reusan la verificación de JWT y el pool de Prisma. `server.ts` ya guardaba el `http.Server` en una const, así que no hubo refactor. |
| **Socket.io y no websockets puros** | Decidido en Etapa 3 (factibilidad técnica): reconexión automática, fallback a long-polling y manejo de salas. No se rediscutió. |
| **`chat:mensaje-nuevo` va a las salas personales, no a la del chat** | Así lo recibe también quien está en el listado sin la conversación abierta, que es justo el que necesita actualizar el badge. Encadenar `.to()` hace que socket.io **deduplique**: un socket que está en varias de esas salas recibe el evento una sola vez. |
| **El emisor recibe su propio mensaje; el cliente deduplica por `id`** | El POST es REST: el server no tiene la identidad del socket que lo originó, y pasarla en el body acoplaría REST a la sesión de socket. Además el emisor puede tener otros dispositivos que sí lo necesitan. El cliente tiene que deduplicar igual al reconectar, así que no es trabajo extra. |
| **Paginación por cursor y no por offset** | Mientras el usuario scrollea hacia arriba entran mensajes nuevos; con offset la ventana se corre y se duplican o saltean filas. Página de 30, tope 50. Se pide una fila de más (`limite + 1`) para saber si hay página siguiente **sin una segunda query de conteo**. |
| **Historial en orden DESCENDENTE** | Es lo que consume una lista invertida, lo que devuelve el índice sin ordenar aparte, y lo que hace que el cursor signifique "seguir hacia atrás". Mismo desempate que el último mensaje del listado, así que la última línea de GUI-08 es la primera fila de la sala. |
| **El cursor se valida contra la sala** | Un `antesDe` de otro chat paginaría desde un punto arbitrario de éste. Se corta con `CURSOR_INVALIDO` antes de leer un solo mensaje. |
| **Sin `esMio` en el mensaje** | Viaja `usuarioId` y el cliente compara con su sesión. Es un dato, no una vista. |
| **Marcar leído al ABRIR la sala, con endpoint propio** | `mensaje_leido` es un booleano único por mensaje **sin dueño**: el estado más fino que el modelo puede representar es "la sala está leída". Marcar por mensaje renderizado serían decenas de requests para escribir un bit que se escribe con uno solo. |
| **`noLeidos: 0` viaja aunque sea constante** | Para que el cliente actualice el ítem del listado de HU-5.1 en memoria, sin refetch y sin hacer cuentas propias. `marcados` es el dato real de cuántos cambiaron. |
| **Se emite sólo si `marcados > 0`** | Reabrir una sala ya leída no tiene por qué despertar a los otros dispositivos. |
| **Imágenes a disco local, NO a R2** | Todo lo implementado (mascotas HU-6.1, publicaciones, historia clínica, seguimiento) usa `shared/storage.ts` con rutas relativas. R2 existe en el repo pero **sólo sabe subir fotos de perfil**, detrás del flag `R2_ENABLED`. Migrar bien implica tocar todos esos módulos a la vez: que el chat fuera el único módulo en R2 sería peor que cualquiera de las dos opciones puras. Ver "Pendientes". |
| **Texto y foto pueden ir juntos** | `mensaje_contenido` es NOT NULL y el contrato de HU-5.1 ya define `contenido: "" + tieneImagen: true` como "solo foto". El modelo ya soporta el pie de foto; prohibirlo sería una restricción inventada. Lo único que se rechaza es el mensaje sin nada. |
| **Validar antes de tocar el storage** | Si la imagen se guardara primero, cada envío rechazado dejaría un archivo huérfano. Y si falla la escritura en base **después** de guardarla, se borra por compensación — mismo patrón que el alta de mascota. |
| **Se puede leer un chat con alguien dado de baja, pero no escribirle** | Ocultar o bloquear la lectura destruiría el registro de un acuerdo sobre un animal, que es exactamente lo que la baja lógica del proyecto existe para preservar. Escribirle, en cambio, no tiene destinatario. |
| **403 y no 404 para un chat ajeno** | La sala existe, lo que falta es acceso. El id sale del propio listado del usuario, así que un 404 confundiría "chat de otro" con "chat borrado". |
| **Presencia en memoria, sin persistir** | La alternativa —una "última conexión" en `Usuario`— es una **columna nueva**, o sea un cambio de estructura, y esta HU no toca el modelo. El precio es que se pierde al reiniciar el proceso, lo cual es correcto: si el server se cayó, nadie está conectado. Es un `Set` de sockets y no un contador porque una desconexión sucia puede reportarse dos veces. |
| **El token vencido desconecta el socket** | Sin esto, el handshake se verifica una vez y nadie vuelve a mirar el `exp`: la conexión sobreviviría a la credencial, contradiciendo el esquema stateless con expiración (CONSTITUTION §4). |
| **Autorización por `UsuarioChat`, nunca por rol** | Igual que HU-5.1: quién puede leer una conversación lo define haber sido puesto en ella. Es **la misma función** en REST y en `chat:unirse` — la regla no puede divergir entre canales porque es una sola. |
| **El service no importa socket.io** | Emite a través de `websockets/emisor.ts`, que es no-op si no hay servidor registrado. Así el service se testea sin base, sin disco y sin levantar un socket, y la regla de capas del proyecto se mantiene. |
| **413 → 400 para archivo grande** | El middleware de upload es compartido con HU-6.1 y otros tres módulos. Devolver 413 sólo en chat rompería la consistencia de la API por un matiz semántico. |
| **No se escribe en `logAuditoria`** | Enviar un mensaje es una operación normal de usuario y **ya queda registrada de forma permanente** en `mensaje`, que es append-only por definición del modelo. |

### Índices — ninguno nuevo

**Esta HU no agrega migraciones.** Los índices de HU-5.1 ya la cubren, cosa que estaba anotada de antemano:

| Índice (de HU-5.1) | Qué sostiene ahora |
|---|---|
| `mensaje_chat_fecha_alta_idx` — `(chat_id, mensaje_fecha_alta DESC)` | El `WHERE chat_id = ? ORDER BY fecha_alta DESC LIMIT n` del historial paginado |
| `mensaje_chat_usuario_no_leido_idx` — `(chat_id, usuario_id) WHERE leido = false` | El `UPDATE ... WHERE chat_id = ? AND usuario_id != ? AND leido = false` del marcado |
| `usuario_chat_usuario_activo_idx` — `(usuario_id) WHERE fecha_baja IS NULL` | El guard de participación de cada endpoint |

Tampoco cambió `schema.prisma`: los campos de `Mensaje` (`contenido`, `leido`, `imagenUrl`, `chatId`, `usuarioId`, `fechaAlta`) ya existían todos.

---

## Pendiente para otros módulos

### HU-4.3 — Notificación de mensaje nuevo

El punto de enganche es **el mismo lugar donde hoy se emite `chat:mensaje-nuevo`**, en `chats.service.ts`. Ahí ya está calculada la lista de participantes activos, que es exactamente a quiénes hay que notificar. Son dos lugares: `enviarMensaje` y `asegurarChatDeSolicitud`, que también emite (la tarjeta de la solicitud es un mensaje más).

**El acuse de entrega le da a HU-4.3 un dato que antes no tenía:** con `usuario_chat_ultima_entrega` se puede saber si al destinatario ya le llegó el mensaje por socket, y por lo tanto si la push es redundante.

Lo que falta decidir:

1. **A quién**: a los participantes **menos el emisor**, y probablemente menos quien tenga la sala abierta (el registro de presencia y las salas de socket ya permiten saberlo).
2. **Push vs. fila `Notificacion`**: el modelo `Notificacion` ya existe en el schema y no se está usando desde acá.
3. **Agrupación**: 20 mensajes seguidos no son 20 notificaciones.

### Deuda del modelo: `leido` no soportaba chats grupales — ✅ resuelta

Lo que este documento anotaba como pendiente ya está: el estado vive en
`usuario_chat_ultima_lectura` / `usuario_chat_ultima_entrega`, una marca por participante, y
no en el booleano `mensaje_leido`. El marcado dejó de ser un `UPDATE` masivo sobre `mensaje`
y pasó a ser **una escritura por sala**, lo que además habilitó el acuse de entrega.

`mensaje_leido` sigue en la base y se sigue poblando para no romper lecturas viejas, pero
ninguna query lo consulta. **No usarlo en código nuevo.**

### Almacenamiento de imágenes en R2 — deuda transversal, no de esta HU

`ARQUITECTURA.md` especifica Cloudflare R2, pero **todo lo implementado usa disco local**: mascotas, publicaciones, historia clínica, seguimiento y ahora chat. R2 está en el repo (`shared/r2.ts`) pero sólo para fotos de perfil.

**En Render el disco es efímero**: cada deploy borra los archivos subidos. Es un problema de todo el proyecto, no del chat, y la migración tiene que ser un PR propio que toque todos los módulos a la vez. `shared/storage.ts` está pensado para que ese cambio quede contenido ahí.

### Presencia: dos limitaciones conocidas

1. **Una sola instancia.** El registro es un `Map` en memoria del proceso: al escalar horizontalmente cada instancia conocería sólo sus propios sockets. Hace falta el adapter de Redis de Socket.io, que es el mismo que haría falta para propagar los eventos.
2. **Puede quedar stale al salir de la sala.** La presencia se anuncia a las salas a las que el socket pertenece. Si el usuario cierra la conversación (`chat:salir`) y **después** se desconecta, el otro no recibe el `enLinea: false` y su header queda desactualizado hasta que reabra la pantalla. El arreglo barato es emitir también al salir; no se hizo porque cerrar la conversación **no es** estar fuera de línea y mentiría en el otro sentido.

Ninguna de las dos justifica hoy un cambio: no hay "última conexión" que quede mal persistida, sólo un subtítulo que puede envejecer.

### HU-5.3 — Búsqueda de conversaciones

Sin cambios respecto de lo anotado en `api-chats.md`: se puede resolver en el cliente filtrando por `contacto.nombre` sobre el listado, que no pagina.

### Creación de salas — ✅ implementada para solicitudes

Ver el detalle en `api-chats.md`. Resumen: al enviarse una solicitud se abre la sala con
todos sus participantes y con la tarjeta del pedido adentro. Las cinco condiciones que se
anotaban se cumplieron, incluida la fila de `UsuarioChat` para cada miembro del refugio —
sin ella la sala no aparecería en GUI-31 ni dejaría entrar por REST ni por socket, porque
**todo este módulo autoriza contra `UsuarioChat`**.

**Falta la sala de HU-13.2** (mascota perdida/encontrada), que no nace de una solicitud.

### Auditoría de `Mensaje`

`MODELO_DATOS.md` es explícito y esta HU lo respeta: el mensaje **solo tiene alta**. No hay endpoint de edición ni de borrado, y `Mensaje` no tiene `fechaBaja` ni campos de modificación. **No agregar "eliminar mensaje" sin volver a discutir el modelo con el equipo.**
