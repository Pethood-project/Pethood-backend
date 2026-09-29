# Spec 020 — Mascotas perdidas y encontradas: registrar y listar avisos (HU-13.1)

**Estado:** APROBADA
**Sprint:** 13 · **Responsable:** Grupo 09 · **Última actualización:** 2026-09-29

## 1. Objetivo

Que cualquier usuario pueda publicar un aviso de un animal que perdió o que encontró, y que
todos puedan recorrer esos avisos en un portal (GUI-06) filtrando por fecha, estado, ubicación
y especie. Es la base del módulo 13: sobre estos avisos se construyen el reclamo con chat de
reencuentro (HU-13.2) y la gestión de estados (HU-13.3).

## 2. Alcance

- **Incluye:**
  - Alta del aviso (GUI-25) en estado Perdido o Encontrado, con 1 a 5 fotos.
  - Portal de avisos: orden por fecha de publicación descendente, paginación por cursor,
    filtros por fecha, estado, ubicación y especie (todos de selección múltiple menos la
    fecha). Muestra avisos en cualquier estado, Resuelto incluido.
  - Catálogos para la pantalla de filtros: estados del aviso y ubicaciones cargadas.
  - Datos del reportante en cada tarjeta, para el futuro botón "Abrir chat".
- **NO incluye:**
  - Botón "Abrir chat": nada en el sistema crea todavía una sala entre dos personas por un
    aviso. Queda para **HU-13.2** (ver §9, decisión 7).
  - Botón "Resuelto", cambios de estado, edición y baja del aviso: **HU-13.3**.
  - Catálogo de Provincia/Localidad: la ubicación es texto libre por ahora (§9, decisión 3).
  - Vincular el aviso a una mascota propia registrada (`mascota_id`): la columna existe pero
    el alta no la recibe todavía.

## 3. Entidades involucradas

`Animal_Perdido` y `Estado_Animal_Perdido` ya existían desde el schema inicial. Cambios sobre
`docs/MODELO_DATOS.md` (migración `20260929120000_hu131_animal_perdido_nombre_ubicacion_especie`):

- **`animal_perdido_nombre`** (texto, nullable): nombre del animal, hasta 30 caracteres.
  Obligatorio en un aviso Perdido, opcional en uno Encontrado.
- **`animal_perdido_ubicacion`** (texto, nullable): dónde se perdió o se encontró, en texto
  libre como `usuario_ubicacion`. Provisorio hasta que exista el catálogo de localidades.
- **FK `especie_id`** (nullable → `Especie`): para el filtro por especie.
- **`animal_perdido_fecha_suceso`** (fecha, nullable; migración
  `20260929130000_hu131_animal_perdido_fecha_suceso`): día en que se perdió o se encontró, que
  pide el campo "Fecha" del formulario (pantalla 26 del diseño). Obligatoria en el alta y no
  futura. Se sumó el 2026-09-29, al implementar el front.
- **`animal_perdido_imagenes`** (`text[]`; migración
  `20260929140000_hu131_animal_perdido_imagenes`): hasta 5 fotos en el orden de la galería del
  detalle. Mismo par que `publicacion_imagenes`: `animal_perdido_imagen_url` queda con la
  primera, que es la portada de la tarjeta. La migración copia la foto única de los avisos
  existentes como primer elemento. Se sumó el 2026-09-29, a pedido del equipo al probar GUI-25.
- **Índice parcial `animal_perdido_listado_idx`**: `(fecha_alta DESC, animal_perdido_id DESC)
  WHERE fecha_baja IS NULL`, que sostiene el orden y el cursor del portal. Va en SQL a mano
  porque Prisma no expresa índices parciales. Índice común sobre `especie_id`.

Las tres columnas son nullables en base y obligatorias en el DTO/servicio, igual que los
campos que HU-6.1 le sumó a `Mascota`: así los avisos cargados antes no quedan inválidos.

El catálogo `Estado_Animal_Perdido` ya estaba sembrado con Perdido, Encontrado y Resuelto.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | `/api/v1/animales-perdidos` | cualquier usuario | Publica un aviso (multipart) |
| GET | `/api/v1/animales-perdidos` | cualquier usuario | Portal: una página de avisos con filtros |
| GET | `/api/v1/animales-perdidos/ubicaciones` | cualquier usuario | Opciones del filtro por ubicación |
| GET | `/api/v1/estados-animal-perdido` | cualquier usuario | Estados del aviso (filtro y alta) |
| GET | `/api/v1/especies` | cualquier usuario | Ya existía: especies para el filtro y el alta |

**Contrato completo:** [`docs/api-mascotas-perdidas.md`](../api-mascotas-perdidas.md) — headers, query
params, body de request, respuestas de éxito y de error con sus códigos HTTP, notas para las
pantallas, decisiones con su motivo y pendientes para otros módulos. Esta spec no lo repite para
que no haya dos versiones que se desincronicen.

## 5. Pantallas (frontend)

- **GUI-06 Mascotas Perdidas (portal):** tarjetas con foto, nombre (o la especie si no tiene),
  descripción, ubicación, badge de estado y fecha. Scroll infinito con `proximoCursor`.
  Estados cargando / vacío / error. Botón "Filtros" que abre fecha (desde obligatoria, hasta
  opcional), estados, ubicaciones y especies, todos de selección múltiple menos la fecha.
  El botón "Abrir chat" queda preparado con `reportante` y `esPropio`, pero sin acción hasta
  HU-13.2. La tarjeta muestra la portada; el popup de detalle, todas las fotos en una galería
  que se desliza.
