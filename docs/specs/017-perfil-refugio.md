# Spec 017 — Perfil del refugio

**Estado:** EN REVISIÓN
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-26

## 1. Objetivo

Que el refugio tenga un perfil propio. Desde la vista de refugio (spec 016), un miembro ve
los datos del **refugio** (nombre, dirección, foto, reseñas y sus números) y no los suyos; y
desde el ícono del encabezado de Mi Perfil puede elegir entre ver y editar sus datos
personales o los del refugio.

## 2. Alcance

- **Incluye:** tarjeta del refugio en Mi Perfil (artboard 19), pantalla «Datos del refugio»
  (artboard 23, con el mismo comportamiento que «Datos personales»: campos con lapicito y
  «Cancelar»/«Guardar cambios» recién cuando hay cambios), y la hoja con las dos opciones
  del ícono del encabezado.
- **NO incluye:**
  - Permiso por rol dentro del refugio para editar: hoy edita cualquier miembro
    (`DEUDA_TECNICA.md`, ítem 17).
  - Horario de atención: aparece en el artboard 23 pero `Refugio` no tiene ese campo. Si se
    quiere, es un cambio de modelo aparte (ver §9).
  - Crear un refugio o unirse a uno desde la app: hoy no hay HU. El registro como refugio de
    spec 001 está deshabilitado (`auth.service.ts`) y la pertenencia la asigna el admin
    (spec 002, `PATCH /admin/usuarios/:id/roles` con `refugioId`).
  - Perfil público del refugio visto por un adoptante.

## 3. Entidades involucradas

`Refugio`, sin cambios (MODELO_DATOS.md). Se editan `nombre`, `direccion`, `telefono`,
`email`, `descripcion` e `imagen_url`. Los números salen de `Mascota_Estado`, `Solicitud` /
`Solicitud_Estado` y `Reseña` (`refugio_reportado_id`).

## 4. API (contrato backend)

Módulo `src/modules/perfil-refugio/`. Las dos rutas exigen `MIEMBRO_REFUGIO` y la vista de
refugio (`requiereAmbito('REFUGIO')`, spec 016): desde el perfil personal responden
`403 AMBITO_NO_PERMITIDO`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /api/v1/refugio/perfil | MIEMBRO_REFUGIO, ámbito REFUGIO | Perfil del refugio del usuario |
| PATCH | /api/v1/refugio/perfil | MIEMBRO_REFUGIO, ámbito REFUGIO | Edita los datos (multipart, `imagen` opcional) |

Respuesta de las dos:

```json
{
  "refugio": {
    "id": 7,
    "nombre": "Refugio Esperanza",
    "direccion": "Av. Santa Fe 1234, Palermo, CABA",
    "telefono": "+541144445678",
    "email": "esperanza@refugio.com",
    "descripcion": "Rescate y adopción responsable desde 2012.",
    "imagenUrl": "/api/v1/archivos/perfiles/abc.webp",
    "verificado": true,
    "estado": "Activo",
    "estadisticas": { "enRefugio": 24, "adopciones": 156, "solicitudesAbiertas": 12 },
    "valoracion": { "promedio": 4.8, "cantidad": 89 },
    "puedeEditar": true
  }
}
```

Body del PATCH (todos los campos siempre; un opcional vacío se guarda como `null`):
`nombre` (2-100), `direccion` (2-150), `telefono` (opcional, mismas reglas que el registro),
`email` (opcional), `descripcion` (opcional, ≤1000). Límites en `LIMITES.refugio`, los mismos
del alta de refugio del admin.

Errores: `400 VALIDACION`; `403 SIN_REFUGIO` (el usuario no tiene refugio);
`403 AMBITO_NO_PERMITIDO`; `403 SIN_PERMISO_REFUGIO` (reservado para cuando exista el permiso
por rol, hoy no se da); `404 REFUGIO_NO_ENCONTRADO` (refugio dado de baja).

**`GET /usuarios/me` ahora devuelve también `refugio: { id, nombre } | null`**, igual que el
login. Sin eso, refrescar Mi Perfil borraba el refugio de la sesión y un cambio de nombre no
llegaba al encabezado de Chats.

## 5. Pantallas (frontend)

- **Mi Perfil, vista de refugio** (`app/(tabs)/perfil.tsx`): título «Mi Refugio»; la tarjeta
  es la del refugio (foto o ícono de edificio, nombre, dirección, estrellas y cantidad de
  reseñas, chip «Pendiente de verificación» si corresponde) con tres números: «En el
  refugio», «Adopciones» y «Solicitudes abiertas». El aviso de perfil incompleto habla del
  refugio (foto, teléfono o descripción) y lleva a «Datos del refugio». Switch y menú, igual
  que en spec 016.
