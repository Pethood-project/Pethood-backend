# Contrato de API — Chat (listado de conversaciones)

Endpoint de **HU-5.1 (Acceso y visualización del listado de conversaciones activas)**, listo para consumir desde `pethood-frontend`. Está implementado y testeado.

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md`.

Las pantallas que lo consumen son **GUI-08 (Chat Adoptante)** y **GUI-31 (Chat Refugio)**. Abrir una conversación y enviar mensajes es **HU-5.2**, que está implementada y documentada aparte en [`api-chat-sala.md`](./api-chat-sala.md). Buscar por nombre de contacto es **HU-5.3** y crear la sala es de la HU de creación — ninguna de las dos está implementada. Ver "Pendiente para otros módulos".

**Alcance de esta HU:** solo el `GET` del listado. El endpoint es de **solo lectura**: no marca nada como leído, no crea salas y no escribe una sola fila.

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1` — en mobile la variable ya existe en `apps/mobile/.env`.

**Autenticación:** obligatoria.

```
Authorization: Bearer <token>
```

**Formato de error** — siempre el mismo, en cualquier código de estado:

```json
{ "error": { "codigo": "NO_AUTENTICADO", "mensaje": "Falta el token de autenticación" } }
```

El campo `mensaje` viene en español con voseo rioplatense y **se puede mostrar tal cual en el toast**, sin reescribirlo en el cliente.

**Imágenes:** `imagenUrl` es una ruta relativa (`/api/v1/archivos/usuarios/xxx.jpg`). Hay que anteponerle el host del backend para renderizarla. Puede venir `null`: el contacto no tiene foto y va el avatar por defecto.

**Fechas:** ISO 8601 crudo (`2026-09-01T14:05:00.000Z`). **El "Hace 5 min" lo formatea el cliente**, igual que la edad de mascota en HU-6.6. Un texto relativo calculado en el servidor queda stale apenas el cliente lo cachea.

---

## `GET /api/v1/chats` — Listar conversaciones (HU-5.1)

Sin query params y sin body. Devuelve la lista completa: **no pagina** (ver "Decisiones").

### Headers

```
Authorization: Bearer <token>
```

### Respuesta 200

```json
{
  "total": 3,
  "chats": [
    {
      "chatId": 8,
      "contacto": {
        "tipo": "REFUGIO",
        "id": 3,
        "nombre": "Refugio Patitas",
        "imagenUrl": "/api/v1/archivos/refugios/patitas.jpg",
        "activo": true
      },
      "ultimoMensaje": {
        "contenido": "Dale, te espero el sábado a las 10",
        "fecha": "2026-09-01T14:05:00.000Z",
        "esMio": false,
        "tieneImagen": false
      },
      "noLeidos": 3,
      "fechaUltimaActividad": "2026-09-01T14:05:00.000Z"
    },
    {
      "chatId": 12,
      "contacto": {
        "tipo": "USUARIO",
        "id": 41,
        "nombre": "Ana Pérez",
        "imagenUrl": "/api/v1/archivos/usuarios/ana.jpg",
        "activo": false
      },
      "ultimoMensaje": {
        "contenido": "",
        "fecha": "2026-08-30T18:20:00.000Z",
        "esMio": true,
        "tieneImagen": true
      },
      "noLeidos": 0,
      "fechaUltimaActividad": "2026-08-30T18:20:00.000Z"
    },
    {
      "chatId": 15,
      "contacto": {
        "tipo": "REFUGIO",
        "id": 9,
        "nombre": "Huellitas del Sur",
        "imagenUrl": null,
        "activo": true
      },
      "ultimoMensaje": null,
      "noLeidos": 0,
      "fechaUltimaActividad": "2026-08-25T12:00:00.000Z"
    }
  ]
}
```

### Campos

