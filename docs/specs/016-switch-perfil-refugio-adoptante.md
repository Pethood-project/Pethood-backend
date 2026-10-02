# Spec 016 — Switch de perfil refugio / adoptante

**Estado:** EN REVISIÓN
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-24

## 1. Objetivo

Cada persona tiene **una sola cuenta** (no hay multicuentas). Quien pertenece a un refugio la
usa con dos perfiles estrictamente separados: el del **refugio**, para gestionar lo del
refugio, y el **personal**, para usar PetHood como cualquier adoptante: tener sus propias
mascotas, publicarlas, adoptar y guardar favoritos. El switch de Perfil elige cuál de los dos
está activo.

## 2. Alcance

- **Incluye:** mascotas, historia clínica, publicaciones (feed y alta), favoritos,
  solicitudes (enviadas, recibidas, detalle y resolución), seguimiento post-adopción, chats,
  contador de mascotas de Mi Perfil y dashboard de refugio.
- **NO incluye:** campañas, padrinazgos y mascotas perdidas (spec 007, todavía sin
  implementar). Cuando se implementen, tienen que respetar la misma separación: ver §6.
- **NO cambia:** el modelo de datos. No hay columnas nuevas: a qué perfil pertenece cada cosa
  se deduce de lo que ya existe (`Mascota.refugioId`, `Chat.refugioId`).

## 3. Entidades involucradas

Ninguna nueva. La pertenencia se resuelve así:

| Entidad | Perfil REFUGIO | Perfil PERSONAL |
|---|---|---|
| Mascota | `refugioId` = el refugio del usuario (la cargue quien la cargue) | `refugioId` nulo y `usuarioId` = el usuario |
| Publicación, historia clínica | la de una mascota del refugio | la de una mascota personal |
| Solicitud recibida | sobre una mascota del refugio | sobre una mascota personal |
| Solicitud enviada, favorito | — (el refugio no adopta) | las del usuario |
| Seguimiento | como publicador, de mascotas del refugio | como adoptante, o como publicador de mascotas personales |
| Chat | `Chat.refugioId` = el refugio del usuario | todos los demás (con otros refugios o entre personas) |

## 4. API (contrato backend)

**Cabecera `X-Ambito: PERSONAL | REFUGIO`** en todos los pedidos autenticados. La resuelve
`autenticar` en `req.ambito` (`src/shared/ambito.ts`); ningún endpoint recibe el ámbito por
query ni por body (se quitaron los `?ambito=` y `{ ambito }` que había en mascotas,
publicaciones, favoritos y solicitudes).

- Sin cabecera: un miembro de refugio queda en `REFUGIO` y cualquier otro usuario en
  `PERSONAL`. Así el panel web (que solo trabaja como refugio) no necesita mandarla.
- `REFUGIO` sin pertenecer a un refugio → `403 SIN_REFUGIO`.
- Valor desconocido → `400 VALIDACION` «El ámbito no es válido».

Rutas que solo existen en un perfil (`403 AMBITO_NO_PERMITIDO`):

| Ruta | Solo desde |
|---|---|
| `GET /publicaciones` (feed de adopción) | PERSONAL |
| `GET/POST/DELETE /favoritos` | PERSONAL |
| `POST /solicitudes`, `GET /solicitudes/mias`, `GET /solicitudes/elegibilidad` | PERSONAL |
| `GET /refugio/dashboard`, `GET /refugio/dashboard/exportar/:entidad` | REFUGIO |
| `/chats/:chatId`, `/chats/:chatId/mensajes`, `/chats/:chatId/leidos` | el perfil al que pertenece el chat |

Rutas que existen en los dos perfiles pero devuelven solo lo del perfil activo:
`GET /mascotas/mias`, `GET /mascotas/publicables`, `GET/PATCH/DELETE /mascotas/:id`, `POST /mascotas` (el `actor` sale del
ámbito, no del rol), historia clínica, `POST /publicaciones`, `GET /publicaciones/mias`,
`GET /publicaciones/:id`,
`GET /solicitudes/recibidas`, `GET /solicitudes/:id`, `PATCH /solicitudes/:id/estado`,
`/seguimientos*`, `GET /chats`, `GET/PATCH /usuarios/me` (campo `mascotas`).

Algo del otro perfil responde como si no existiera (`404`), salvo en chats, donde la sala sí
existe para el usuario y se responde `403 AMBITO_NO_PERMITIDO` («Esta conversación es de tu
otro perfil. Cambiá de vista para abrirla»).

`POST /chats/:chatId/entregados` no lleva el guard: el acuse de recibo es del dispositivo, no
del perfil que se está mirando.

## 5. Pantallas (frontend)

- **Perfil:** el switch «Vista de refugio» (solo para miembros de refugio). Al cambiarlo se
  vuelve a Inicio. Menú, contadores y chip de rol siguen al perfil activo: en la vista de
  refugio no hay «Mis solicitudes» ni «Favoritos», y el contador de favoritos no se muestra.
  En la vista de refugio la tarjeta y el título son los del refugio, y el ícono del
  encabezado ofrece los datos personales o los del refugio (spec 017).