- **Mi Perfil, vista personal:** sin cambios; la tarjeta es la de la persona.
- **Ícono del encabezado:** en la vista personal va directo a «Datos personales». En la de
  refugio abre una hoja (`HojaOpciones`) con «Mis datos personales» y «Datos del refugio».
- **Datos del refugio** (`app/perfil/refugio.tsx`): foto con cámara, «Nombre del refugio»,
  «Descripción», «Dirección», «Teléfono» y «Correo», cada uno con lapicito. Al modificar algo
  aparecen «Cancelar» (vuelve a los valores cargados) y «Guardar cambios»; salir con cambios
  pide confirmación. Sin `puedeEditar`, queda de solo lectura (sin lápices, cámara ni botones).

## 6. Reglas de negocio y validaciones

1. Un miembro solo ve y edita el refugio al que pertenece (`usuario.refugio_id`); el id nunca
   viaja en la ruta ni en el body.
2. Quién puede editar lo decide `puedeEditarPerfil` en `perfil-refugio.service.ts`, y el
   front solo lee `puedeEditar`. Hoy devuelve `true` para cualquier miembro.
3. «En el refugio» = mascotas vigentes en Disponible, En_Tratamiento o En_Transito (mismo
   criterio que el dashboard, spec 010). «Adopciones» = mascotas del refugio en estado
   vigente Adoptado. «Solicitudes abiertas» = solicitudes sobre mascotas del refugio cuyo
   estado vigente es Pendiente o En_Revision.
4. La valoración es el promedio de las reseñas vigentes con `refugio_reportado_id` del
   refugio, redondeado a un decimal; sin reseñas, `null`.
5. Editar registra `EDITAR_PERFIL_REFUGIO` en el log de auditoría y completa
   `usuario_modificacion` / `fecha_modificacion` del refugio.
6. La foto va a la carpeta pública `perfiles`, como el avatar de una persona.

## 7. Criterios de aceptación

- [ ] En la vista de refugio, Mi Perfil muestra el nombre, la dirección y la foto del refugio, no los del usuario.
- [ ] En la vista personal, Mi Perfil muestra los datos del usuario, como antes.
- [ ] En la vista de refugio, el ícono del encabezado ofrece «Mis datos personales» y «Datos del refugio».
- [ ] En la vista personal, el ícono va directo a «Datos personales».
- [ ] «Datos del refugio» muestra los campos cargados con lapicito; sin cambios no hay botones.
- [ ] Al modificar un campo aparecen «Cancelar» y «Guardar cambios»; «Cancelar» restaura los valores.
- [ ] Guardar con nombre o dirección vacíos marca el campo en rojo y no envía nada.
- [ ] Borrar el teléfono o el correo y guardar los deja vacíos.
- [ ] Tras guardar, la tarjeta de Mi Perfil y el encabezado de Chats muestran el nombre nuevo.
- [ ] `GET /refugio/perfil` desde la vista personal responde `403 AMBITO_NO_PERMITIDO`.

## 8. Casos borde y errores

- **Refugio dado de baja con la sesión abierta:** `404 REFUGIO_NO_ENCONTRADO`; Mi Perfil
  muestra el toast de error y no muestra tarjeta.
- **Le sacan el refugio al usuario:** la app vuelve sola a la vista personal (spec 016 §8) y
  la opción desaparece; si igual llega un pedido, `403 SIN_REFUGIO`.
- **Dos miembros editan a la vez:** gana el último que guarda (no hay control de versión).

## 9. Notas y decisiones

- 2026-09-26 — Pedido del equipo: en la vista de refugio se ven las cosas del refugio, no
  las de la persona. La pantalla de edición del artboard 23 pasa a funcionar como la de
  datos personales (ver con lapicitos, guardar/cancelar al modificar).
- 2026-09-26 — El permiso por rol dentro del refugio queda para después (DEUDA_TECNICA.md,
  ítem 17). El backend ya expone `puedeEditar` para que el front no cambie ese día.
- 2026-09-26 — «Mis datos personales» se ofrece también desde la vista de refugio: son los
  datos de la cuenta (una sola, spec 016), no «lo personal» que esa vista oculta.
- Pendiente de decidir: el artboard 23 muestra «Horario». Agregarlo es una columna nueva en
  `Refugio` (skill `cambio-modelo-datos`) y no se hizo sin acuerdo del equipo.