| Campo | Qué es |
|---|---|
| `total` | Cantidad de conversaciones. Alimenta el badge de la pestaña Chat |
| `chatId` | **Id del chat.** Es el que va en la navegación al detalle (HU-5.2) y el identificador estable del ítem |
| `contacto` | El otro lado, **ya resuelto por el backend** (ver abajo) |
| `ultimoMensaje` | Vista previa, o `null` si la sala todavía no tiene mensajes |
| `ultimoMensaje.contenido` | **Sin truncar.** El recorte visual es del cliente |
| `ultimoMensaje.fecha` | ISO 8601 crudo |
| `ultimoMensaje.esMio` | `true` si lo mandó el usuario autenticado → prefijo "Vos: ..." |
| `ultimoMensaje.tieneImagen` | `true` si el mensaje trae foto. Con `contenido: ""` significa mensaje de solo imagen → mostrar "📷 Foto" |
| `noLeidos` | Mensajes **del otro** que el usuario todavía no leyó. Número absoluto, no un delta |
| `fechaUltimaActividad` | **Clave de orden, nunca `null`.** Fecha del último mensaje o, si la sala está vacía, fecha de creación del chat |

### El contacto viene resuelto

**El cliente no tiene que averiguar cuál de los dos participantes es "el otro", ni si es una persona o un refugio.** Recibe nombre e imagen listos para pintar la fila.

| Campo | Qué es |
|---|---|
| `tipo` | `"USUARIO"` o `"REFUGIO"` |
| `id` | Id del Usuario o del Refugio según `tipo`. **No es el `chatId`** |
| `nombre` | `"Nombre Apellido"` si es un usuario; la razón social si es un refugio |
| `imagenUrl` | `Usuario.imagenUrl` o `Refugio.imagenUrl` según corresponda. Puede ser `null` |
| `activo` | `false` si la cuenta del contacto está dada de baja |

`tipo` **es un campo derivado por el backend, NO es `chat_tipo`** — esa columna no se lee (ver "Decisiones").

La regla es simétrica: en un chat con refugio, **el adoptante ve al refugio y el miembro del refugio ve al adoptante**. Un miembro de *otro* refugio (caso que hoy no se da) vería al refugio de la sala.

### Garantías del listado

- **Orden:** por `fechaUltimaActividad` descendente (lo más reciente primero).
- **Solo chats donde el usuario es participante activo** (`UsuarioChat.fechaBaja IS NULL`). Si lo sacaron de la sala, no la ve más.
- **Excluye chats dados de baja** (`Chat.fechaBaja IS NULL`).
- **Las salas sin mensajes aparecen**, con `ultimoMensaje: null`, ordenadas por su fecha de creación.
- **Un contacto dado de baja no oculta el chat**: viene con `activo: false` y su nombre real.
- `total` **siempre coincide con `chats.length`**: sale de la misma lista ya filtrada, así el badge no puede discrepar del listado.

### Errores

Solo los de autenticación. **Un usuario sin conversaciones recibe `200` con `{ "total": 0, "chats": [] }`** — el empty state es un estado normal de la pantalla, no un error.

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token de autenticación | No se mandó el header |
| 401 | `NO_AUTENTICADO` | Token inválido o expirado | Token vencido o corrupto |

No hay `400` (no recibe entrada que validar), ni `404` (un usuario sin chats es lista vacía, no "no encontrado"), ni `403` (no hay restricción por rol: cualquier usuario autenticado ve *sus* conversaciones, y quién participa de cada sala lo define `UsuarioChat`, no el rol). Los otros verbos sobre `/chats` devuelven el `404` genérico de Express hasta que se implementen sus HUs.

---

## Notas para la pantalla de chat (GUI-08 / GUI-31)

