# Spec 030 — Trazabilidad del proceso de adopción

**Estado:** IMPLEMENTADA (backend y app móvil; pendiente de prueba manual y de migrar la base)
**Sprint:** 13 · **Responsable:** (asignar) · **Última actualización:** 2026-10-22

> Enmienda la spec 003 (Adopción y Favoritos) y toca la 004 (Notificaciones). Nace de `docs/ideas/adoption-process-improvements.md`, que conserva el pedido original y el razonamiento; esta spec es el contrato.

## 1. Objetivo

Que quien solicita una adopción o un tránsito vea que su solicitud avanza, y que el refugio (o quien publicó) tenga una revisión guiada con la trazabilidad de cada paso. Además, acompañar el momento emocional del proceso: un saludo que rompe el hielo en el chat, un cierre claro cuando algo no sale y un hito propio cuando la adopción se aprueba.

## 2. Alcance

- **Incluye:**
  - Dos estados nuevos (`Revisada`, `Cerrada`), el uso de `En_Revision`, y una **causa** estructurada para los estados finales.
  - Retiro de la solicitud por el adoptante.
  - Cierre automático de las solicitudes que quedan sin sentido (mascota adoptada, fallecida, publicación retirada, cuenta del publicante cerrada, vencimiento).
  - Preguntas personalizadas del refugio, con alcance por especie.
  - Revisión preliminar del lado del refugio (comparación lado a lado, perfil del solicitante, nota interna, rechazo con motivo).
  - El "motivo" pasa a ser el **saludo** y se envía como primer mensaje del chat.
  - Camino de estados, pantalla de solicitud enviada, pantalla de adopción aprobada y vibraciones en la app.
  - Textos con tono cuidado hacia el adoptante.
