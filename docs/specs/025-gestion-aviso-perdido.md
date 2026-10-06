# Spec 025 — Gestión del aviso de mascota perdida por quien lo publicó (HU-13.3)

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-10-04

## 1. Objetivo

Que quien publicó un aviso de mascota perdida o encontrada pueda verlo entre sus publicaciones,
corregirlo y retirarlo, sin depender de un administrador. Es la tercera HU del módulo 13: HU-13.1
(spec 020) dejó el alta y el portal, y HU-13.2 (spec 024) el reclamo con chat y el paso a
Resuelto.

## 2. Alcance

- **Incluye:**
  - Los avisos propios en "Mis publicaciones", junto con las publicaciones de adopción.
  - Editar el aviso: todo lo que carga el formulario del alta, fotos incluidas.
  - Eliminar el aviso (baja lógica), salvo que esté resuelto.
  - El detalle de un aviso por id, para abrir su popup desde la tarjeta del chat.
- **NO incluye:**
  - Histórico de estados y reabrir un caso resuelto: "Resuelto" sigue siendo terminal.
  - Tope anti-spam de avisos activos por usuario.

## 3. Entidades involucradas

Sin cambios de modelo. La baja usa las columnas de auditoría de `AnimalPerdido`
(`animal_perdido_fecha_baja`, `animal_perdido_usuario_baja`), como la baja por el admin (spec 008).

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/api/v1/animales-perdidos/mios` | cualquier usuario | Los avisos propios, en cualquier estado |
| GET | `/api/v1/animales-perdidos/:id` | cualquier usuario | El detalle de un aviso |
| PUT | `/api/v1/animales-perdidos/:id` | sólo quien lo publicó | Edita el aviso (multipart) |
| DELETE | `/api/v1/animales-perdidos/:id` | sólo quien lo publicó | Lo elimina (baja lógica) |

Además, la tarjeta del aviso suma `lugar` (el pin del lugar), que la edición usa para arrancar con
el pin que el aviso ya tenía.

**Contrato completo:** [`docs/api-mascotas-perdidas.md`](../api-mascotas-perdidas.md).

## 5. Pantallas (frontend)

- **Mis publicaciones:** desde el perfil personal, la grilla suma los avisos propios mezclados con
  las publicaciones por fecha. La tarjeta tiene la misma forma que la de una publicación, con la
  etiqueta "Mascotas perdidas" y el badge del aviso. El diseño no trae esta variante: sigue el de
  la tarjeta de publicación, que no cambia.
- **Popup del aviso** (el mismo del portal): en un aviso propio, "Marcar como resuelto" (HU-13.2),
  "Editar" y "Eliminar". Eliminar pide confirmación; en uno resuelto explica por qué no se puede.
- **Editar aviso:** el formulario del alta, con lo que el aviso ya tiene. No pide la ubicación del
  teléfono. En un caso resuelto no ofrece Perdida / Encontrada.
- **Tarjeta del aviso en el chat:** "Ver el aviso" abre el popup ahí mismo. Si el aviso se
  eliminó, dice "Se eliminó esta publicación".

## 6. Reglas de negocio y validaciones

1. Sólo quien publicó el aviso lo edita o lo elimina → 403 `SIN_PERMISO`. (backend)
2. Editar reemplaza todo el formulario, con las mismas reglas que el alta (nombre obligatorio en
   un aviso Perdido, de 1 a 5 fotos, lugar obligatorio, fecha no futura). (backend y front)
3. Al editar se puede pasar de Perdido a Encontrado y al revés, pero no a Resuelto. Un aviso
   resuelto se edita sin cambiar su estado. (backend y front)
4. Al editar, el pin del lugar es el que mande el cliente; si no manda ninguno, se vuelve a
   geocodificar sólo si el lugar cambió. (backend)
5. Un aviso resuelto no se elimina → 409 `AVISO_RESUELTO`, con el motivo. (backend y front)
6. Eliminar no toca las conversaciones ni las fotos: la tarjeta del aviso queda en el chat. Su
   detalle responde 404 `AVISO_ELIMINADO`. (backend)
7. Los avisos propios se listan sólo desde el perfil personal: el aviso es de la persona.
   (front)

## 7. Criterios de aceptación

- [x] Mis publicaciones muestra los avisos propios, distinguibles de las publicaciones.
- [x] Editar cambia los datos y las fotos; las fotos que se sacaron se borran.
- [x] Editar el aviso ajeno → 403.
- [x] Pasar a Resuelto editando → 400 `ESTADO_INVALIDO`.
- [x] Eliminar lo saca del portal, de las opciones del filtro y de Mis publicaciones.
- [x] Eliminar uno resuelto → 409 `AVISO_RESUELTO`, y la app lo explica antes de llamar.
- [x] Después de eliminarlo, la tarjeta sigue en el chat y al tocarla dice que se eliminó.

Cubiertos por `tests/unit/modules/animales-perdidos.gestion.test.ts` y verificados contra el
servidor local (2026-10-04).

## 8. Casos borde y errores

- **Editar un aviso que se eliminó mientras tanto:** 404 `NO_ENCONTRADO`; la pantalla de
  edición lo pide fresco al abrirse, así que lo dice antes de que el usuario cargue nada.
- **Falla la escritura después de subir fotos nuevas:** se borran las nuevas.
- **Aviso sin pin** (el geocoder no lo encontró al publicar): al editarlo, el mapa se ubica de
  nuevo con el lugar que tiene.

## 9. Notas y decisiones

Pedidas por el equipo el 2026-10-04, al probar HU-13.2:

1. **Los avisos van en Mis publicaciones**, con un texto que los distinga y sin cambiar el diseño
   de las publicaciones de adopción.
2. **Un aviso resuelto no se elimina**, y la app explica por qué.
3. **Eliminar deja la tarjeta en el chat**, y al tocarla dice "Se eliminó esta publicación".
4. **"Ver el aviso" desde el chat abre el popup**, no el portal.

Y una que tomó la implementación: **la edición es el formulario del alta**
(`FormularioAviso` en mobile), no una pantalla aparte, para que las dos no se desincronicen.

Cierra la deuda **28** de [`DEUDA_TECNICA.md`](../DEUDA_TECNICA.md).
