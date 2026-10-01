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
  - La tarjeta del aviso en el chat: la conversación con el reportante aparece en el listado
    (GUI-08), se abre como cualquier otra (GUI-14) y lleva adentro la tarjeta del aviso.
  - Paso del aviso a **Resuelto** por el reportante, con la leyenda "Volvió con su dueño" en el
    portal.
- **NO incluye:**
  - **Cerrar la conversación al resolver el aviso**: descartado por decisión del equipo, no
    postergado. Ver §9, decisión 2.
  - Editar el aviso y darlo de baja por el reportante (HU-13.3).
  - Histórico de estados, reabrir un caso resuelto y pasar de Perdido a Encontrado. "Resuelto"
    es **terminal** por ahora (HU-13.3).
  - Tope anti-spam de avisos activos por usuario (HU-13.3).
  - Notificación push del reclamo: el reportante lo ve por el badge del chat, como cualquier
    mensaje. La notificación es de HU-4.3.

### Por qué el botón "Resuelto" entra acá y no en HU-13.3

El criterio de aceptación 3 de la HU lo pide textualmente. Lo que queda en HU-13.3 es todo lo
demás de la gestión de estados, que no depende del chat.

La otra mitad de lo que REQUISITOS §13 pide para ese botón —"cierra el caso **y el chat
asociado**"— **no se implementa**, por decisión del equipo. El motivo está en §9, decisión 2.

Decisiones tomadas con el equipo el 2026-10-01.

## 3. Entidades involucradas

`Chat`, `Mensaje` y `AnimalPerdido`, ya existentes. Cambios sobre `docs/MODELO_DATOS.md`
(migración `20261001150000_hu132_chat_de_reclamo`):

- **`chat.animal_perdido_id`** (FK nullable → `AnimalPerdido`): el aviso que **abrió** la sala,
  cuando la abrió un reclamo. Mismo papel que `chat.solicitud_id`: es el origen de la
  conversación, no la lista de todo lo que se habló en ella. Si el reclamo cayó en una
  conversación que ya existía, queda en `NULL`.
- **`mensaje.animal_perdido_id`** (FK nullable → `AnimalPerdido`): sólo en los mensajes de tipo
  `ANIMAL_PERDIDO`, que son los que pintan la tarjeta. **Acá vive lo que se habló**: una sala
  puede acumular dos avisos de la misma persona, o un aviso y una solicitud.
- **`tipo_mensaje` += `ANIMAL_PERDIDO`**: el enum ya tenía `TEXTO` y `SOLICITUD`.
- **Índice único parcial `mensaje_aviso_por_chat_unico_idx`** sobre
  `(animal_perdido_id, chat_id) WHERE animal_perdido_id IS NOT NULL`: una tarjeta por aviso y por
  sala, incluso con dos requests simultáneos. Es el equivalente de `chat_solicitud_unico_idx`, y
  va en SQL a mano porque Prisma no expresa índices parciales. **No** es único por aviso a secas:
  el mismo aviso reclamado por cinco personas deja cinco tarjetas, una en la conversación de
  cada reclamante con el reportante.

`animal_perdido_fecha_resuelto` ya existía y hasta ahora sólo la escribía el seed: esta HU es la
que la llena de verdad. El catálogo `Estado_Animal_Perdido` ya estaba sembrado con los tres
estados, "Resuelto" incluido.

### La sala es entre las partes, como la de una solicitud

