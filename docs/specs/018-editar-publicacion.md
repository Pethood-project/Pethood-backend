# Spec 018 — Editar publicación y cambiar su estado

**Estado:** EN REVISIÓN
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-28

## 1. Objetivo

Que quien publicó una mascota en adopción pueda corregir el aviso después de crearlo y
sacarlo o volverlo a poner en el feed: editar sus datos, y pausarlo, reactivarlo o
finalizarlo a mano. No hay HU en `REQUISITOS.md`: el alcance lo definió el equipo y queda
acá (§9).

## 2. Alcance

- **Incluye:**
  - Editar todos los datos de la publicación que se cargan al crearla (GUI-24): fotos,
    descripción para el swipe, desparasitado, personalidad, requisitos de adoptante y
    ubicación. (Las vacunas salieron de la publicación con la spec 019: son de la mascota.)
  - Cambios de estado manuales: pausar, reactivar y finalizar, cada uno con cartel de
    confirmación en la app.
  - Ajuste de las transiciones automáticas (que siguen al estado de la mascota) para que
    convivan con las manuales.
  - Solicitar adopción exige que la publicación esté `Activa`.
- **NO incluye:**
  - Cambiar la mascota de una publicación.
  - Eliminar una publicación (baja lógica): `DEUDA_TECNICA.md` ítem 16.
  - Permiso por rol dentro del refugio: hoy gestiona cualquier miembro
    (`DEUDA_TECNICA.md` ítem 18).
  - Qué pasa con las solicitudes abiertas al pausar o finalizar (`DEUDA_TECNICA.md` ítem 19).

## 3. Entidades involucradas

Sin cambios de modelo. Usa `Publicacion` (datos editables + auditoría de modificación) y
`Publicacion_Estado` (histórico: cambiar de estado es baja de la fila vigente + alta de una
nueva). Ver `MODELO_DATOS.md`.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| PUT | `/api/v1/publicaciones/:id` | quien la gestiona (§6.1) | Reemplaza los datos editables. Multipart. |
| PATCH | `/api/v1/publicaciones/:id/estado` | quien la gestiona (§6.1) | `{ accion: 'PAUSAR' \| 'REACTIVAR' \| 'FINALIZAR' }` |
| GET | `/api/v1/publicaciones/:id` | autenticado | Suma `puedeEditar: boolean` a la ficha. |

Las dos escrituras responden la ficha actualizada (misma forma que `GET /:id`).

### `PUT /publicaciones/:id`

PUT y no PATCH: el formulario manda el aviso entero, igual que el alta, y una lista que no
viaja queda vacía. Campos multipart, con las mismas reglas que `POST /publicaciones`:

| Campo | Regla |
|---|---|
| `descripcion` | obligatoria, trim, ≤200 |
| `ubicacion` | obligatoria, trim, ≤50 |
| `requisitos` (repetido) | cada uno ≤20 |
| `personalidad` (repetido) | cada uno ≤25 |
| `desparasitado` | `'true'` / `'false'` |
| `imagenes` (repetido) | galería final en orden, ≤5. Cada ítem es la ruta de una foto que la publicación ya muestra, o `nueva` en el lugar de una foto nueva |
| `fotos` (archivos) | las fotos nuevas, en el orden de sus marcas `nueva`. ≤5 MB, se comprimen |

Sin ninguna foto, la publicación vuelve a heredar la de la mascota (como al crear). Las
fotos que se quitan se borran del almacenamiento después de guardar; la de la mascota nunca.

Errores:

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `VALIDACION` | Campo inválido; marcas `nueva` que no coinciden con los archivos; una ruta que no es de la publicación; fotos repetidas |
| 403 | `NO_AUTORIZADO` | No la puede gestionar desde el perfil activo |
| 404 | `NO_ENCONTRADO` | No existe o está dada de baja |
| 409 | `PUBLICACION_FINALIZADA` | Está finalizada |

### `PATCH /publicaciones/:id/estado`

| Acción | Desde | Hacia | Chequeos extra |
|---|---|---|---|
| `PAUSAR` | Activa | Pausada | — |
| `REACTIVAR` | Pausada | Activa | mascota `Disponible`; quota de 5 activas si es personal |
| `FINALIZAR` | Activa o Pausada | Finalizada | — |

Errores: `400 VALIDACION` (acción desconocida), `403 NO_AUTORIZADO`, `404 NO_ENCONTRADO`,
`409 TRANSICION_INVALIDA` (no sale de ese estado), `409 MASCOTA_NO_DISPONIBLE` (reactivar
con la mascota en tratamiento, tránsito, etc.), `409 LIMITE_DE_PUBLICACIONES` (reactivar con
5 activas).

## 5. Pantallas (frontend)

- **Ficha de la publicación** (`app/publicaciones/[id]/index.tsx`): con `puedeEditar` y
  mientras no esté finalizada, al final de la ficha (después de toda la publicación) muestra «Editar publicación», «Pausar
  publicación» (si está activa) o «Reactivar publicación» (si está pausada), y «Finalizar
  publicación». Cada cambio de estado abre un `ConfirmDialog` («¿Seguro que querés…?») y
  termina con un toast. La ficha se recarga al volver de editar.