- **Inicio:** dos juegos de accesos (`constants/home.ts`) según el perfil.
- **Barra inferior:** en la vista de refugio no está el botón «Adoptar».
- **Adoptar y Favoritos:** si se llega desde la vista de refugio, vuelven a Inicio.
- **Ficha de publicación:** se puede ver desde los dos perfiles; desde el de refugio no se
  muestran «Solicitar adopción» ni el corazón.
- **Solicitudes:** desde la vista de refugio solo «Recibidas», sin selector.
- **Mis mascotas / crear mascota / chats:** usan el perfil activo, no el rol.

El perfil activo vive en `useSesion()` (`vistaRefugio`, `ambito`) y el cliente HTTP lo manda
solo en la cabecera (`services/api.ts`): ninguna pantalla lo pasa a mano.

## 6. Reglas de negocio y validaciones

1. Un miembro de refugio **siempre arranca en la vista de refugio**: al loguearse y al
   reabrir la app. La elección no se persiste. (Backend: default de la cabecera. Frontend:
   `useSesion`.)
2. Desde la vista de refugio **no se adopta ni se guardan favoritos**. (Backend: rutas
   PERSONAL. Frontend: sin botón Adoptar, sin corazón, sin «Solicitar adopción».)
3. Desde el perfil personal **no se ve nada del refugio**: ni sus mascotas, ni sus
   publicaciones (el feed las excluye), ni sus solicitudes, seguimientos o chats.
4. Desde la vista de refugio **no se ve nada personal**: ni las mascotas personales, ni lo que
   el usuario solicitó, ni sus favoritos, seguimientos como adoptante o chats personales.
5. Una mascota del propio refugio es «propia» también desde el perfil personal: no se puede
   solicitar ni guardar en favoritos (`PUBLICACION_PROPIA` / `MASCOTA_PROPIA`).
6. La quota de 5 publicaciones activas (regla transversal 7) cuenta solo las publicaciones
   personales, también para un miembro de refugio que publica desde su perfil personal.
7. Editar o eliminar una mascota sigue exigiendo haberla creado (HU-6.2/6.3), además de que
   sea del perfil activo.
8. Todo módulo nuevo que tenga «lo mío» y «lo del refugio» (campañas, padrinazgos,
   perdidos) toma el ámbito de `req.ambito` y filtra con el mismo criterio.

## 7. Criterios de aceptación

- [ ] Un miembro de refugio inicia sesión y la app arranca en la vista de refugio.
- [ ] Cierra y reabre la app habiendo quedado en la vista personal: arranca en la de refugio.
- [ ] En la vista de refugio no ve el botón Adoptar, ni Favoritos, ni «Mis solicitudes».
- [ ] En la vista de refugio, Mis mascotas lista solo las del refugio; en la personal, solo las suyas.
- [ ] Carga una mascota desde la vista personal: queda como personal y no aparece en la del refugio.
- [ ] En la vista personal, el feed no muestra mascotas de su refugio.
- [ ] En la vista personal, Solicitudes recibidas muestra solo las de sus mascotas personales.
- [ ] Los chats con adoptantes por mascotas del refugio aparecen solo en la vista de refugio.
- [ ] Un adoptante sin refugio no ve el switch y todo funciona como antes.

## 8. Casos borde y errores

- **Le sacan el refugio al usuario con la sesión abierta:** el front vuelve solo a la vista
  personal (`vistaRefugio` se cruza con el rol). Si el token todavía dice que es miembro, el
  backend filtra por `refugioId` real y no devuelve nada del refugio.
- **Deep link a algo del otro perfil:** `404` (o `403 AMBITO_NO_PERMITIDO` en chats) y la
  pantalla muestra su estado de error.
- **Mascota del refugio que el usuario cargó y quiere ver desde el perfil personal:** no se
  ve; es del refugio.

## 9. Notas y decisiones

- 2026-09-24 — Se reemplaza la decisión anterior de que, desde el perfil personal, un miembro
  podía adoptar o guardar en favoritos mascotas de su propio refugio («el switch hace de
  cuenta que es un adoptante más»). Ahora lo del refugio no se ve desde el perfil personal,
  así que tampoco se adopta. Pedido del equipo.
- 2026-09-24 — El ámbito viaja en una cabecera y no en el JWT: el switch es instantáneo y no
  hace falta re-emitir el token (sesión stateless, CONSTITUTION §4). No es una frontera de
  seguridad entre personas (la cuenta es la misma), sino de organización de la información;
  lo que sí es seguridad (pertenecer al refugio) se sigue validando contra la base.
- Pendiente: los eventos de socket (`chat:unirse`, mensajes nuevos) no conocen el ámbito.
  Ver `DEUDA_TECNICA.md`.