`asegurarChatDeSolicitud` reusa la conversación que ya exista entre las dos personas ("la sala es
entre las partes"): una segunda solicitud al mismo refugio deja su tarjeta en la que ya había. El
reclamo hace **lo mismo**.

Entonces, con Ana:

| Qué pasa | Resultado |
|---|---|
| Le pediste adoptar a Max y ahora reclamás su aviso de Michi | La tarjeta de Michi entra en **esa misma** conversación |
| No tenían conversación y reclamás Michi | Se abre una, con `animal_perdido_id` = Michi |
| Volvés a tocar "Enviar mensaje" en Michi | La misma conversación, **sin** repetir la tarjeta |
| Reclamás otro aviso de Ana | Otra tarjeta en la misma conversación |
| Ana marca Michi como resuelto | El aviso queda Resuelto. **La conversación no cambia** |

La primera versión de esta spec abría una sala **por aviso**, para poder cerrarla al resolver el
caso sin tocar las demás. Se descartó el 2026-10-01 por las dos razones de §9, decisión 2: en el
listado de chats dos filas con la misma persona son indistinguibles —mismo nombre, misma foto, y
el preview deja de decir "Mascota perdida" en cuanto alguien escribe—, y el cierre que la
justificaba también se descartó.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | `/api/v1/animales-perdidos/:id/reclamo` | cualquier usuario | Reclama el aviso y devuelve la sala |
| POST | `/api/v1/animales-perdidos/:id/resuelto` | sólo el reportante | Cierra el caso |

Los dos son `POST` por el mismo criterio que `/chats/:id/leidos`: no se edita un recurso
identificado, se ejecuta una acción.

Además, tres campos nuevos en endpoints que ya existían:

- `GET /chats/:chatId` (cabecera) suma **`aviso`** y **`contexto`**.
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
- **GUI-14 Conversación:** la **tarjeta del aviso** (foto, nombre o especie, estado, lugar y
  fecha del suceso) con el mismo tratamiento que la de solicitud: ancho completo, emitida por
  PetHood, con acción para ir al aviso. El subtítulo de la cabecera nombra el contexto vigente
  —el aviso o la solicitud, el que sea más reciente— con el campo `contexto`. **La barra de
  escritura no cambia nunca por el estado del aviso.**
- **GUI-08 Chat (listado):** una sala cuyo último mensaje es la tarjeta muestra "Mascota
  perdida" como preview, igual que "Solicitud".

## 6. Reglas de negocio y validaciones

1. Cualquier usuario autenticado puede reclamar, desde cualquiera de sus dos perfiles: el aviso
   es de la persona y la sala también, así que `X-Ambito` no cambia nada. La sala queda con
   `refugio_id` en `NULL` y las dos partes la ven desde su perfil **personal**. (backend)
2. **La conversación es entre las partes**: si ya existe una con el reportante, el reclamo deja
   su tarjeta ahí en vez de abrir otra. (backend)
3. **No se puede reclamar un aviso propio** → 400 `RECLAMO_PROPIO`. El front ya esconde el botón
   con `esPropio`; el backend lo valida igual. (backend y front)
4. **No se puede reclamar un caso resuelto** → 409 `AVISO_RESUELTO`. (backend y front)
5. **No se abre una conversación contra una cuenta dada de baja** → 409 `REPORTANTE_INACTIVO`: es
   mejor decirlo que mandar al usuario a una sala donde no va a poder escribir. (backend)
6. El reclamo es **idempotente**: el botón no se esconde después del primero, así que volver a
   tocarlo devuelve la misma conversación (`nueva: false`) y **no** repite la tarjeta. Responde
   200, no 201. La idempotencia es por **(aviso, sala)**: el mismo aviso reclamado por otra
   persona deja su propia tarjeta en su propia conversación. (backend)
7. **Sólo el reportante resuelve** su aviso → 403 `SIN_PERMISO`. (backend)
8. **Resolver cierra el caso, no la conversación.** No hay sólo lectura ni baja de salas: las dos
   personas siguen pudiendo escribirse. (backend y front)
9. CONSTITUTION §7 ("chat habilitado sólo tras interacción previa") queda satisfecha por el
   reclamo, que el artículo nombra explícitamente: "solicitud de adopción **o reporte de mascota
   perdida**". (backend)
10. El subtítulo de la cabecera nombra la tarjeta **más reciente** de la sala, que puede ser una
    solicitud o un aviso. Lo decide el backend (`contexto`) para que la regla no quede escrita en
    dos lugares. (backend)
11. La tarjeta del aviso en el chat **no lleva coordenadas ni distancia**: la regla 6 de la spec
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

- [x] Reclamar sin conversación previa con el reportante abre una.
- [x] Reclamar cuando **ya** hay conversación con esa persona deja la tarjeta ahí y **no** abre
      una segunda.
- [x] Reclamar dos veces el mismo aviso devuelve la misma conversación y **no** repite la tarjeta.
- [x] Dos personas distintas reclamando el mismo aviso dejan cada una su tarjeta en su propia
      conversación con el reportante.
- [x] Reclamar el aviso propio → 400 `RECLAMO_PROPIO`.
- [x] Reclamar un aviso resuelto → 409 `AVISO_RESUELTO`.
- [x] Resolver un aviso ajeno → 403 `SIN_PERMISO`.
- [x] Resolver dos veces → 409 `AVISO_RESUELTO`.
- [x] **Después de resolver, las dos personas siguen pudiendo escribirse.** Resolver no pasa por
      el módulo de chat.
- [x] Una sala con una solicitud y un aviso trae las dos en la cabecera, y `contexto` nombra la
      más reciente.
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
- **El aviso se da de baja (moderación) con la conversación abierta:** la conversación queda viva
  y escribible, igual que al resolver. La tarjeta sigue mostrando el aviso.
- **Dos requests de reclamo simultáneos:** el índice único parcial sobre `mensaje` corta la
  segunda tarjeta. El servicio busca antes de crear, así que el caso sólo se da en una carrera
  real. Lo que **no** cubre ningún índice es que dos requests abran dos conversaciones a la vez
  si no había ninguna: es la misma ventana que ya tiene `asegurarChatDeSolicitud` con
  `buscarChatEntre`, y se resuelve con la misma respuesta (no se resuelve; la carrera necesita
  dos reclamos en el mismo milisegundo del mismo usuario al mismo aviso).
- **Reclamar un aviso cuya conversación tiene el último mensaje de hace un año:** la tarjeta
  entra ahí igual y el chat sube al tope del listado por fecha de actividad. Es lo mismo que hace
  una segunda solicitud.
- **Cursor del historial:** en una conversación larga la tarjeta puede quedar en una página
  vieja; la query del aviso la paga sólo la página que la trae.

## 9. Notas y decisiones

Decisiones tomadas con el equipo el 2026-10-01, a partir del relevamiento de la HU. Las
decisiones 2 y 4 **reemplazan** a las que tenía el primer borrador de esta spec, el mismo día,
después de revisar cómo se veía el resultado en el listado de chats.

1. **El botón "Resuelto" entra en esta HU** y no en HU-13.3 — ver §2.

2. **Resolver el aviso NO cierra la conversación.** REQUISITOS §13 pide "cierra el caso y el chat
   asociado"; esa segunda mitad se descarta, y no es un olvido: **el requisito se escribió sin
   pensar en qué conversación se estaba cerrando** (decisión explícita del equipo).

   Dos razones, en orden de peso:
   - Con la conversación compartida (decisión 4), cerrarla silenciaría charlas que no tienen nada
     que ver con el aviso: la misma sala puede tener una solicitud de adopción en curso.
   - Incluso con una sala dedicada, silenciarla justo cuando el caso se resolvió es lo peor para
     coordinar la **entrega real del animal**, que no termina cuando alguien toca el botón.

   Qué queda del requisito: el caso **sí** se cierra (estado Resuelto, `fecha_resuelto`, y la
   leyenda "Volvió con su dueño" en el portal), que es lo que el criterio de aceptación de la HU
   pide literalmente. Lo que no se toca es el chat.

3. **La conversación lleva la tarjeta del aviso**, con un valor nuevo de `tipo_mensaje` y su
   columna, reusando el patrón de la tarjeta de solicitud. Un reportante con cinco reclamos no
   tiene otra forma de saber de qué aviso le hablan, y hace visible la interacción previa que
   pide CONSTITUTION §7. Con la sala compartida es **más** necesaria, no menos: es lo único que
   distingue "me escribe por Max" de "me escribe por Michi".

4. **La conversación es entre las partes**, como la de una solicitud, y no una por aviso — ver
   §3. El primer borrador abría una sala por aviso para poder cerrarla sin tocar las demás;
   descartado el cierre (decisión 2), lo único que quedaba de esa variante era el costo: dos o
   más filas en el listado de chats con el mismo nombre y la misma foto, que el usuario no puede
   distinguir una vez que alguien escribe y el preview deja de decir "Mascota perdida".
5. **El criterio de aceptación 1 pide mostrar "la ubicación donde se encontró (longitud y
   latitud)" y no se implementa así.** Las coordenadas del dispositivo **no se exponen nunca**:
   es la regla 6 de la spec 020 y la ambigüedad ya resuelta en REQUISITOS §10.1 (no hay mapa
   interactivo; la ubicación se muestra como Provincia/Localidad). El popup de detalle ya muestra
   el lugar, la distancia y el link a Google Maps, que es lo que el criterio quería lograr.
   Decisión anterior a esta HU, que esta spec respeta.
6. **`chat_tipo` sigue sin escribirse**: sus valores no están definidos en MODELO_DATOS.md. Una
   conversación que empezó por un reclamo se reconoce por `animal_perdido_id`, y lo que se habló
   en ella por las tarjetas de `mensaje`.

7. **El subtítulo de la cabecera nombra la tarjeta más reciente.** Es consecuencia de la decisión
   4: una conversación puede tener una solicitud y un aviso, y el subtítulo muestra uno. Se eligió
   el más reciente porque es la regla que ya regía para dos solicitudes en la misma sala ("la
   vigente es la última tarjeta"), no una regla nueva.

### Deuda que deja esta spec

Anotada en [`docs/DEUDA_TECNICA.md`](../DEUDA_TECNICA.md):

- **Ítem 32** — `Chat` tiene dos FK de origen (`solicitud_id` y `animal_perdido_id`) que en la
  práctica nunca se llenan juntas, pero nada en base lo impide.

Y sigue abierta la **28** (el dueño de un aviso no puede retirarlo), que es de HU-13.3.

Lo que queda para HU-13.3 está en «Pendiente para otros módulos» del
[contrato](../api-mascotas-perdidas.md#pendiente-para-otros-módulos).