- **Editar publicación** (`app/publicaciones/[id]/editar.tsx`): los mismos campos del alta
  (`components/publicaciones/CamposPublicacion.tsx`, compartido con `crear.tsx`), precargados;
  la mascota se muestra fija en lugar del selector. «Guardar cambios» vuelve a la ficha.
- **Solicitar adopción**: el pie de la ficha se oculta si la publicación no está `Activa`.

## 6. Reglas de negocio y validaciones

1. **Quién gestiona** (`puedeEditarPublicacion`, único punto de decisión):
   - perfil personal: quien la publicó, sobre una mascota personal;
   - perfil de refugio: cualquier miembro del refugio dueño de la mascota.
2. Cada campo editable sigue las mismas reglas que al crear (backend siempre, front para UX).
3. Una publicación **finalizada es terminal**: no se edita ni cambia de estado, ni a mano ni
   automáticamente. La mascota sí se puede volver a publicar en un aviso nuevo, que
   **reemplaza** al finalizado: el viejo se da de baja (lógica) al crear el nuevo.
4. **Transiciones automáticas** (`sincronizarConEstadoMascota`) solo pausan o finalizan:
   - mascota `Adoptado` / `Fallecido` → Finalizada;
   - mascota `En_Tratamiento` / `En_Transito` → Pausada;
   - mascota `Disponible` → **no reactiva**: una pausada queda pausada hasta que alguien la
     reactive a mano.
   - El estado con el que **nace** una publicación no cambia: `Disponible` → Activa,
     `En_Transito` → Pausada.
5. Reactivar exige mascota `Disponible` (si no, quedaría activa fuera del feed) y respeta la
   quota de 5 publicaciones activas del adoptante (regla transversal 7).
6. Solo una publicación `Activa` recibe solicitudes (`409 PUBLICACION_NO_ACTIVA`).
7. Edición y cambios de estado escriben en `LogAuditoria` (`MODIFICAR`, `CAMBIAR_ESTADO`).

## 7. Criterios de aceptación

- [ ] Quien publicó (o un miembro del refugio dueño) ve «Editar publicación» en la ficha; otro
      usuario no lo ve y el backend le responde 403.
- [ ] Al editar, cada campo rechaza lo mismo que en el alta, y la mascota no se puede cambiar.
- [ ] Se pueden quitar, agregar y reordenar fotos; la primera queda como portada.
- [ ] Una activa se puede pausar y finalizar; una pausada, reactivar y finalizar; una
      finalizada no ofrece acciones.
- [ ] Cada cambio de estado pide confirmación antes de ejecutarse.
- [ ] Una pausada desaparece del feed y no recibe solicitudes; al reactivarla vuelve.
- [ ] Si la mascota sale de tratamiento, la publicación sigue pausada hasta reactivarla.
- [ ] Una mascota con la publicación finalizada aparece de nuevo para publicar; al crear la
      publicación nueva, la finalizada desaparece de «Mis publicaciones».

## 8. Casos borde y errores

- Reactivar una publicación personal con 5 activas: 409 con el mensaje de la quota.
- Reactivar con la mascota en tratamiento: 409 `MASCOTA_NO_DISPONIBLE`.
- Si falla la escritura en base al editar, se borran las fotos nuevas ya subidas y no se
  toca ninguna de las viejas.
- Una galería que apunta a un archivo ajeno se rechaza (400): el cliente no puede enganchar
  fotos de otra publicación.
- Una publicación cargada antes del 2026-09-28 puede tener requisitos de 21 a 25
  caracteres. Se muestran igual, pero al editarla el backend los rechaza (400): hay que
  acortarlos o quitarlos para poder guardar.

## 9. Notas y decisiones

- 2026-09-27 — Alcance definido por el equipo sin HU: todos los campos del alta menos la
  mascota; estados manuales pausar / reactivar / finalizar con reconfirmación; las
  transiciones automáticas siguen, pero nunca reactivan.
- 2026-09-27 — `En_Transito` sigue pausando (no finaliza): se puede publicar una mascota que
  ya está en tránsito, y finalizarla dejaría ese aviso cerrado de nacimiento.
- 2026-09-27 — Finalizada es terminal y no se edita.
- 2026-09-27 — Un aviso finalizado no traba publicar de nuevo la mascota
  (`GET /mascotas/publicables` y `POST /publicaciones` solo miran la publicación en curso).
  Al publicarla de nuevo, las publicaciones finalizadas anteriores de esa mascota se dan de
  baja (lógica) en la misma transacción que el alta: dejan de aparecer en «Mis
  publicaciones» y quedan en `LogAuditoria` como `ELIMINAR`. Sus solicitudes quedan como
  historial.
- 2026-09-28 — Cada requisito pasa de ≤25 a ≤20 caracteres (backend y app): la ficha los
  muestra como medallitas y tienen que entrar en una línea.
- 2026-09-28 — La descripción pasa de ≤50 a ≤200 caracteres (backend y app): la ficha la
  muestra como texto libre en «Sobre <nombre>». La columna ya era `text`: no hay migración.