1. **El badge de la pestaña sale de `total`**, y el de cada fila de `noLeidos`.
2. **El "Hace 5 min" se calcula en el cliente** a partir de `fechaUltimaActividad`. No lo cachees ya formateado.
3. **Preview vacío:** si `ultimoMensaje` es `null`, la sala se abrió pero nadie escribió todavía — poné tu propio placeholder ("Todavía no hay mensajes"). El backend no manda ese texto a propósito.
4. **Mensaje de solo foto:** `contenido: ""` con `tieneImagen: true` → mostrar "📷 Foto" en vez de una línea en blanco.
5. **Contacto inactivo:** `activo: false` significa que la cuenta del otro se dio de baja. Grisá la fila o mostrá una leyenda; la conversación **se sigue pudiendo leer**. Bloquear el envío es tarea de HU-5.2.
6. **Estados de la pantalla:** cargando / vacío / error. El vacío es `total: 0`, no un error.
7. **Refrescar al entrar a la pantalla alcanza.** Esta HU no tiene tiempo real y ninguno de sus criterios de aceptación lo pide.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **`Chat.refugioId` NO reemplaza a `UsuarioChat`, lo complementa** | `UsuarioChat` es la única tabla de pertenencia: toda persona con acceso a la sala tiene fila, incluido el miembro del refugio que atiende. `refugioId` es una **etiqueta institucional** que dice quién es la contraparte. Tiene que ser así porque `Mensaje.usuarioId` es NOT NULL contra `Usuario` (un refugio no emite mensajes, los emite una persona) y porque la autorización de este listado *es* `UsuarioChat`: si un chat con refugio tuviera una sola fila, ningún usuario de refugio vería su propia lista, y GUI-31 existe. Además sobrevive la rotación de personal: si quien atendió se va, el adoptante sigue viendo el nombre del refugio y no el de un desconocido. **Interpretación acordada con el equipo — no estaba definida en `MODELO_DATOS.md`.** |
| **El contacto se resuelve en el backend** | El cliente no debería saber que existen dos tablas distintas de contraparte ni comparar ids para descubrir cuál participante es "el otro". Recibe `{ tipo, id, nombre, imagenUrl, activo }` y pinta. |
| **`chat_tipo` se ignora por completo** | `MODELO_DATOS.md` dice literalmente "confirmar con el equipo el enum exacto" y **no hay valores definidos en ningún documento**. No se inventaron: los dos casos que `tipo` querría distinguir (adoptante↔refugio vs. coordinación por mascota perdida) ya son derivables de `refugioId != null`, que sí está definido. Exponer una columna de texto libre sin validar solo lograría que el cliente ramifique sobre valores que nadie acordó. |
| **Fechas en ISO 8601 crudo** | Igual que la edad de mascota en HU-6.6. Un "Hace 5 min" calculado en el servidor queda stale apenas el cliente lo cachea, y además el formato relativo es una decisión de UI. |
| **`contenido` sin truncar** | El recorte depende del ancho de pantalla y de la tipografía: es responsabilidad visual del cliente. |
| **Los chats sin mensajes SÍ aparecen** | Una sala se crea por un acto explícito (CONSTITUTION §7: tras una solicitud aceptada o un reporte de mascota perdida), así que una sala vacía no es ruido: significa "ya podés hablar con este refugio". Ocultarla haría la función indescubrible — el adoptante tendría que escribir primero en una pantalla que no muestra la sala. Además **HU-13.2 abre el chat de reencuentro sin ningún mensaje**: si las salas vacías se ocultaran, ese flujo quedaría roto. |
| **`ultimoMensaje: null` y no un texto de relleno** | "Conversación iniciada" sería copy de UI viviendo en la API, exactamente lo que evita la regla de la fecha ISO. El backend manda el hecho, el cliente pone el texto y lo traduce. |
| **`fechaUltimaActividad` viaja aparte** | Es la clave de orden y **nunca es `null`**: fecha del último mensaje, o la de creación del chat si la sala está vacía. Así el cliente reordena sin ramificar por el caso vacío. Una sala recién creada aparece arriba, que es correcto: es lo último que pasó. |
| **Un contacto dado de baja NO oculta el chat** | Ocultarlo destruiría historial que el usuario puede necesitar: la conversación es el registro de un acuerdo sobre un animal. La regla 1 del proyecto (baja lógica, nunca DELETE) existe justamente para que el historial sobreviva; esconder el chat sería un delete de hecho. Tampoco se manda un "Usuario eliminado" armado en el server: va `activo: false` y el cliente decide el placeholder. No es fuga de privacidad — el usuario ya vio ese nombre y esos mensajes, es su propia conversación. |
| **Un chat sin ningún participante activo se omite** | Sin contraparte no hay nombre ni avatar: la fila no se puede pintar. Es un dato inconsistente, no un caso de negocio — se saca del listado en vez de romper la pantalla entera, y `total` la descuenta. Mismo criterio que "una mascota sin estado vigente se omite" en HU-6.6. |
| **`noLeidos` = mensajes del otro con `leido = false`** | `mensaje_leido` es un booleano **único por mensaje**, no por participante. En una sala de dos alcanza: el único que puede leer un mensaje es el que no lo mandó. Los propios se excluyen siempre, o el badge contaría los mensajes salientes del usuario. **Ojo: esto no escala a chats grupales** — ver "Pendientes". |
| **El endpoint no marca nada como leído** | Marcar como leído pasa al **abrir** la conversación (HU-5.2), no al listarla. Que el listado escribiera dejaría el badge en cero apenas se entra a la pestaña. |
| **`esMio` y `tieneImagen`** | `esMio` habilita el prefijo "Vos: ..." sin que el cliente compare ids, y sale gratis. `tieneImagen` es necesario porque un mensaje puede ser **solo foto**: sin el flag el preview quedaría en blanco. |
| **Ruta `/chats`, no `/conversaciones`** | Recurso en plural con el nombre de la entidad de `MODELO_DATOS.md`, igual que `/mascotas`, `/publicaciones` y `/favoritos`. |
| **Sin middleware de roles** | Cualquier usuario autenticado ve *sus* conversaciones. Quién participa de cada sala lo define `UsuarioChat`, no el rol: un filtro por rol acá sería redundante y bloquearía GUI-31. |
| **No se escribe en `logAuditoria`** | Es una lectura, no una operación crítica. |