- **GUI-25 Nueva publicación perdida/encontrada:** de 1 a 5 fotos (cámara o galería, cada una
  con la vista previa para girarla, sin el recorte nativo del sistema), estado (Perdido/Encontrado), nombre (obligatorio sólo si es Perdido), especie,
  ubicación y descripción. Toma las coordenadas del dispositivo al guardar. Contadores de
  30 y 300 caracteres.

## 6. Reglas de negocio y validaciones

1. Cualquier usuario autenticado puede publicar, desde cualquiera de sus perfiles. El aviso es
   siempre de la persona. (backend)
2. El estado inicial es Perdido o Encontrado, nunca Resuelto. (backend; el front además filtra
   el selector con `seleccionableEnAlta`)
3. De 1 a 5 fotos, jpg/png/webp, ≤5 MB cada una. (backend y front)
4. Fecha del suceso obligatoria y no futura; el portal ordena y filtra por la fecha de
   publicación, no por esta. (backend y front)
5. Nombre ≤30, obligatorio sólo en Perdido; descripción ≤300 y obligatoria; ubicación ≤80 y
   obligatoria. (backend y front, con los límites espejados en `limits.ts`)
6. Coordenadas obligatorias y dentro de rango. (backend)
7. El portal muestra todos los estados y excluye los avisos dados de baja. (backend)
8. No hay tope de avisos activos por usuario: la cuota de la regla transversal 7 es de
   `Publicacion`. Si hace falta un límite anti-spam, se evalúa con HU-13.3.

## 7. Criterios de aceptación

- [x] Publicar un aviso Perdido con todos los campos → 201 y aparece primero en el portal.
- [x] Publicar un aviso Encontrado sin nombre → 201 con `nombre: null`.
- [x] Publicar un aviso Perdido sin nombre → 400 "El nombre es obligatorio".
- [x] Publicar con estado Resuelto → 400 `ESTADO_INVALIDO`.
- [x] Publicar sin foto, con un archivo no permitido o de más de 5 MB → 400.
- [x] El portal ordena del más reciente al más viejo e incluye avisos Resueltos.
- [x] Recorrer el portal página por página con el cursor da exactamente el mismo resultado que
      pedirlo entero.
- [x] Cada filtro funciona solo y combinado con los demás; "Godoy Cruz" encuentra también
      "godoy cruz".
- [x] Un filtro sin resultados devuelve 200 con lista vacía.
- [x] `fechaHasta` sin `fechaDesde` → 400.
- [x] `esPropio` es `true` sólo en los avisos del usuario autenticado.

Verificados contra el servidor local con los avisos del seed (2026-09-29).

## 8. Casos borde y errores

- **Cursor de un aviso inexistente:** 400 `CURSOR_INVALIDO`. Sin este chequeo Prisma devuelve
  una página vacía y el cliente creería que llegó al final.
- **Cursor de un aviso dado de baja mientras se scrolleaba:** sigue funcionando; la posición
  en el orden todavía existe.
- **Filtros distintos entre páginas:** el cursor es posicional, así que cambiar los filtros
  obliga al cliente a empezar de nuevo sin cursor.
- **Avisos cargados antes de esta spec:** pueden tener `nombre`, `ubicacion` o `especie` en
  `null`. El seed completa los suyos; los filtros por especie o ubicación simplemente no los
  traen.
- **Falla al guardar en base después de subir las fotos:** se borran todas.

## 9. Notas y decisiones

Decisiones tomadas con el equipo el 2026-09-29, a partir del relevamiento de la HU. El motivo
de cada una está en «Decisiones tomadas y por qué» del
[contrato](../api-mascotas-perdidas.md#decisiones-tomadas-y-por-qué).

1. **Alcance:** alta y portal. El botón "Abrir chat" pasa a HU-13.2 y el botón "Resuelto" a
   HU-13.3.
2. **Nombre:** columna nueva de hasta 30 caracteres, obligatoria sólo en Perdido.
3. **Ubicación:** texto libre y provisorio, hasta que el equipo defina el catálogo de
   Provincia/Localidad para toda la app (`DEUDA_TECNICA.md`, ítem 21). El filtro se arma con
   las ubicaciones ya cargadas.
4. **Especie:** FK directa en el aviso, no derivada de la mascota.
5. **Coordenadas:** obligatorias, pero son las del dispositivo al reportar y no se exponen.
6. **Paginación por cursor**, que queda como estándar de los listados de la app móvil.
7. **Chat fuera de alcance:** hace falta vincular la sala al aviso antes de crearla.
8. **Actor:** cualquier usuario autenticado, desde cualquiera de sus perfiles, sin exigir
   cuenta verificada.
9. **Imágenes:** hasta 5, con la misma cadena que las fotos de una publicación; el archivo
   demasiado grande responde 400, como en toda la API.
10. **Mensajes de validación:** se corrigieron `idSchema` (respondía en inglés y sin
    concordancia de género) y se sumó `limitePaginaSchema`.

Lo que queda para HU-13.2 (incluido lo abierto del botón de chat), HU-13.3, el catálogo de
localidades y la mascota propia está en «Pendiente para otros módulos» del
[contrato](../api-mascotas-perdidas.md#pendiente-para-otros-módulos).
