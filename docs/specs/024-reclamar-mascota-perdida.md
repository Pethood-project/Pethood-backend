# Spec 024 — Reclamar mascota perdida/encontrada (HU-13.2)

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-10-01

## 1. Objetivo

Que cualquier usuario autenticado pueda **reclamar** un aviso del portal de mascotas
perdidas/encontradas (GUI-06) y que eso abra una conversación con quien lo publicó, para
recuperar su mascota o ayudar a otro a recuperar la suya. Y que quien publicó el aviso pueda
**cerrar el caso** cuando el animal volvió.

Es la segunda de las tres HUs del módulo 13: HU-13.1 (spec 020) dejó el alta y el portal con el
botón "Enviar mensaje" deshabilitado, y esta HU lo enciende.

## 2. Alcance

- **Incluye:**
  - Reclamo de un aviso: abre (o reencuentra) la sala de reencuentro con el reportante y deja
    adentro la tarjeta del aviso.
  - La sala de reencuentro en el chat: aparece en el listado (GUI-08), se abre como cualquier
    otra (GUI-14) y arranca con la tarjeta del aviso en lugar de vacía.
  - Paso del aviso a **Resuelto** por el reportante, con la leyenda "Volvió con su dueño" en el
    portal, y el cierre de las salas del aviso (sólo lectura).
- **NO incluye** (queda para HU-13.3):
  - Editar el aviso y darlo de baja por el reportante.
  - Histórico de estados, reabrir un caso resuelto y pasar de Perdido a Encontrado. "Resuelto"
    es **terminal** por ahora.
  - Tope anti-spam de avisos activos por usuario.
  - Notificación push del reclamo: el reportante lo ve por el badge del chat, como cualquier
    mensaje. La notificación es de HU-4.3.

### Por qué el botón "Resuelto" entra acá y no en HU-13.3

El criterio de aceptación 3 de la HU lo pide textualmente, y REQUISITOS §13 describe HU-13.3
como "cierra el caso **y el chat asociado**": ese chat recién existe a partir de esta spec, así
que el cierre no se podía implementar antes. Lo que queda en HU-13.3 es todo lo demás de la
gestión de estados, que no depende del chat.

Decisión tomada con el equipo el 2026-10-01, junto con las otras tres de §9.

## 3. Entidades involucradas

`Chat`, `Mensaje` y `AnimalPerdido`, ya existentes. Cambios sobre `docs/MODELO_DATOS.md`
(migración `20261001150000_hu132_chat_de_reclamo`):

- **`chat.animal_perdido_id`** (FK nullable → `AnimalPerdido`): el aviso que abrió la sala.
  **Excluyente con `chat.solicitud_id`**: una sala nace de una solicitud o de un reclamo, nunca
  de las dos. Con las dos en `NULL` es una sala anterior a HU-5.2.
- **`mensaje.animal_perdido_id`** (FK nullable → `AnimalPerdido`): sólo en los mensajes de tipo
  `ANIMAL_PERDIDO`, que son los que pintan la tarjeta. El mensaje de cierre **no** la lleva: es
  un texto de sistema, no una tarjeta.
- **`tipo_mensaje` += `ANIMAL_PERDIDO`**: el enum ya tenía `TEXTO` y `SOLICITUD`.
- **Índice único parcial `chat_reclamo_unico_idx`** sobre
  `(animal_perdido_id, chat_usuario_alta) WHERE animal_perdido_id IS NOT NULL AND chat_fecha_baja IS NULL`:
  una sala por aviso y por reclamante, incluso con dos requests simultáneos. Va en SQL a mano
  porque Prisma no expresa índices parciales, igual que `chat_solicitud_unico_idx`.
- **Índice `chat_animal_perdido_id_idx`**: las salas de un aviso, que es lo que recorre el paso
  a Resuelto.

`animal_perdido_fecha_resuelto` ya existía y hasta ahora sólo la escribía el seed: esta HU es la
que la llena de verdad. El catálogo `Estado_Animal_Perdido` ya estaba sembrado con los tres
estados, "Resuelto" incluido.

### Por qué la sala es por aviso y no entre las partes