- **NO incluye:**
  - Sonido (queda para una iteración posterior).
  - Requisitos de la mascota estructurados o avisos automáticos de compatibilidad (descartado: los requisitos siguen siendo texto libre).
  - Preguntas propias para adoptantes particulares que publican su mascota.
  - Una causa "mascota perdida".
  - Entrevista o visita al hogar como etapa.
  - El seguimiento de tránsito con el período real (deuda técnica #43).
- **Enmienda:** spec 003 (§3, §4 y §6, reglas 1, 6 y 7), HU-7.4, HU-7.6 y HU-1.8; spec 004 (tipos y textos); `shared/alertasRefugio.ts` (spec 010).

## 3. Entidades involucradas

Ver `MODELO_DATOS.md`; se actualiza junto con la implementación.

**`Estado_Solicitud`** (catálogo; se agregan al seed): `Revisada` y `Cerrada`. Catálogo final: `Pendiente`, `En_Revision`, `Revisada`, `Aprobada`, `Rechazada`, `Cancelada`, `Cerrada`.

- **Abiertos (vivos):** `Pendiente`, `En_Revision`, `Revisada`.
- **Finales:** `Aprobada`, `Rechazada`, `Cancelada`, `Cerrada`. Los cuatro responden a quién decidió: `Aprobada` y `Rechazada`, el refugio; `Cancelada`, el adoptante; `Cerrada`, nadie (una circunstancia, con causa).

**`Solicitud_Estado`** suma `motivo` (enum `MotivoSolicitud`, nullable): la causa pertenece a la transición, junto con quién y cuándo.

| Estado | Motivos permitidos |
|---|---|
| `Rechazada` | `NO_CUMPLE_REQUISITOS` · `MASCOTA_CON_HOGAR` · `SIN_CONTACTO` · `OTRO` (obligatorio) |
| `Cancelada` | `RETIRADA_POR_SOLICITANTE` · `CUENTA_CERRADA_SOLICITANTE` (obligatorio) |
| `Cerrada` | `ADOPTADA_POR_OTRA_PERSONA` · `MASCOTA_FALLECIDA` · `PUBLICACION_RETIRADA` · `PUBLICANTE_CERRO_CUENTA` · `VENCIDA_SIN_RESPUESTA` (obligatorio) |
| resto | sin motivo (`null`) |

El service valida que el motivo corresponda al estado. Rótulos para el refugio: "No cumple los requisitos", "La mascota ya tiene hogar", "No pudimos contactarte", "Otro". Los informes de rechazo separan `MASCOTA_CON_HOGAR`, que no habla del criterio del refugio sobre la persona.

**`Solicitud`** suma `nota_interna` (texto, nullable, ≤ 1000): una sola nota del lado del refugio, editable, sin historial. `motivacion` no se renombra: pasa a ser el saludo (límite 20–300, antes 20–500; aplica al alta, no a las filas existentes).

**`Pregunta_Adopcion`** (nueva): `id`, `refugio_id`, `especie_id` (nullable; vacío = todas), `texto` (≤ 200), `tipo` (`TEXTO` | `SI_NO` | `OPCIONES`), `opciones` (text[], 2 a 6, solo en `OPCIONES`), `obligatoria`, `orden`, `activa` + auditoría completa. Baja lógica.

**`Solicitud_Respuesta`** (nueva): `id`, `solicitud_id`, `pregunta_adopcion_id` (nullable), `pregunta_texto` (copia de lo que se preguntó), `respuesta` (≤ 300), `orden` + auditoría.

Sin cambios en `Hogar`, `Publicacion` ni `Mascota`. `Publicacion.requisitos` sigue siendo `String[]` de texto libre.

## 4. API (contrato backend)

Cambios y endpoints nuevos. Todo bajo `/api/v1`; errores con el formato `{ error: { codigo, mensaje } }`.

| Método | Ruta | Auth | Descripción | Estado |
|---|---|---|---|---|
| GET | /solicitudes/elegibilidad?publicacionId= | JWT (perfil personal) | Suma `preguntas`: las del refugio aplicables a esa publicación (por especie), activas y ordenadas | cambia |
| POST | /solicitudes | JWT (perfil personal) | Acepta `respuestas`; el saludo viaja en `motivacion`. Emite el mensaje de saludo en el chat | cambia |
| GET | /solicitudes/:id | JWT (publicador **o** solicitante) | El detalle suma `motivo`, `chatId`, `mascotaAdoptadaId`, `respuestas`, `mascota.requisitos`, datos del solicitante y, solo para el publicador, `notaInterna` | cambia |
| POST | /solicitudes/:id/revision | JWT (publicador) | Inicia la revisión: `Pendiente → En_Revision`. Idempotente | nuevo |
| POST | /solicitudes/:id/revisada | JWT (publicador) | Marca como revisada: `Pendiente` o `En_Revision` → `Revisada` | nuevo |
| PATCH | /solicitudes/:id/estado | JWT (publicador) | `Aprobada` (solo desde `Revisada`) o `Rechazada` (desde cualquier etapa abierta, con `motivo`) | cambia |
| POST | /solicitudes/:id/retiro | JWT (solicitante, perfil personal) | El solicitante retira su solicitud abierta → `Cancelada` | nuevo |
| PUT | /solicitudes/:id/nota | JWT (publicador) | Guarda la nota interna (`{ texto }`, `null` o vacío la borra) | nuevo |
| GET | /preguntas-adopcion | JWT (perfil de refugio) | Las preguntas del refugio, activas e inactivas | nuevo |
| POST | /preguntas-adopcion | JWT (perfil de refugio) | Crea una pregunta | nuevo |
| PATCH | /preguntas-adopcion/:id | JWT (perfil de refugio) | Edita texto, tipo, opciones, obligatoriedad, alcance o `activa` | nuevo |
| DELETE | /preguntas-adopcion/:id | JWT (perfil de refugio) | Baja lógica | nuevo |
| PUT | /preguntas-adopcion/orden | JWT (perfil de refugio) | Reordena (`{ ids: number[] }`) | nuevo |
| GET | /solicitudes/recibidas, /mias | JWT | Aceptan los estados nuevos en `?estados=` | cambia |
| — | cron `cancelar-solicitudes-vencidas.job.ts` | usuario SISTEMA | Pasa a cubrir las tres etapas abiertas y deja `Cerrada · VENCIDA_SIN_RESPUESTA` | cambia |

**Crear una solicitud con respuestas:**

```json
POST /api/v1/solicitudes
{
  "publicacionId": 40,
  "tipoSolicitud": "Adopcion",
  "motivacion": "¡Hola! Soy Ana, vi a Toby y me encantaría conocerlo. Tengo patio y mucho cariño para darle.",
  "hogar": { "direccion": "...", "tipoVivienda": "Casa", "espacioExterior": "Patio", "tieneNinios": false,
             "tieneMascotas": false, "detalleMascotas": null, "experienciaPrevia": true, "horasSolo": 8, "descripcion": null },
  "respuestas": [
    { "preguntaId": 7, "respuesta": "Sí, hay una veterinaria a tres cuadras" },
    { "preguntaId": 9, "respuesta": "Castrarlo en los primeros meses" }
  ]
}
→ 201 { "id": 1042, "estado": { "id": 1, "nombre": "Pendiente" }, ..., "chatId": 87,
        "respuestas": [{ "pregunta": "¿Tenés veterinario de confianza cerca?", "respuesta": "Sí, hay una veterinaria a tres cuadras" }, ...] }
```

**Rechazar con motivo:**

```json
PATCH /api/v1/solicitudes/12/estado
{ "estado": "Rechazada", "motivo": "NO_CUMPLE_REQUISITOS", "comentario": "Buscamos una casa con patio cerrado." }
→ 200 { ..., "estado": { "id": 4, "nombre": "Rechazada" }, "motivo": "NO_CUMPLE_REQUISITOS", ... }
```

**Detalle (campos nuevos):**

```json
GET /api/v1/solicitudes/12
→ 200 {
  ...,
  "motivo": null,
  "chatId": 87,
  "mascotaAdoptadaId": null,
  "mascota": { "id": 5, "nombre": "Toby", "imagenUrl": "...", "requisitos": ["Casa con patio", "Sin otros perros"] },
  "solicitante": { "id": 3, "nombre": "Ana", "apellido": "Pérez", "imagenUrl": "...", "localidad": "Godoy Cruz",
                   "provincia": "Mendoza", "verificado": true, "miembroDesde": "2026-03-02" },
  "respuestas": [{ "pregunta": "¿Tenés veterinario de confianza cerca?", "respuesta": "Sí, hay una veterinaria a tres cuadras" }],
  "notaInterna": "Hablé con ella por teléfono, muy buena onda.",
  "historial": [{ "id": 3, "nombre": "Revisada", "motivo": null, "fecha": "2026-10-19T15:00:00.000Z" }, ...]
}
```

- `notaInterna` **solo se serializa si quien pregunta es el publicador**. La misma consulta sirve a las dos puntas, así que el service arma el DTO según el actor; nunca debe llegar al solicitante.
- `mascotaAdoptadaId` viene solo en una adopción `Aprobada` vista por su solicitante.
- El solicitante nunca recibe DNI, selfie, email ni teléfono de nadie: el contacto es por el chat.

**Errores nuevos** (los de 003 siguen vigentes):

| Código | HTTP | Mensaje | Cuándo |
|---|---|---|---|
| `REVISION_PENDIENTE` | 409 | Marcá la solicitud como revisada antes de aceptarla | Aprobar desde `Pendiente` o `En_Revision` |
| `SOLICITUD_YA_RESUELTA` | 409 | Esta solicitud ya fue resuelta | Cualquier transición desde un estado final |
| `VALIDACION` | 400 | Elegí un motivo | Rechazar sin `motivo`, o con uno que no corresponde al estado |
| `RESPUESTAS_INVALIDAS` | 400 | (primer issue; ej. "Falta responder: ¿Tenés veterinario…?") | Falta una obligatoria, una respuesta no está entre las opciones o se pasa del largo |
| `PREGUNTAS_DESACTUALIZADAS` | 409 | El refugio actualizó sus preguntas. Revisá el formulario antes de enviar | El conjunto aplicable cambió desde que el formulario se cargó (hay una obligatoria nueva) |
| `LIMITE_PREGUNTAS` | 409 | Llegaste al máximo de 5 preguntas activas | Alta o reactivación de una sexta |
| `NO_ENCONTRADO` | 404 | La solicitud no existe | No es del actor (mismo criterio que 003 §6.3) |

## 5. Pantallas (frontend)

**Camino de estados** (evoluciona `ProgresoSolicitud`; no se crea un componente nuevo). Puntos y líneas que se pintan con el **historial real**: lleno = ya pasó, anillo = actual, vacío = falta. Etapas: Enviada · En revisión · Revisada · Decisión. El último punto cambia según el final: ✓ en el color de la app (aprobada), ✗ (no aceptada), gris (cancelada o cerrada). Las etapas salteadas quedan vacías. Tres tamaños del mismo componente: con fechas en el detalle, compacto en las tarjetas del listado (reemplaza la barra de 3 segmentos) y en la tarjeta de la solicitud dentro del chat. Al cambiar de etapa mientras se mira, el punto nuevo se enciende con una vibración suave. `LineaTiempoEstados` queda abajo como **Historial**, con causas y comentarios.

**Rótulos (solo visuales; los nombres del catálogo no cambian):**

| Estado | Vista del adoptante | Vista del refugio |
|---|---|---|
| `Pendiente` | Enviada | Por revisar |
| `En_Revision` | En revisión | En revisión |
| `Revisada` | Revisada | Revisada |
| `Rechazada` | **No aceptada** | Rechazada |
| `Cancelada` / `Cerrada` | Cancelada / Cerrada | Cancelada / Cerrada |

**Formulario de solicitud** (`SolicitudModal`): los pasos pasan a ser tipo → hogar → **Tu saludo** → preguntas del refugio (solo si hay aplicables) → confirmación.
- *Tu saludo:* "Escribile un saludo al refugio" (en tránsito, adaptado). Ayuda: "Va a ser tu primer mensaje en el chat". Vista previa en burbuja de chat ("Así lo va a ver el refugio"). 20–300 caracteres.
- *Preguntas de {refugio}:* campo según `tipo` (texto, sí/no, opciones). Obligatorias marcadas. Con `PREGUNTAS_DESACTUALIZADAS` se recarga el paso con un aviso.

**Solicitud enviada** (`PasoExito`, siempre presente): un momento de 2–3 segundos con lavado de color de la app, círculo con tilde que se expande, "¡Solicitud enviada!" y "Le escribimos a {Refugio}", el camino de estados con el primer punto encendiéndose y **vibración de éxito**. **Avanza solo al chat**, donde ya está el saludo; tocar la pantalla salta antes. Con "reducir movimiento" activo, la animación se simplifica y dura menos. Si el backend no pudo abrir la sala (`chatId` nulo) la pantalla **se queda quieta** con "Ver mi solicitud" y "Volver". Se elimina la promesa fija de "48 horas".

**Revisión (lado del refugio)** — `app/solicitudes/[id].tsx` para el publicador. Se abre y dispara `POST /revision` si está `Pendiente`. Secciones, en orden:
1. Encabezado: mascota, tipo (y período si es tránsito), estado y camino de estados.
2. **Lo que pide {mascota} / lo que declaró {solicitante}:** una tarjeta de dos columnas; a la izquierda los requisitos de la mascota tal como los escribió el refugio, a la derecha las respuestas clave del hogar. **Sin semáforo ni avisos automáticos.**
3. Saludo ("Saludo de {nombre}").
4. Respuestas del hogar completas, preguntas del refugio con sus respuestas y el aviso de cambio de domicilio (ya existe).
5. Perfil del solicitante: nombre, foto, localidad y provincia, verificado, miembro desde, reputación y reseñas (`ResumenReputacion`) y acceso al perfil público.
6. **Nota del refugio:** un campo de texto editable (≤ 1000), con "Guardar"; sin autor ni fecha. La ven y editan todos los del lado del publicador.
7. Acciones al pie: `Marcar como revisada` y `Rechazar`; ya `Revisada`, `Aceptar` y `Rechazar`. Rechazar pide el motivo de una lista y admite un comentario. El modal pregunta "¿Rechazar la solicitud de {nombre}?".

La sección "Tu respuesta" (el `comentario` del refugio) hoy se muestra con ese título también al adoptante: para él pasa a llamarse **"Respuesta del refugio"**.

**Triage:** el listado del refugio y el panel de Inicio (`PanelSolicitudesRefugio`) se dividen en **Por revisar** (`Pendiente` + `En_Revision`), **Revisadas** y **Resueltas** (los cuatro finales). En el listado del adoptante, el filtro "Rechazadas" pasa a **"No aceptadas"**.

**Adopción aprobada (adoptante).** Pantalla completa y propia sobre la vista de una solicitud `Aprobada`. **Sin banderas de "ya la vio":** la animación de entrada (huellitas que suben, vibración de celebración) se dispara solo si la aprobación tiene menos de 3 días; pasado ese plazo la misma pantalla se ve tranquila.
- Foto de la mascota a ancho completo, esquinas inferiores muy redondeadas, degradé cálido; título en `font-titulo`: **"¡{Nombre} es parte de tu familia!"** y "{Refugio} aceptó tu solicitud el {fecha}".
- Mensaje del refugio (`comentario`) en una burbuja con su logo; sin comentario, una línea de bienvenida.
- "Tu camino hasta acá": camino de estados con fechas, último punto latiendo.
- "Lo que sigue", tres tarjetas: coordinar la entrega por el chat; el primer seguimiento llega a los 2 días con "¿Qué tal estuvo la primera noche en casa?" (spec 011); la mascota ya figura en Mis mascotas.
- Botones: "Hablar con {Refugio}" (abre la sala por `chatId`), "Ver a {Nombre}" (abre `mascotaAdoptadaId`) y "Compartir la noticia" (`Share` nativo).
- **Tránsito:** otra variante. "¡{Nombre} te espera en tu hogar de tránsito!", con el período y los recordatorios, sin la palabra "familia".
- Lado del refugio: al aceptar, una confirmación con lo que pasó solo (publicación finalizada, N solicitudes cerradas y avisadas).

**Solicitud cerrada / no aceptada / cancelada (adoptante).** El detalle muestra el mensaje de §5.1 según la causa, el camino de estados con su final y el historial. Salvo en `MASCOTA_FALLECIDA`, ofrece "Ver otras mascotas".

**Retirar solicitud.** Botón en el detalle del adoptante mientras la solicitud está abierta, con `ConfirmDialog`: "¿Querés retirar tu solicitud por {nombre}? Vas a poder volver a solicitarla si cambiás de idea."

**Preguntas para adoptantes (refugio).** Nueva entrada en `MENU_REFUGIO` de `app/(tabs)/perfil.tsx`, junto a Mascotas, Publicaciones, Reseñas y Campañas del refugio. Lista ordenable, alta/edición (texto, tipo, opciones, obligatoria, alcance Todas · Perros · Gatos), activar/desactivar y baja. Estados: cargando, vacío ("Todavía no agregaste preguntas. Las que sumes aparecen al final del formulario de quien quiera adoptar"), error. No existe para adoptantes particulares y no tiene entradas desde las pantallas de exploración de Adoptar.

**Vibraciones.** Un helper único (`vibrar.exito()`, `.error()`, `.advertencia()`, `.seleccion()`, `.toque()`, `.celebracion()`) sobre `expo-haptics` y una preferencia **"Vibraciones"** (activada por defecto) en Mi perfil, guardada en el dispositivo. Una vibración por gesto; ninguna al hacer scroll ni por cada tecla.

| Dónde | Vibración |
|---|---|
| `Toast` (éxito / advertencia / error) | éxito / advertencia / error — un solo punto cubre toda la app |
| `PressableAnimado` y `BotonTabCentral` | toque suave |
| Tabs inferiores | selección |
| Swipe de Adoptar | selección al cruzar el umbral de decisión; al soltar, guardar = medio + éxito, descartar = suave |
| Favorito (ficha y grilla) | toque; éxito al agregar |
| Chat | toque suave al enviar; selección al pasar el umbral de "deslizar para responder" |
| Formulario de solicitud | toque al avanzar de paso; error si falla la validación |
| Solicitud enviada | éxito con el tilde |
| Revisión | éxito al marcar como revisada; advertencia al rechazar; celebración al aceptar |
| Pantalla de aprobada | celebración sincronizada con las huellitas (solo si es reciente) |
| Camino de estados | selección al avanzar de etapa |
| Toggles, chips y segmentados | selección |
| `ConfirmDialog` destructivo | advertencia al abrirse |
| Pull-to-refresh | toque suave al dispararse |
| Seguimiento enviado / donación confirmada | éxito |

### 5.1 Textos al adoptante (tono)

Hay mucha carga emocional en este flujo. Reglas: no usar "rechazada" en lo que lee el adoptante ("no aceptada"); no culpar; agradecer siempre; no prometer lo que no es ("si vuelve" no vale para una mascota adoptada o fallecida); no entusiasmar de más en las etapas intermedias, porque una revisión no garantiza una aprobación; ofrecer una salida cuando la hay, y no ofrecer "ver otras mascotas" cuando una mascota falleció. En el front, la concordancia de género (él/ella) usa `textoSegunGenero`; en las notificaciones del backend se evitan los adjetivos con género.

**Motivos de una solicitud no aceptada** (debajo del comentario del refugio):

| Motivo | Texto |
|---|---|
| `NO_CUMPLE_REQUISITOS` | El refugio buscaba condiciones puntuales para {nombre} y esta vez no coincidieron con las de tu hogar. Gracias por animarte a adoptar: hay muchas mascotas que pueden encontrar su hogar con vos. |
| `MASCOTA_CON_HOGAR` | {nombre} ya encontró un hogar. Gracias por tu interés: hay otras mascotas esperándote. |
| `SIN_CONTACTO` | El refugio no pudo comunicarse con vos. Si todavía te interesa, escribile por el chat. |
| `OTRO` | Esta vez no pudimos avanzar con tu solicitud. Gracias por tu interés. |

**Causas de cierre:**

| Causa | Texto |
|---|---|
| `ADOPTADA_POR_OTRA_PERSONA` | {nombre} ya encontró su hogar. Gracias por haberte interesado: hay muchas mascotas esperándote. |
| `MASCOTA_FALLECIDA` | Con mucha tristeza te contamos que {nombre} falleció. Gracias por tu interés y tu cariño. |
| `PUBLICACION_RETIRADA` | La publicación de {nombre} se retiró, por eso cerramos tu solicitud. Si querés saber más, escribile al refugio por el chat. |
| `PUBLICANTE_CERRO_CUENTA` | Quien publicó a {nombre} cerró su cuenta, así que cerramos tu solicitud. Lamentamos las molestias. |
| `VENCIDA_SIN_RESPUESTA` | Pasó mucho tiempo sin novedades y cerramos tu solicitud por {nombre}. No es por vos: podés volver a solicitarla cuando quieras. |

**Notificaciones** (spec 004; los tipos son strings, no un enum de base: se agregan en `TITULOS_PUSH`):

| Tipo | Para | Canal | Título | Texto |
|---|---|---|---|---|
| `SOLICITUD_REVISADA` *(nuevo)* | adoptante | push + bandeja | Novedades de tu solicitud | {Refugio} ya revisó tu solicitud por {nombre}. En cuanto tengan una decisión te avisamos. |
| `SOLICITUD_RECHAZADA` | adoptante | mail + push | **Novedades de tu solicitud** (antes "Solicitud rechazada") | Tu solicitud por {nombre} no fue aceptada esta vez. Gracias por animarte a adoptar. Asunto del mail: "Novedades de tu solicitud por {nombre}" (antes "…fue rechazada"). |
| `SOLICITUD_MASCOTA_ADOPTADA_POR_OTRO` | adoptante | push | **Novedades de tu solicitud** (antes "Mascota adoptada") | {nombre} ya encontró su hogar. Gracias por haberte interesado: hay muchas mascotas esperándote. |
| `SOLICITUD_CERRADA` *(nuevo)* | adoptante | push + bandeja | Novedades de tu solicitud | El texto de la causa de arriba. |
| `SOLICITUD_RETIRADA` *(nuevo)* | publicador | bandeja | Solicitud retirada | {Nombre} retiró su solicitud por {mascota}. |
| `SOLICITUD_PENDIENTE_HACE_MUCHO` | publicador | mail | (igual) | Se extiende a `Revisada`: "Tenés una solicitud por {mascota} esperando tu decisión hace varios días". |
| `PUBLICACION_PAUSADA_CON_SOLICITUD` | adoptante | push | Publicación en pausa | Solo al **pausar**: "Pausaron por un tiempo la publicación de {nombre}. Tu solicitud sigue abierta y te avisamos cuando vuelva." |
| `FAVORITO_NO_DISPONIBLE` | quien lo tiene en favoritos | push | (igual) | Al pausar: "…Te avisaremos si vuelve." Al **finalizar**: "{nombre}, que tenías en favoritos, ya no está disponible para adopción." |
| `FAVORITO_ADOPTADO` | quien lo tiene en favoritos | push | (igual) | {nombre}, que tenías en favoritos, ya encontró su hogar. |

Siguen sin cambios: `SOLICITUD_NUEVA`, `SOLICITUD_ACEPTADA` ("¡Tu solicitud por {nombre} fue aceptada! Ya podés coordinar por el chat.") y `ADOPCION_COMPLETADA`. Los textos literales de HU-7.1 ("No podés solicitar otra mascota", "Tenés que verificarte antes de solicitar una adopción") quedan como están: los fija la HU.

## 6. Reglas de negocio y validaciones

Las del backend se validan siempre; el frontend repite lo que mejora la UX.

1. **Catálogo y estados.** Una única fuente (en `shared`, nombre de archivo en inglés) define `ESTADOS_ABIERTOS`, los finales y los motivos permitidos por estado. Reemplaza las 5 copias de `ESTADOS_SOLICITUD_ABIERTA` (`shared/alertasRefugio.ts`, `mascotas.service.ts`, `admin-mascotas.service.ts`, `perfil-refugio.service.ts`, `usuarios.repository.ts`) y los 5 chequeos `=== 'Pendiente'` (`admin-usuarios.repository.ts`, `solicitudes.repository.ts` en `listarPendientesDePublicacion`, `listarOtrasPendientesDePublicacion`, `contarPendientesDeUsuario` y `aprobarAdopcion`).
2. **Transiciones.** Cualquier otra combinación devuelve `409`.

   | Desde | Hacia | Quién |
   |---|---|---|
   | `Pendiente` | `En_Revision` | publicador, al abrir la revisión |
   | `Pendiente`, `En_Revision` | `Revisada` | publicador |
   | `Revisada` | `Aprobada` | publicador |
   | `Pendiente`, `En_Revision`, `Revisada` | `Rechazada` | publicador, con motivo |
   | `Pendiente`, `En_Revision`, `Revisada` | `Cancelada` | solicitante (retiro o cierre de cuenta) |
   | `Pendiente`, `En_Revision`, `Revisada` | `Cerrada` | sistema, con causa |

3. **Revalidación atómica.** Toda transición se escribe en una transacción `Serializable` que revalida el estado vigente al escribir (como `resolverSiPendiente` en 003 §6.4): si dos acciones compiten, gana una y la otra recibe `409`.
4. **`En_Revision` es idempotente.** `POST /revision` sobre una solicitud que ya no está en `Pendiente` responde `200` con el detalle sin cambios. Solo actúa si quien llama es del lado del publicador; el solicitante que abre su propio detalle no dispara nada.
5. **Aprobar exige `Revisada`.** Rechazar se puede desde cualquier etapa abierta y siempre con motivo.
6. **"Abierta" se define por el estado vigente.** Hoy `buscarVivaDeUsuarioEnPublicacion` y otras lecturas usan `fechaBaja`/`fechaRespuesta` como atajo; pasan a mirar el estado vigente contra `ESTADOS_ABIERTOS`. El tope de 5 (regla transversal 7) cuenta las tres etapas abiertas, y la solicitud duplicada, también.
7. **Los estados finales no dan de baja la solicitud.** `Cancelada` y `Cerrada` dejan la solicitud visible con su estado final y su causa: el adoptante tiene que poder leer qué pasó. La marca de SISTEMA queda en el `usuarioAlta` de la fila de `Solicitud_Estado`. Esto reemplaza la baja lógica de HU-7.6 y la de HU-1.8 sobre la solicitud (ver §9). Mientras tanto, todas las lecturas (`buscarConDetalle`, `listarDelSolicitante`, `listarDelActor`) filtran `fechaBaja: null`, así que una solicitud con baja desaparecería para el adoptante sin explicación.
8. **Un único punto de cierre.** El service tiene una función que, dado un conjunto de solicitudes abiertas y una causa, las pasa a `Cerrada` (transacción `Serializable` por solicitud), deja `LogAuditoria` (acción `CERRAR`, detalle con la causa) y avisa. Lo usan:
   - **Aprobar una adopción** (`aprobarAdopcion`): las demás abiertas de la publicación — no solo las `Pendiente` — pasan a `Cerrada · ADOPTADA_POR_OTRA_PERSONA`, no a `Rechazada`. Desaparece `COMENTARIO_RECHAZO_POR_ADOPCION`.
   - **La mascota pasa a `Fallecido`** (`MASCOTA_FALLECIDA`) o **`Adoptado` por fuera del flujo** (`ADOPTADA_POR_OTRA_PERSONA`), vía `sincronizarConEstadoMascota`. Idempotente: si ya no queda ninguna abierta, no hace nada.
   - **Finalizar o retirar la publicación a mano**, o darla de baja por moderación (`PUBLICACION_RETIRADA`).
   - **Quien publicó cierra su cuenta** (`PUBLICANTE_CERRO_CUENTA`; `darDeBajaCuenta`).
   - **El cron** (`VENCIDA_SIN_RESPUESTA`).

   **Pausar no cierra**: es reversible; solo se avisa.
9. **Aprobar un tránsito** no cierra las otras solicitudes (como hoy): la mascota vuelve al refugio.
10. **Retiro.** Solo el solicitante, desde su perfil personal, sobre una solicitud abierta propia. Libera el cupo del tope de 5 y avisa al publicador en la bandeja, sin push.
11. **Baja de cuenta del solicitante** (HU-1.8): sus solicitudes abiertas pasan a `Cancelada · CUENTA_CERRADA_SOLICITANTE`, sin baja lógica sobre la solicitud (regla 7). La cuenta, sus mascotas particulares, publicaciones y favoritos siguen con la baja de siempre.
12. **Cron (HU-7.6).** Toma las solicitudes abiertas cuyo **estado vigente** lleva más de `tipoSolicitud.secuenciaDias` días sin cambiar (una solicitud que se mueve no vence) y las pasa a `Cerrada · VENCIDA_SIN_RESPUESTA`. El aviso al publicador a los 3 días se extiende de `Pendiente` a `Revisada` (hay trabajo hecho esperando una decisión); `En_Revision` no tiene aviso propio, pero entra en las "demoradas" del dashboard.
13. **Dashboard del refugio (spec 010).** `Revisada` entra en `ESTADOS_ABIERTOS`, así que cuenta en "solicitudes demoradas" (5 días sin cambiar de estado) y en el filtro `?demoradas=true`.
14. **Saludo.** `motivacion` se valida con 20–300 caracteres (`limits.ts`, espejo en el front). Al crear la solicitud, `asegurarChatDeSolicitud` deja la tarjeta (SISTEMA) y, justo después, **el saludo como mensaje del adoptante**, sin duplicar si se reintenta. Si la sala ya existía entre las mismas partes, el saludo cae en esa sala junto a la tarjeta nueva. Dispara la notificación normal de mensaje nuevo. Es best-effort: si falla, la solicitud ya está creada.
15. **Preguntas.**
    - Solo las gestiona un miembro del refugio, con el perfil de refugio activo.
    - Máximo **5 activas** por refugio. Texto ≤ 200; en `OPCIONES`, entre 2 y 6 opciones.
    - Aplican a una publicación si `especie_id` es nulo o coincide con la especie de su mascota (`Mascota → Raza → Especie`).
    - Al crear la solicitud, el service valida contra las aplicables en ese momento: obligatorias presentes, `SI_NO` como `"Sí"`/`"No"`, `OPCIONES` entre las ofrecidas, respuesta ≤ 300. Una respuesta a una pregunta que ya no está activa se ignora. Si apareció una obligatoria nueva que el formulario no conocía, `PREGUNTAS_DESACTUALIZADAS`.
    - Se guarda la **copia del texto** de cada pregunta: editar, desactivar o borrar una pregunta no altera lo ya respondido.
16. **Nota interna.** Una sola, ≤ 1000, la edita cualquiera del lado del publicador y la última escritura gana; no hay historial ni autoría. No se incluye nunca en el DTO del solicitante.
17. **Datos del solicitante que ve el publicador:** nombre, apellido, foto, localidad, provincia, verificado y "miembro desde" (`fechaAlta`); reputación y reseñas por el módulo existente. Nunca DNI, selfie, email ni teléfono.
18. **Auditoría.** Cada transición, el retiro y el cierre escriben en `LogAuditoria`. Las tablas y columnas nuevas llevan los campos de auditoría de la regla transversal 1.
19. **Documentos.** Se actualizan 003, 004 y 010, `MODELO_DATOS.md`, `REQUISITOS.md` (HU-7.4, HU-7.6, HU-1.8) y la ficha #19 de `DEUDA_TECNICA.md`.

## 7. Criterios de aceptación

**Estados y trazabilidad**
- [ ] Al abrir la revisión por primera vez, una solicitud `Pendiente` pasa sola a `En_Revision` y el adoptante la ve así, sin recibir un push.
- [ ] Abrir de nuevo, o abrirla el propio solicitante, no cambia nada ni da error.
- [ ] "Marcar como revisada" lleva la solicitud a `Revisada` y el adoptante recibe la notificación de §5.1.
- [ ] No se puede aceptar una solicitud en `Pendiente` o `En_Revision` (`REVISION_PENDIENTE`); sí rechazarla.
- [ ] Rechazar exige motivo; con uno que no corresponde al estado se rechaza el pedido.
- [ ] El historial muestra cada paso con su fecha y, en los finales, la causa.
- [ ] Las listas del refugio se pueden filtrar en "Por revisar", "Revisadas" y "Resueltas".

**Estados finales y cierres**
- [ ] Al aprobar una adopción, las demás solicitudes abiertas de la publicación (en cualquiera de las tres etapas) quedan `Cerrada · ADOPTADA_POR_OTRA_PERSONA` y sus dueños reciben el aviso, sin la palabra "adoptada por otra persona".
- [ ] Al aprobar un tránsito, las demás siguen abiertas.
- [ ] Si la mascota pasa a `Fallecido`, sus solicitudes abiertas quedan `Cerrada · MASCOTA_FALLECIDA` y el texto no ofrece "ver otras mascotas".
- [ ] Al finalizar o retirar una publicación, sus solicitudes abiertas quedan `Cerrada · PUBLICACION_RETIRADA`; al pausarla siguen abiertas y se avisa.
- [ ] Si quien publicó (particular) cierra su cuenta, las solicitudes que recibió quedan `Cerrada · PUBLICANTE_CERRO_CUENTA`, y siguen visibles para sus solicitantes.
- [ ] Si el solicitante cierra su cuenta, sus solicitudes abiertas quedan `Cancelada · CUENTA_CERRADA_SOLICITANTE`.
- [ ] El cron deja `Cerrada · VENCIDA_SIN_RESPUESTA` en las tres etapas abiertas, no pisa una resolución humana concurrente y es idempotente.
- [ ] Una solicitud `Cancelada` o `Cerrada` sigue en el listado y el detalle del adoptante, con su mensaje.
- [ ] El solicitante puede retirar una solicitud abierta propia y volver a solicitar la misma mascota después; no puede retirar una final ni una ajena.
- [ ] No quedan copias sueltas de `ESTADOS_SOLICITUD_ABIERTA` ni chequeos `=== 'Pendiente'`; una mascota con una solicitud `Revisada` no se puede eliminar.

**Saludo y primer mensaje**
- [ ] El paso se llama "Tu saludo", muestra la vista previa en burbuja y exige 20–300 caracteres.
- [ ] Al enviar, el chat tiene la tarjeta y, debajo, el saludo **como mensaje del adoptante**; el refugio recibe la notificación de mensaje nuevo.
- [ ] Reintentar el alta no duplica la tarjeta ni el saludo.
- [ ] Si el chat no se pudo abrir, la solicitud se crea igual y la pantalla de enviada se queda con los botones.

**Preguntas del refugio**
- [ ] El refugio crea, edita, ordena, activa/desactiva y da de baja preguntas; no puede tener más de 5 activas.
- [ ] Una pregunta con alcance "Perros" no aparece en la solicitud de un gato; una sin alcance aparece en las dos.
- [ ] Las preguntas aparecen después del saludo y antes de la confirmación; si no hay aplicables, el paso no existe.
- [ ] Las obligatorias no se pueden dejar vacías; una opción fuera de la lista se rechaza.
- [ ] La revisión muestra pregunta y respuesta tal como se hicieron, aunque el refugio edite o desactive la pregunta después.
- [ ] Un adoptante particular no ve ni puede usar esta sección.

**Revisión**
- [ ] La tarjeta "Lo que pide {mascota} / lo que declaró {solicitante}" muestra los requisitos tal cual y las respuestas del hogar, sin avisos automáticos.
- [ ] La nota interna se guarda y se edita; el solicitante nunca la recibe, ni en la respuesta ni en el historial.
- [ ] El publicador ve foto, localidad, provincia, verificación, antigüedad, reputación y reseñas, y no ve DNI, email ni teléfono.
- [ ] Rechazar pide el motivo y el adoptante lee el texto de §5.1, sin la palabra "rechazada".

**Pantallas y vibraciones**
- [ ] El camino de estados refleja el historial real, incluidas las etapas salteadas y los finales negativos, en detalle, listado y tarjeta del chat.
- [ ] La pantalla de enviada avanza sola al chat en unos segundos, se salta tocando y tiene su versión quieta de respaldo.
- [ ] La pantalla de aprobada muestra la animación solo con menos de 3 días de antigüedad, distingue adopción de tránsito y sus botones abren el chat y la mascota correctos.
- [ ] Las vibraciones de §5 funcionan y se pueden apagar desde Mi perfil.

## 8. Casos borde y errores

- Dos miembros del refugio abren la misma solicitud a la vez: el segundo `POST /revision` es idempotente. Dos acciones contrapuestas (aceptar y rechazar): una gana y la otra recibe `409`.
- El adoptante retira mientras el refugio acepta: una gana, la otra recibe `409 SOLICITUD_YA_RESUELTA`.
- El refugio edita preguntas mientras alguien llena el formulario: si apareció una obligatoria nueva, `PREGUNTAS_DESACTUALIZADAS` y el paso se recarga; si una pregunta se desactivó, su respuesta se ignora.
- Una pregunta con alcance de especie cuando el catálogo de especies no tiene la de la mascota: se trata como "todas".
- Solicitudes anteriores a esta spec: `Pendiente` y `En_Revision` siguen siendo estados válidos; las que ya están `Rechazada` con el comentario "La mascota fue adoptada por otra persona" quedan como están (no hay producción, no hay migración de datos).
- Solicitud sin hogar (anterior a HU-7.1): la tarjeta lado a lado muestra solo los requisitos y un vacío del lado del solicitante.
- Mascota con `requisitos` vacíos: la columna izquierda muestra "No pidió requisitos puntuales".
- El chat no se pudo abrir al crear: no hay saludo; cuando la sala se abra más adelante, `asegurarChatDeSolicitud` lo emite (idempotente).
- Dos miembros editan la nota a la vez: gana la última escritura, sin conflicto.
- Reduce motion / sin vibración en el dispositivo: la app se comporta igual sin esos efectos.
- Una mascota que pasa a `Adoptado` por la propia aprobación: el cierre automático de la sincronización no encuentra nada que cerrar (ya lo hizo la aprobación).

## 9. Notas y decisiones

- **2026-10-22 — Estados y causas.** Acordado: `En_Revision` automático y sin push; `Revisada` manual; `Cerrada` con causa estructurada; `Cancelada` solo por decisión del adoptante; aprobar exige `Revisada`; el tope de 5 cuenta todas las etapas abiertas; "mascota perdida" no es una causa. Se unifica la definición de "abierta" para no dejar huecos entre flujos.
- **2026-10-22 — Requisitos de la mascota en texto libre.** Se evaluó estructurarlos para comparar solos y se descartó: el costo (formulario más largo, y todas las publicaciones existentes quedarían sin datos) no compensa, y las necesidades no entran en opciones cerradas. La revisión los muestra lado a lado con las respuestas del hogar. Tampoco se usa el rasgo "Bueno con chicos" como señal: que falte no significa que la mascota no lo sea.
- **2026-10-22 — Preguntas por especie, no por mascota.** El banco es del refugio; el alcance es por especie porque cubre la diferencia entre perros y gatos sin una tabla intermedia por mascota.
- **2026-10-22 — Nota interna simple.** Un campo de texto editable, sin historial ni autoría, en lugar de una lista de notas.
- **2026-10-22 — Motivo de rechazo.** Se mantiene "La mascota ya tiene hogar" (se evaluó "Elegimos a otra persona" y se descartó por duro). Queda separado en los informes de rechazo.
- **A confirmar — HU-7.6 y HU-1.8 y la baja lógica (regla 7).** HU-7.6 pide "baja con `usuario_baja = SISTEMA`" y la baja de cuenta también da de baja la solicitud. Hoy todas las lecturas ocultan las solicitudes con baja, por lo que el adoptante nunca llegaría a ver que su solicitud se cerró ni por qué. Se propone dejar la solicitud visible y registrar a SISTEMA en `usuarioAlta` de la fila de estado; implica anotar el desvío en `REQUISITOS.md` §10, como se hizo con HU-7.1. Si se prefiere mantener la baja a la letra, la causa y el mensaje del adoptante hay que mostrarlos por otro lado.
- **A confirmar — Rótulo "No aceptada"** para el adoptante (el catálogo sigue siendo `Rechazada`), y la redacción de §5.1 en general: se ajusta en la revisión del equipo.
- **2026-10-22 — Desvíos menores en la implementación.** (1) `Solicitud.mascotaAdoptadaId`: columna nueva para que el adoptante llegue a la mascota que ahora es suya desde la pantalla de adopción aprobada. (2) El detalle suma `publicador` (nombre y foto de quien responde) y el resumen de la lista trae `motivo` e `historial`, para dibujar el camino sin pedir el detalle de cada una. (3) Pasar de `Pendiente` a `Revisada` directo está permitido (abrir la revisión es un paso automático, no obligatorio) y marcar como revisada una ya revisada es idempotente. (4) Tipos de notificación nuevos: `SOLICITUD_REVISADA_SIN_DECISION` y `SOLICITUD_CERRADA_VENCIDA`. (5) La causa `PUBLICACION_RETIRADA` dice "escribile por el chat" en lugar de nombrar al refugio, porque la publica también una persona. (6) Al finalizar una publicación o dar de baja a alguien, cerrar las solicitudes abiertas es de mejor esfuerzo: si falla, no impide la acción principal y queda registrado. (7) La preferencia de vibraciones vive en el dispositivo (almacenamiento seguro), no en el servidor.
- **Aviso en el chat.** Cada vez que la solicitud pasa a revisada, aceptada o no aceptada, SISTEMA deja una línea en la sala (`mensaje_tipo = SOLICITUD_ESTADO`, texto neutro porque lo leen las dos partes; tocarla abre la solicitud). Es best-effort y sin push propio. La tarjeta de la solicitud en el chat pasó a ser angosta y va del lado de quien la envió (`SolicitudEnChat.usuarioId`).
- **Feed de Adoptar.** Una publicación que la persona ya solicitó (abierta o aprobada) no vuelve a salir en el mazo.
- **Reseñas del solicitante.** La revisión muestra solo las 3 más recientes; el resto está en su perfil.
- **Favoritos y solicitud retirada.** `solicitudAbiertaId` se decide por el estado vigente y no por `fechaRespuesta`: una retirada o cerrada no pasa por esa fecha y la tarjeta seguía diciendo "Ya solicitada". Se suma `solicitudCanceladaId` para que la tarjeta diga "Cancelada" en gris. El aviso de aceptada en el chat lleva la solicitud (nombre y foto de la mascota) y se dibuja como tarjeta.
- **Requiere build nativo:** `expo-haptics` es un módulo nativo. Hace falta un dev-client o APK nuevo; Expo Go ya lo trae. Las vibraciones de "deslizar para refrescar" quedaron fuera.
- **Despliegue:** aplicar la migración `20261022150000_solicitud_trazabilidad` y volver a correr el seed.
- **Deuda relacionada:** #19 (esta spec la reduce a la pausa), #43 (seguimiento del tránsito con 180 días fijos), #44 y #45.
