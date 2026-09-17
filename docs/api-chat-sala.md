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
  "usuarioId": 41,
  "leido": false,
  "fechaAlta": "2026-09-01T14:05:00.000Z"
}
```

| Campo | Qué es |
|---|---|
| `id` | Id del mensaje. **Es la clave de deduplicación** (ver "Doble entrega") y el cursor de paginación |
| `chatId` | Redundante dentro del historial, imprescindible en el evento de socket |
| `contenido` | Texto, **sin truncar**. Cadena vacía (`""`) en un mensaje de solo foto |
| `imagenUrl` | Ruta relativa, o `null` si el mensaje es solo texto |
| `usuarioId` | **Id del emisor.** El cliente lo compara con su sesión para decidir el lado de la burbuja |
| `leido` | `true` si el otro ya lo leyó → doble check |
| `fechaAlta` | ISO 8601 crudo |

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
  "enLinea": true
}
```

`contacto` es **exactamente el mismo objeto** que el del listado (HU-5.1) y lo resuelve el mismo código: mismos campos, misma regla adoptante↔refugio, mismo significado de `activo`.

| Campo | Qué es |
|---|---|
| `enLinea` | Snapshot de presencia al momento del pedido. **A partir de ahí lo actualiza `chat:presencia`** |

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

**`multipart/form-data`** (texto y/o foto):

| Campo | Tipo | Obligatorio |
|---|---|---|
| `contenido` | texto, ≤1000 caracteres | Solo si no hay `foto` |
| `foto` | jpg/png/webp, ≤5 MB | Solo si no hay `contenido` |

**`application/json`** (solo texto):

```json
{ "contenido": "Dale, te espero el sábado a las 10" }
```

**Texto y foto pueden ir juntos** — el pie de foto es un mensaje válido. Lo que no se acepta es un mensaje sin ninguno de los dos.

La foto se comprime en el servidor (`sharp`, ancho máx. 1600px) antes de persistirse, igual que en el alta de mascota.

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
| 400 | `ARCHIVO_INVALIDO` | La imagen debe ser jpg, png o webp | Formato no admitido |
| 400 | `ARCHIVO_DEMASIADO_GRANDE` | La imagen supera el máximo de 5MB | Archivo pesado |
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

Alguien leyó la conversación: **habilita el doble check**.

```json
{ "chatId": 8, "usuarioId": 41 }
```

Al recibirlo, marcá como `leido: true` **todos tus propios mensajes de esa sala**. Es correcto porque marcar leído es una operación de sala entera, no de mensaje.

Sólo llega a quien tiene la conversación abierta; el que no la tiene abierta ve el estado correcto cuando entra.

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

El punto de enganche es **el mismo lugar donde hoy se emite `chat:mensaje-nuevo`**, en `chats.service.ts`. Ahí ya está calculada la lista de participantes activos, que es exactamente a quiénes hay que notificar.

Lo que falta decidir:

1. **A quién**: a los participantes **menos el emisor**, y probablemente menos quien tenga la sala abierta (el registro de presencia y las salas de socket ya permiten saberlo).
2. **Push vs. fila `Notificacion`**: el modelo `Notificacion` ya existe en el schema y no se está usando desde acá.
3. **Agrupación**: 20 mensajes seguidos no son 20 notificaciones.

### Deuda del modelo: `leido` no soporta chats grupales

Sigue vigente lo anotado en HU-5.1, y ahora con código que lo asume: `marcarMensajesLeidos` marca **toda la sala de una**, lo cual es correcto para dos participantes y **rompe con tres o más** — el primero que abra la sala le baja el badge al resto.

La solución más barata sigue siendo una columna `usuario_chat_ultima_lectura` (timestamp) en `UsuarioChat`: los no leídos pasarían a ser los mensajes con `fecha_alta > ultima_lectura` y `usuario_id != yo`. Encaja mejor con el evento de lectura y es una sola escritura por sala abierta.

**Es un cambio de estructura, así que quedó fuera de esta HU.** Hay que decidirlo antes de implementar chats grupales.

### Almacenamiento de imágenes en R2 — deuda transversal, no de esta HU

`ARQUITECTURA.md` especifica Cloudflare R2, pero **todo lo implementado usa disco local**: mascotas, publicaciones, historia clínica, seguimiento y ahora chat. R2 está en el repo (`shared/r2.ts`) pero sólo para fotos de perfil.

**En Render el disco es efímero**: cada deploy borra los archivos subidos. Es un problema de todo el proyecto, no del chat, y la migración tiene que ser un PR propio que toque todos los módulos a la vez. `shared/storage.ts` está pensado para que ese cambio quede contenido ahí.

### Presencia: dos limitaciones conocidas

1. **Una sola instancia.** El registro es un `Map` en memoria del proceso: al escalar horizontalmente cada instancia conocería sólo sus propios sockets. Hace falta el adapter de Redis de Socket.io, que es el mismo que haría falta para propagar los eventos.
2. **Puede quedar stale al salir de la sala.** La presencia se anuncia a las salas a las que el socket pertenece. Si el usuario cierra la conversación (`chat:salir`) y **después** se desconecta, el otro no recibe el `enLinea: false` y su header queda desactualizado hasta que reabra la pantalla. El arreglo barato es emitir también al salir; no se hizo porque cerrar la conversación **no es** estar fuera de línea y mentiría en el otro sentido.

Ninguna de las dos justifica hoy un cambio: no hay "última conexión" que quede mal persistida, sólo un subtítulo que puede envejecer.

### HU-5.3 — Búsqueda de conversaciones

Sin cambios respecto de lo anotado en `api-chats.md`: se puede resolver en el cliente filtrando por `contacto.nombre` sobre el listado, que no pagina.

### Creación de salas

Sigue sin implementarse, con las mismas cinco condiciones anotadas en `api-chats.md` (CONSTITUTION §7, fila de `UsuarioChat` para **todos** los participantes, `Chat.refugioId`, índice único parcial contra duplicados, y `chat_tipo` sin definir).

Ahora hay una razón más para que estén bien: **esta HU autoriza todo contra `UsuarioChat`**. Una sala creada sin la fila del miembro del refugio no sólo no aparecería en GUI-31 — tampoco dejaría entrar a la conversación ni por REST ni por socket.

### Auditoría de `Mensaje`

`MODELO_DATOS.md` es explícito y esta HU lo respeta: el mensaje **solo tiene alta**. No hay endpoint de edición ni de borrado, y `Mensaje` no tiene `fechaBaja` ni campos de modificación. **No agregar "eliminar mensaje" sin volver a discutir el modelo con el equipo.**