### Rendimiento — cómo se evita el N+1

Traer el último mensaje y el conteo de no leídos **chat por chat** sería un N+1 clásico sobre una tabla sin cota. En vez de eso se hacen **cuatro queries de tamaño fijo, en dos tandas paralelas**, y el cruce se resuelve en memoria con `Map`s por `chatId`. **La cantidad de queries no depende de cuántos chats tenga el usuario.**

| # | Query | Qué trae |
|---|---|---|
| 1 | `usuarioChat.findMany` | Mis salas activas + refugio + el otro participante |
| 2 | `usuario.findUnique` | Mi `refugioId`, para saber de qué lado del mostrador estoy |
| 3 | `$queryRaw` con `DISTINCT ON` | El último mensaje de **todos** los chats, en una sola query |
| 4 | `mensaje.groupBy` | Los conteos de no leídos de **todos** los chats, en una sola query |

Las 1 y 2 van en paralelo; si no hay chats, **el service corta ahí** y las 3 y 4 no se ejecutan.

**Por qué `$queryRaw` acá** (es el único del proyecto): Prisma no sabe hacer *greatest-n-per-group*, y las alternativas (un `groupBy` con `_max` más una segunda query con un OR de pares chat/fecha) son más frágiles ante empates de timestamp. `DISTINCT ON` es la forma natural en Postgres y cae directo sobre el índice nuevo. Va parametrizado con `Prisma.sql`/`Prisma.join`, **nunca interpolando ids en el string**, y vive en el `repository.ts`, que es la única capa que toca Prisma — el service se sigue testeando mockeando el repository. El precedente contrario del repo (`dashboard-admin`: "el bucketing por mes se hace en el service, volumen chico, no justifica `$queryRaw`") justifica no usar raw cuando el volumen es chico; acá el punto es justamente una tabla sin cota.

El **orden se resuelve en memoria** y no en SQL porque la clave es un *coalesce* entre dos queries distintas. Está acotado por la cantidad de chats de una persona (decenas): es gratis.

### Índices agregados

Migración `20260901120000_chat_indices_listado_conversaciones`. **Solo índices — ninguna estructura de tabla cambió.** Van como SQL a mano porque Prisma no sabe expresar índices parciales, igual que los de `favorito`.