`asegurarChatDeSolicitud` reusa la sala que ya exista entre las dos personas ("la sala es entre
las partes"): una segunda solicitud al mismo refugio cae en la conversación que ya había. Para
un reclamo esa regla **no sirve**, porque marcar el aviso Resuelto deja su sala en sólo lectura
y, con una sala compartida, eso cortaría una conversación que no tiene nada que ver con el
aviso. El mismo aviso reclamado por cinco personas abre **cinco salas**, cada una con el
reportante.

Dos personas pueden tener a la vez una conversación por una adopción y otra por un aviso. Son
dos filas de `chat` a propósito.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | `/api/v1/animales-perdidos/:id/reclamo` | cualquier usuario | Reclama el aviso y devuelve la sala |
| POST | `/api/v1/animales-perdidos/:id/resuelto` | sólo el reportante | Cierra el caso |

Los dos son `POST` por el mismo criterio que `/chats/:id/leidos`: no se edita un recurso
identificado, se ejecuta una acción.

Además, tres campos nuevos en endpoints que ya existían:

- `GET /chats/:chatId` (cabecera) suma **`aviso`** y **`soloLectura`**.
- `GET /chats/:chatId/mensajes` y el evento `chat:mensaje-nuevo` suman **`aviso`** en el mensaje
  y el valor `ANIMAL_PERDIDO` en `tipo`.
- `GET /chats` suma el valor `ANIMAL_PERDIDO` en `ultimoMensaje.tipo`.

**Contrato completo:** [`docs/api-mascotas-perdidas.md`](../api-mascotas-perdidas.md) para los
dos endpoints nuevos y [`docs/api-chats.md`](../api-chats.md) /
[`docs/api-chat-sala.md`](../api-chat-sala.md) para los cambios del chat. Esta spec no los
repite para que no haya dos versiones que se desincronicen.

## 5. Pantallas (frontend)

- **GUI-06 Mascotas Perdidas (portal):** el botón "Enviar mensaje" del popup de detalle deja de
  estar deshabilitado; al tocarlo reclama y navega a la sala. En un aviso propio (`esPropio`) el
  popup ofrece en su lugar **"Marcar como resuelto"**, con modal de confirmación (regla
  transversal 6). Un aviso Resuelto muestra la leyenda **"Volvió con su dueño"** en la tarjeta y
  en el detalle, y no ofrece ninguno de los dos botones.
- **GUI-14 Conversación:** una sala de reencuentro arranca con la **tarjeta del aviso** (foto,
  nombre o especie, estado, lugar y fecha del suceso), con el mismo tratamiento que la tarjeta
  de solicitud: ancho completo, emitida por PetHood, con acción para ir al aviso. Si el caso se
  resolvió, la barra de escritura se reemplaza por un cartel y la conversación queda legible.
- **GUI-08 Chat (listado):** una sala cuyo último mensaje es la tarjeta muestra "Mascota
  perdida" como preview, igual que "Solicitud".

## 6. Reglas de negocio y validaciones

1. Cualquier usuario autenticado puede reclamar, desde cualquiera de sus dos perfiles: el aviso
   es de la persona y la sala también, así que `X-Ambito` no cambia nada. La sala queda con
   `refugio_id` en `NULL` y las dos partes la ven desde su perfil **personal**. (backend)
2. **No se puede reclamar un aviso propio** → 400 `RECLAMO_PROPIO`. El front ya esconde el botón
   con `esPropio`; el backend lo valida igual. (backend y front)
3. **No se puede reclamar un caso resuelto** → 409 `AVISO_RESUELTO`. (backend y front)
4. **No se abre una sala contra una cuenta dada de baja** → 409 `REPORTANTE_INACTIVO`: es mejor
   decirlo que mandar al usuario a una sala donde no va a poder escribir. (backend)
5. El reclamo es **idempotente**: el botón no se esconde después del primer reclamo, así que
   volver a tocarlo devuelve la misma sala (`nueva: false`) y no duplica la tarjeta. Responde
   200, no 201. (backend)
6. **Sólo el reportante resuelve** su aviso → 403 `SIN_PERMISO`. Un reclamante que crea que ya
   está no cierra nada. (backend)
7. CONSTITUTION §7 ("chat habilitado sólo tras interacción previa") queda satisfecha por el
   reclamo, que el artículo nombra explícitamente: "solicitud de adopción **o reporte de mascota
   perdida**". (backend)
8. **"Cerrar el chat asociado" es dejarlo en sólo lectura**, no darlo de baja: la conversación
   sigue visible y legible, pero no acepta mensajes nuevos → 409 `CHAT_CERRADO`. (backend y
   front)
9. El sólo lectura **se deriva** del estado del aviso, no se guarda en `chat`: con dos columnas
   podrían contradecirse, y el estado del aviso ya es la fuente de verdad del caso. (backend)
10. La tarjeta del aviso en el chat **no lleva coordenadas ni distancia**: la regla 6 de la spec
    020 es que las del dispositivo no se exponen nunca, y la distancia depende de dónde está
    quien mira. (backend)

## 7. Criterios de aceptación

Los tres de la HU, desglosados:

- [x] El portal despliega todas las publicaciones en cualquier estado, cada una con su popup de
      detalle (foto, nombre, descripción, lugar) y un botón para abrir el chat. — **ya cumplido
      por HU-13.1**, salvo el botón, que esta HU habilita.
- [x] Tocar "Enviar mensaje" abre un chat entre el autor de la publicación y quien lo tocó.
- [x] El autor toca "Resuelto" → la publicación pasa a estado "Resuelto" y queda marcada con
      "Volvió con su dueño".

Y los que agrega el diseño de esta spec:

- [x] Reclamar dos veces el mismo aviso devuelve la misma sala y no duplica la tarjeta.
- [x] Dos personas distintas reclamando el mismo aviso abren dos salas distintas.
- [x] Reclamar el aviso propio → 400 `RECLAMO_PROPIO`.
- [x] Reclamar un aviso resuelto → 409 `AVISO_RESUELTO`.
- [x] Resolver un aviso ajeno → 403 `SIN_PERMISO`.
- [x] Resolver dos veces → 409 `AVISO_RESUELTO`.
- [x] Después de resolver, la cabecera de cada sala del aviso trae `soloLectura: true` y escribir
      responde 409 `CHAT_CERRADO`.
- [x] La sala de reencuentro de una persona que también tiene una conversación de adopción con
      el reportante es una sala **distinta**.
- [x] La tarjeta del aviso la emite SISTEMA y no el reclamante (si no, se pintaría como burbuja
      propia en su pantalla).
- [x] La tarjeta no expone latitud, longitud ni distancia.

Cubiertos por los 25 tests de `tests/unit/modules/animales-perdidos.reclamo.test.ts` y
`tests/unit/modules/chats.reclamo.service.test.ts`. **Pendiente la prueba manual en mobile**
contra la base con la migración aplicada (ver §8).

## 8. Casos borde y errores

- **El reportante borra su cuenta con la sala abierta:** la sala se sigue leyendo y el chat ya
  rechaza escribirle a un contacto inactivo (`CONTACTO_INACTIVO`). Un reclamo nuevo, en cambio,
  se corta antes con `REPORTANTE_INACTIVO`.
- **El aviso se da de baja (moderación) con salas abiertas:** las salas quedan vivas y
  escribibles. No se cierran: la baja es por moderación del aviso, no un caso resuelto, y cortar
  la conversación de las dos partes sería un castigo que nadie pidió. Anotado como deuda.
- **El mensaje de cierre falla** (socket caído, error de base): el aviso **ya quedó Resuelto** y
  el cierre vale igual, porque el sólo lectura se deriva del estado. Lo único que se pierde es la
  línea de aviso en la sala.
- **Un aviso que nadie reclamó pasa a Resuelto:** `cerrarSalasDeAviso` no encuentra salas y
  devuelve 0. No es un error.
- **Dos requests de reclamo simultáneos:** el índice único parcial corta el segundo. El servicio
  busca antes de crear, así que el caso sólo se da en una carrera real.
- **Cursor del historial en una sala de reencuentro:** la tarjeta es el primer mensaje, así que
  la query del aviso la paga sólo la última página.

## 9. Notas y decisiones

Decisiones tomadas con el equipo el 2026-10-01, a partir del relevamiento de la HU.

1. **El botón "Resuelto" entra en esta HU** y no en HU-13.3 — ver §2.
2. **"Cerrar el chat asociado" = sólo lectura**, no baja lógica. Dar de baja la conversación
   justo cuando el caso se resolvió es lo peor para coordinar la entrega real del animal, que no
   termina cuando alguien toca el botón; y la baja no es reversible desde la UI.
3. **La sala arranca con la tarjeta del aviso**, con un valor nuevo de `tipo_mensaje` y su
   columna, reusando el patrón de la tarjeta de solicitud. Un reportante con cinco reclamos no
   tiene otra forma de saber de qué aviso le hablan, y hace visible la interacción previa que
   pide CONSTITUTION §7.
4. **La sala es por aviso y por reclamante**, no entre las partes — ver §3.
5. **El criterio de aceptación 1 pide mostrar "la ubicación donde se encontró (longitud y
   latitud)" y no se implementa así.** Las coordenadas del dispositivo **no se exponen nunca**:
   es la regla 6 de la spec 020 y la ambigüedad ya resuelta en REQUISITOS §10.1 (no hay mapa
   interactivo; la ubicación se muestra como Provincia/Localidad). El popup de detalle ya muestra
   el lugar, la distancia y el link a Google Maps, que es lo que el criterio quería lograr.
   Decisión anterior a esta HU, que esta spec respeta.
6. **`chat_tipo` sigue sin escribirse**: sus valores no están definidos en MODELO_DATOS.md. La
   sala de reclamo se reconoce por `animal_perdido_id`, no por un tipo.

### Deuda que deja esta spec

Anotada en [`docs/DEUDA_TECNICA.md`](../DEUDA_TECNICA.md):

- **Ítem 32** — `Chat` tiene dos FK de origen excluyentes (`solicitud_id` y
  `animal_perdido_id`) y nada en base impide llenar las dos.
- **Ítem 33** — un aviso dado de baja por moderación no cierra sus salas.

Y sigue abierta la **28** (el dueño de un aviso no puede retirarlo), que es de HU-13.3.

Lo que queda para HU-13.3 está en «Pendiente para otros módulos» del
[contrato](../api-mascotas-perdidas.md#pendiente-para-otros-módulos).