| Índice | Definición | Para qué |
|---|---|---|
| `mensaje_chat_fecha_alta_idx` | `(chat_id, mensaje_fecha_alta DESC)` | El `DISTINCT ON` del último mensaje y el orden. **No es parcial**: `mensaje` no tiene `fecha_baja` (excepción de auditoría), no hay bajas que descartar. Lo reusa el historial paginado de HU-5.2, que por eso no necesitó índices propios |
| `mensaje_chat_usuario_no_leido_idx` | `(chat_id, usuario_id) WHERE mensaje_leido = false` | El conteo de no leídos. Parcial porque las filas no leídas son una minoría que **se achica sola**: todo mensaje termina leído. El índice queda del tamaño de la cola pendiente y no crece con el volumen histórico |
| `usuario_chat_usuario_activo_idx` | `(usuario_id) WHERE usuario_chat_fecha_baja IS NULL` | Punto de entrada del listado. El índice que ya existía arranca por `chat_id` y **no sirve** para buscar por usuario |

`chat` no necesitó índices: se llega por PK desde las filas de `usuario_chat`.

El `EXPLAIN` sobre la base local confirma que `mensaje_chat_fecha_alta_idx` es el camino de acceso del `DISTINCT ON`. La base de desarrollo está vacía, así que el plan todavía resuelve el orden con un `Sort` posterior; con volumen real el planner usa el recorrido ordenado del índice. El desempate por `mensaje_id DESC` está para que dos mensajes con la misma marca de tiempo al milisegundo no devuelvan una fila distinta en cada corrida.

### Desnormalizar el último mensaje — evaluado y descartado

Guardar `chat_ultimo_mensaje_fecha`/`contenido` en `Chat` convertiría el listado en una sola query indexada y haría el `ORDER BY` sargable. Se descartó porque: es un **cambio de estructura** y no un índice; agrega una segunda escritura al camino caliente de HU-5.2, que necesitaría transacción o deriva; **la deriva se ve como un preview equivocado**, o sea es visible para el usuario; y con los índices de arriba el `DISTINCT ON` rinde muy por encima de la escala del proyecto. Revisitable solo si un usuario llegara a tener cientos de chats activos.

### Paginación — evaluada y descartada

`total` siempre es igual a `chats.length`, igual que en Favoritos. Motivos:

- Lo que crece sin cota son los **mensajes** —y ahí sí HU-5.2 va a paginar—, no las conversaciones. Éstas están acotadas por CONSTITUTION §7: solo hay chat tras una solicitud aceptada o un reclamo de mascota perdida.
- **HU-5.3 (buscar por nombre de contacto) filtra sobre esta misma lista.** Si el cliente filtra en memoria, paginar le rompe la búsqueda.
- Se descartó también un `LIMIT` defensivo: un tope silencioso es peor que ninguno, porque el cliente perdería conversaciones sin enterarse y HU-5.3 dejaría de encontrar contactos. Si algún día hace falta, va **paginación real con cursor sobre `fechaUltimaActividad`**, y `total` sigue siendo el total real y no el de la página — por eso viaja como campo aparte desde ahora.

---

## Pendiente para otros módulos

### HU-5.2 — Envío y recepción de mensajes — ✅ implementada

Ver [`api-chat-sala.md`](./api-chat-sala.md) para el contrato completo (historial paginado, envío, marcado de leídos, cabecera de la sala y todos los eventos de websocket).

**Qué le dejó preparado este listado, y se usó tal cual:** la forma de cada ítem es autocontenida (contacto ya resuelto, sin lookups del cliente), `chatId` es un identificador estable y `noLeidos` es un número absoluto y no un delta. Eso permitió que el evento de mensaje nuevo actualice el listado **sin refetch**.

**Lo que cambió respecto de lo que este documento anticipaba** — vale la pena registrarlo porque el diseño real difiere en tres puntos:

| Se anticipaba | Quedó | Por qué |
|---|---|---|
| `chat:mensaje-nuevo` con un `ConversacionDto` (ítem del listado) | Con un `MensajeDto` (el mensaje en sí) | El evento tiene que servir a las **dos** pantallas. La sala necesita el mensaje; el listado deriva el preview de ese mensaje, que ya trae `contenido`, `imagenUrl`, `usuarioId` y `fechaAlta`. Al revés no funcionaba: un `ConversacionDto` no alcanza para pintar una burbuja porque no tiene el `id` del mensaje |
| `chat:leido` como cliente → server | Marcar leídos es un **POST REST**; `chat:leido` quedó como server → sala | Escribir por socket habría duplicado validación y manejo de errores. El socket terminó siendo **solo de lectura** |
| `chat:leido-confirmado` | `chat:no-leidos` | Mismo payload y mismo propósito; el nombre describe el dato y no el hecho de confirmar algo |

Los cinco puntos que este documento marcaba como pendientes se resolvieron: autorización por `UsuarioChat` (misma función en REST y en socket), bloqueo de envío con `contacto.activo: false` (409 `CONTACTO_INACTIVO`), marcado de leídos sólo al abrir, historial paginado por cursor sobre `mensaje_chat_fecha_alta_idx`, y el punto de enganche para HU-4.3 identificado. **HU-5.2 no necesitó ninguna migración ni tocó `schema.prisma`.**

### HU-5.3 — Búsqueda de conversaciones por nombre de contacto

Se puede resolver **en el cliente** filtrando por `contacto.nombre` sobre la lista que ya tiene, justamente porque este endpoint no pagina y devuelve el nombre ya resuelto. Si más adelante se hace en el servidor, va como query param opcional (`?contacto=`) con su schema Zod en `chats.dto.ts`, y **`total` tiene que seguir siendo el total de coincidencias**.

### HU de creación de salas

No está implementada. Cuando se haga:

1. **CONSTITUTION §7 es la regla que la gobierna:** "chat habilitado solo tras interacción previa (solicitud de adopción o reporte de mascota perdida)". El servicio tiene que verificar esa interacción antes de crear la sala.
2. **Crear la fila de `UsuarioChat` para TODOS los participantes**, incluido el miembro del refugio — si no, el refugio no ve la conversación en GUI-31.
3. **Setear `Chat.refugioId`** cuando la contraparte sea un refugio, y dejarlo en `null` para la coordinación entre adoptantes de HU-13.2. De eso depende qué nombre e imagen muestra este listado.
4. **Evitar salas duplicadas** para el mismo par. Conviene un índice único parcial sobre los participantes activos, como el de `favorito` — dos requests concurrentes pasarían los dos por cualquier chequeo de lectura previo.
5. **`chat_tipo` sigue sin definirse.** Si el equipo confirma el enum, se convierte en un `enum` de Prisma y se documenta acá; mientras tanto no escribirlo.

### Deuda del modelo: `leido` no soporta chats grupales

`mensaje_leido` es un booleano único por mensaje. Funciona para una sala de dos, pero **si `chat_tipo` llegara a admitir salas de 3 o más, el contador queda mal para todos**: un solo flag no puede expresar "leído por A pero no por B", y el primero que abra la sala le baja el badge al resto.

La solución más barata sería una columna `usuario_chat_ultima_lectura` (timestamp) en `UsuarioChat`: los no leídos pasarían a ser los mensajes con `fecha_alta > ultima_lectura` y `usuario_id != yo`. Tiene dos ventajas extra: es **una sola escritura por sala abierta** en vez de un `UPDATE` masivo sobre `mensaje`, y encaja mejor con el evento `chat:leido` de websockets.

**Es un cambio de estructura, así que quedó fuera de esta HU y también de HU-5.2**, que ya llegó y siguió el mismo criterio: su endpoint de marcado escribe **toda la sala de una**, lo cual es correcto para dos participantes y rompe con tres o más. Hay que decidirlo antes de implementar chats grupales.

### Auditoría de `Mensaje`

`MODELO_DATOS.md` es explícito: el mensaje **solo tiene alta**, no baja ni modificación, y **no se implementa endpoint de borrado de mensaje individual**. El schema de Prisma ya lo refleja (`Mensaje` no tiene `fechaBaja`). Vale para HU-5.2: no agregar "eliminar mensaje" sin volver a discutir el modelo con el equipo.
