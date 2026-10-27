# Mejora del proceso de adopción — trazabilidad, preguntas del refugio y primer contacto

**Estado:** PASÓ A LA SPEC 030 (`docs/specs/030-adoption-traceability.md`), que manda sobre este documento · **Fecha:** 2026-10-22 · **Base del análisis:** `dev` al 2026-10-22
**Módulos:** 7 (Solicitudes) y 5 (Chat), con retoques en Mascotas/Publicaciones y la app mobile en general
**Rama:** `feature/mod7-trazabilidad-adopcion` (mismo nombre en backend y frontend)
**Destino:** se vuelca en `docs/specs/003-adopcion-favoritos.md` (estados, reglas, API) y se actualizan los criterios de HU-7.x en `REQUISITOS.md`.

---

## 0. Decisiones tomadas

1. **Estados.** La solicitud pasa por `Pendiente` (se muestra como **Enviada**) → `En_Revision` → `Revisada` → `Aprobada` | `Rechazada`. Los finales son cuatro, según quién decidió: `Aprobada`/`Rechazada` (el refugio), `Cancelada` (el adoptante) y `Cerrada` (nadie decidió: una circunstancia, con causa).
2. **`En_Revision` es automático:** pasa sola cuando el refugio abre la revisión por primera vez (solo desde `Pendiente`, una vez, y solo si abre el refugio). No manda push; se ve en el camino de estados.
3. **Aprobar exige haber pasado por `Revisada`.** Rechazar se puede desde cualquier etapa viva.
4. **El tope de 5 solicitudes cuenta todas las vivas** (`Pendiente`, `En_Revision`, `Revisada`).
5. **`Cerrada` guarda su causa de forma estructurada** (no solo en un comentario) para que las estadísticas sean claras. Causas: adoptada por otra persona, mascota fallecida, publicación retirada, quien publicó cerró su cuenta, venció sin respuesta. **No se suma "mascota perdida".** No hay backfill de datos: todavía no hay producción.
6. **Retirar solicitud:** el adoptante puede retirar la suya mientras esté viva. Hoy **no existe** (la cancelación actual es solo por cierre de cuenta o por el cron).
7. **Unificar** la definición de "solicitud abierta" y evitar huecos entre flujos (ver F1).
8. **Requisitos de la mascota: texto libre, siempre.** Nada de campos estructurados ni avisos automáticos de compatibilidad. La revisión muestra **lado a lado** lo que pide la mascota y lo que declaró el solicitante.
9. **Preguntas personalizadas del refugio:** un banco por refugio, con alcance opcional **por especie** (perros / gatos / todas). No se personalizan mascota por mascota. Los adoptantes particulares no tienen preguntas propias.
10. **El "motivo" pasa a ser el "saludo":** redactado como mensaje, con vista previa de burbuja, máximo ~300 caracteres (mínimo 20), y se envía como primer mensaje del chat. El campo técnico `motivacion` no se renombra.
11. **Revisión con una nota interna del refugio** (un solo campo de texto editable, sin historial ni autoría; el adoptante no lo ve) y **rechazo con motivo** de una lista corta.
12. **Pantalla de adopción aprobada propia**, sin banderas de "ya la vio": la animación se dispara por antigüedad de la aprobación.
13. **Camino de estados** (puntos y líneas que se pintan) en el detalle y, compacto, en el listado y en la tarjeta del chat.
14. **"Solicitud enviada" se mantiene** como un momento breve y animado (estilo pago con QR) que avanza solo al chat.
15. **Vibraciones** (`expo-haptics`) en toda la app donde ayuden; **el sonido queda para después**. Se pueden agregar dependencias de Expo si mejoran la experiencia.
16. **Sin mocks:** las pantallas nuevas se arman con los componentes y la paleta existentes y con la estética Organic de la app.
17. **Otras inconsistencias** que aparezcan, aunque no sean de este tema, se anotan en `DEUDA_TECNICA.md` (ya agregadas: ítems 43, 44 y 45; el 19 se reduce con este trabajo).

---

## 1. Pedido original (registro)

Hoy el adoptante solicita, el refugio ve su perfil y aprueba. Funciona, pero deja muy poca trazabilidad en el medio. Lo que se quiso agregar:

1. **Etapas intermedias** (1 o 2) entre "solicitud enviada" y "aprobada/rechazada", para que el adoptante vea que su solicitud avanza y el refugio distinga lo que falta revisar de lo ya revisado.
2. **Preguntas personalizadas del refugio**, que se suman al formulario inicial (no es un paso aparte), después de las preguntas normales.
3. **Revisión preliminar**: una pantalla donde el refugio analiza todo (respuestas, datos personales, reseñas) y lo contrasta con lo que pide la mascota, para rebotar fácil lo no compatible o ignorarlo y seguir. Al final, un botón "marcar como revisada".
4. **Primer mensaje al crear la solicitud**, para romper el hielo en el chat (como en Airbnb).
5. **Mejorar la pantalla de "solicitud enviada"**, para acompañar lo que siente quien quiere adoptar.
6. **Mejorar la pantalla de "solicitud aceptada"**: es un hito muy grande en la vida de la persona y merece protagonismo.
7. Cualquier otra mejora que tenga sentido.

---

## 2. Cómo funciona hoy (verificado en el código)

**Estados** (`Estado_Solicitud`, seed): `Pendiente`, `En_Revision`, `Aprobada`, `Rechazada`, `Cancelada`.

- `En_Revision` existe en el catálogo y en la app, pero **ningún flujo del backend entra a ese estado**.
- `resolverSolicitud` solo acepta resolver desde `Pendiente` (si no, `409 SOLICITUD_YA_RESUELTA`). Destinos: `Aprobada` o `Rechazada`.
- Aprobar una **adopción** crea la mascota propia del adoptante, pasa la original a `Adoptado`, finaliza la publicación y **rechaza solas las demás solicitudes `Pendiente`** con el comentario fijo "La mascota fue adoptada por otra persona".
- Cada cambio de estado es una fila de `SolicitudEstado` con `usuarioAlta` y fecha: la base de trazabilidad ya está.
- `Cancelada` hoy se produce por dos caminos: el cron de 6 meses (solo desde `Pendiente`) y el cierre de cuenta (`usuarios.repository.darDeBajaCuenta`).

**Formulario del adoptante:** tipo → hogar → **motivo** → confirmación → éxito. `Solicitud.motivacion` es obligatorio (20–500) y hoy **solo se lee en el detalle; no llega al chat**.

**Chat:** al crear la solicitud, `asegurarChatDeSolicitud` abre o reutiliza la sala (es entre las partes, no entre solicitudes) y deja una tarjeta de tipo SOLICITUD emitida por SISTEMA. `POST /solicitudes` devuelve `chatId` y, desde el 2026-10-18, la app **lleva al adoptante directo a esa sala**; la pantalla de éxito (`PasoExito`) solo aparece si el backend no pudo abrirla. No hay ningún mensaje del adoptante.

**Detalle de la solicitud** (`app/solicitudes/[id].tsx`, igual para las dos puntas): respuestas del hogar, aviso de cambio de domicilio, ficha y reputación del solicitante, motivo, comentario, línea de tiempo y botones Aceptar/Rechazar (solo `Pendiente`). El botón "Contactar refugio" lleva al listado general de chats; el DTO del detalle no trae `chatId`.

**Requisitos de la mascota:** `Publicacion.requisitos` es `String[]` de texto libre (se carga con `TagInputField` en `CamposPublicacion`).

**Hogar del adoptante:** vivienda, espacio exterior, niños, otras mascotas, experiencia previa, horas solo, descripción.

**Lugares donde se repite qué es una solicitud "abierta"** (riesgo directo al agregar una etapa):
- 5 copias de `ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision']`: `shared/alertasRefugio.ts`, `mascotas.service.ts`, `admin-mascotas.service.ts`, `perfil-refugio.service.ts` y `usuarios.repository.ts`.
- 5 chequeos fijos `=== 'Pendiente'`: `admin-usuarios.repository.ts:296` y `solicitudes.repository.ts` (líneas 54, 76, 155 y 607).

**Mobile:** están instalados `react-native-reanimated` y `expo-linear-gradient`. No hay librería de vibración, de audio ni de SVG.

---

## 3. Resumen de funcionalidades

| # | Funcionalidad | Backend | Mobile |
|---|---|---|---|
| F1 | Etapas, estados finales, causas y retiro | estados, transiciones, cierres, constante única | filtros, textos |
| F2 | Preguntas del refugio (con especie) | 2 tablas + CRUD + validación en el alta | pantalla de configuración + paso en el formulario |
| F3 | Revisión preliminar | notas, rechazo con motivo, datos del perfil | pantalla de revisión |
| F4 | Saludo como primer mensaje | mensaje del adoptante en el alta | paso "Tu saludo" |
| F5 | Solicitud enviada (animación breve) | — | rediseño de `PasoExito` |
| F6 | Adopción aprobada | `chatId` y `mascotaAdoptadaId` en el detalle | pantalla nueva |
| F7 | Camino de estados | — | evolución de `ProgresoSolicitud` |
| F8 | Vibraciones | — | helper + puntos de integración |

---

## 4. Diseño

### F1 — Etapas, estados finales y causas

**Catálogo final** (se agregan `Revisada` y `Cerrada` al seed):

| Estado | Etiqueta al adoptante | Quién decidió |
|---|---|---|
| `Pendiente` | Enviada | — |
| `En_Revision` | En revisión | — |
| `Revisada` | Revisada | — |
| `Aprobada` | Aprobada | el refugio |
| `Rechazada` | Rechazada | el refugio |
| `Cancelada` | Cancelada | el adoptante |
| `Cerrada` | Cerrada | nadie: una circunstancia, con causa |

**Transiciones:**

```
Pendiente ──(refugio abre la revisión)──▶ En_Revision ──("Marcar como revisada")──▶ Revisada ──▶ Aprobada
    │                                          │                                        │
    └──────────────────────── Rechazada (desde cualquier etapa viva, con motivo) ◀──────┘
Cualquier etapa viva ──▶ Cancelada (el adoptante la retira o cierra su cuenta)
Cualquier etapa viva ──▶ Cerrada (circunstancia, con causa)
```

- `Pendiente → Revisada` directo también es válido (si el refugio marca como revisada sin haber disparado la apertura).
- `En_Revision` es un `POST` idempotente que dispara el front al abrir la revisión (nunca un efecto de un `GET`); solo actúa desde `Pendiente` y solo si quien abre es del lado del publicador.
- Ante `Revisada` hay push al adoptante; ante `En_Revision` no.

**Causa de cierre.** Una columna `motivo` (enum) en `SolicitudEstado`: la causa pertenece a la transición, junto con quién y cuándo. Valores permitidos por estado:

| Estado | Motivos |
|---|---|
| `Rechazada` (lo elige el refugio) | no cumple los requisitos · la mascota ya tiene hogar · no pudimos contactarte · otro |
| `Cancelada` | retirada por el solicitante · cuenta cerrada por el solicitante |
| `Cerrada` | adoptada por otra persona · mascota fallecida · publicación retirada · quien publicó cerró su cuenta · venció sin respuesta |

> Se mantiene "la mascota ya tiene hogar" como motivo de rechazo manual (se evaluó "elegimos a otra persona" y se descartó por duro). En los informes de rechazo ese motivo se separa, porque no habla del criterio del refugio sobre la persona.

`Solicitud.comentario` sigue siendo el texto libre del refugio; el motivo es la categoría para estadísticas. Con esto: *tasa de rechazo* = `Rechazada` (criterio del refugio), *abandono* = `Cancelada`, *demanda sin cubrir* = `Cerrada`.

**Mapa de flujos (todos terminan en una de las cuatro categorías):**

| Flujo | Hoy | Queda |
|---|---|---|
| El refugio acepta | `Aprobada` | igual |
| El refugio rechaza | `Rechazada` | igual, con motivo |
| Se aprueba una adopción: las demás vivas | `Rechazada` con comentario fijo | `Cerrada` · adoptada por otra persona (alcanza a `En_Revision` y `Revisada`) |
| El adoptante cierra su cuenta | `Cancelada` | `Cancelada` · cuenta cerrada |
| Quien publicó (particular) cierra su cuenta | `Cancelada` en las que recibió | `Cerrada` · quien publicó cerró su cuenta |
| Cron de 6 meses | `Cancelada`, solo `Pendiente` | `Cerrada` · venció sin respuesta, desde cualquier etapa viva |
| Mascota pasa a `Fallecido` | la publicación se finaliza; las solicitudes quedan abiertas | `Cerrada` · mascota fallecida |
| Mascota pasa a `Adoptado` por fuera del flujo | ídem | `Cerrada` · adoptada por otra persona |
| Publicación finalizada o retirada a mano | quedan abiertas | `Cerrada` · publicación retirada |
| Publicación pausada | quedan abiertas, se avisa | igual: es reversible, no se cierra |
| El adoptante retira su solicitud | **no existe** | `Cancelada` · retirada (botón nuevo) |
| Admin | solo lectura | sin cambios |

**Retirar solicitud.** Botón en el detalle del adoptante, con confirmación (`ConfirmDialog`), disponible en `Pendiente`, `En_Revision` y `Revisada`. Libera el cupo del tope de 5 y avisa al refugio en la bandeja (sin push).

**Unificación.** Una única fuente (`shared`, nombre de archivo en inglés según la convención) con `ESTADOS_ABIERTOS`, los estados finales y el motivo permitido por estado. Reemplaza las 5 copias y los 5 chequeos fijos de §2. Con esto agregar un estado deja de ser una búsqueda a mano.

**Cierres automáticos.** Un único punto del service que, dado un conjunto de solicitudes vivas y una causa, las pasa a `Cerrada` y avisa. Lo usan: la aprobación de una adopción, la sincronización de la publicación con el estado de la mascota (`Fallecido`, `Adoptado`), finalizar/retirar a mano, la baja de cuenta del publicante y el cron. Cierra parcialmente la deuda técnica **#19** (queda la pausa).

**Cron.** Pasa a cubrir `Pendiente`, `En_Revision` y `Revisada`, y deja `Cerrada · venció sin respuesta`. Antes de vencer, recordatorio al refugio (hoy ya hay uno a los 3 días para `Pendiente`; se extiende a `Revisada`). `shared/alertasRefugio.ts` suma `Revisada` a las "demoradas".

### F2 — Preguntas personalizadas del refugio

**Modelo:**
- `pregunta_adopcion`: `id`, `refugio_id`, `especie_id` (nullable: vacío = todas las especies), `texto` (≤ 200), `tipo` (`TEXTO` | `SI_NO` | `OPCIONES`), `opciones` (text[], solo en `OPCIONES`), `obligatoria`, `orden`, `activa` + auditoría completa.
- `solicitud_respuesta`: `id`, `solicitud_id`, `pregunta_adopcion_id` (nullable), **`pregunta_texto` (copia de lo que se preguntó)**, `respuesta`, `orden` + auditoría. La copia es lo que mantiene la trazabilidad si el refugio edita o desactiva la pregunta después.
- Tope: **5 preguntas activas por refugio**; respuestas ≤ 300 caracteres.
- El alcance por especie sale casi gratis: `Mascota → Raza → Especie` ya existe. Es un filtro en la consulta, sin tabla intermedia por mascota.

**Flujo del adoptante.** El formulario suma un paso **"Preguntas de {refugio}"** después de hogar y saludo, antes de la confirmación; no aparece si no hay preguntas aplicables a esa especie. Las preguntas viajan en `GET /solicitudes/elegibilidad?publicacionId=`. `POST /solicitudes` acepta `respuestas: [{ preguntaId, respuesta }]` y el service valida contra las preguntas aplicables **en ese momento**.

**Configuración del refugio.** Nueva entrada **"Preguntas para adoptantes"** en `MENU_REFUGIO` (`app/(tabs)/perfil.tsx`), junto a Mascotas, Publicaciones, Reseñas y Campañas del refugio: lista ordenable, alta/edición, activar/desactivar y selector de alcance (Todas · Perros · Gatos). Vive en la gestión del refugio y **no** en las pantallas de exploración de Adoptar. Los adoptantes particulares no tienen esta sección.

### F3 — Revisión preliminar

La pantalla de detalle del refugio pasa a ser una **revisión guiada**, en este orden:

1. **Encabezado:** mascota, tipo (adopción o tránsito + período), estado y el **camino de estados** (F7).
2. **Lo que pide {mascota} / lo que declaró {solicitante}:** una tarjeta con dos columnas. A la izquierda, los requisitos de la mascota **tal como los escribió el refugio**; a la derecha, las respuestas clave del hogar (vivienda, espacio exterior, niños, otras mascotas, horas solo, experiencia). **Sin semáforo ni avisos automáticos**: lo evalúa la persona, y lo que falte se habla por el chat.
3. **Saludo** del solicitante (el mismo texto que ya vio en el chat).
4. **Respuestas del hogar** completas y, si hay, **preguntas del refugio** con sus respuestas. El aviso de cambio de domicilio sigue (ya existe).
5. **Perfil del solicitante:** nombre, foto, ubicación (localidad y provincia), si está verificado, cuánto hace que es miembro, reputación y reseñas (`ResumenReputacion` ya existe) y un acceso al **perfil público** (`app/perfiles/usuario`). No se muestran DNI, selfie, email ni teléfono: el contacto es por el chat.
6. **Nota del refugio:** un único campo de texto editable (≤ 1000), privado del lado del publicador (miembros del refugio, o quien publicó si es particular). Sin historial, autor ni fecha: gana la última escritura.
7. **Acciones al pie:** `Marcar como revisada` (principal) y `Rechazar`. Ya `Revisada`, aparecen `Aceptar` y `Rechazar`. El rechazo pide un **motivo** de la lista (F1) y admite un comentario opcional; el adoptante lo ve redactado con calidez.

**Triage en el listado del refugio:** pestañas **"Por revisar"** (`Pendiente` + `En_Revision`), **"Revisadas"** y **"Resueltas"**, y lo mismo en el panel de Inicio (`PanelSolicitudesRefugio`). El backend ya filtra por varios estados (`?estados=`).

### F4 — El saludo como primer mensaje

- **Paso "Tu saludo".** La pregunta pasa a ser "Escribile un saludo al refugio" (en tránsito, adaptado). Texto de ayuda: "Va a ser tu primer mensaje en el chat". Ejemplo: "¡Hola! Soy Ana, vi a Toby y me encantaría conocerlo…". **Vista previa** debajo, como burbuja de chat ("Así lo va a ver el refugio"). Mínimo 20, máximo ~300 (constante en `limits.ts`, espejo en el front).
- **Envío.** Se manda **como el adoptante** (no como SISTEMA), justo después de la tarjeta de la solicitud, dentro del camino idempotente de `asegurarChatDeSolicitud`: un reintento no duplica ni tarjeta ni mensaje. Si la sala ya existía entre las mismas partes, el saludo cae igual en esa sala junto a la tarjeta nueva. Dispara la notificación normal de mensaje nuevo al refugio.
- **Best-effort:** si el mensaje falla, la solicitud ya está creada y no se cae.
- **Del lado del refugio** se lee como "Saludo de {nombre}".

### F5 — Solicitud enviada (estilo pago con QR)

Un momento de 2–3 segundos que avanza solo al chat, donde ya está el saludo:

1. Un lavado de color de la app y un círculo que se expande con el **tilde** (resorte de `reanimated`; no hace falta SVG).
2. Texto: "¡Solicitud enviada!" y "Le escribimos a {Refugio}".
3. El **camino de estados** con el primer punto encendiéndose, para que se entienda qué sigue.
4. **Vibración de éxito** sincronizada con el tilde. El sonido queda para más adelante.
5. Avanza solo al chat; **tocar la pantalla salta antes**. Con "reducir movimiento" activo, la animación se simplifica y dura menos.
6. Si el backend no pudo abrir la sala (`chatId` nulo), es la misma pantalla pero **se queda quieta** con "Ver mi solicitud" y "Volver" (lo que hace hoy `PasoExito`).
7. Se elimina la promesa fija de "48 horas".

### F6 — Pantalla de adopción aprobada

Pantalla completa y propia para el adoptante, sobre la vista permanente de una solicitud `Aprobada`. **Sin banderas de "ya la vio"**: la animación de entrada (huellitas que suben con `reanimated` + vibración de celebración) se dispara solo si la aprobación es de hace menos de 3 días; pasado ese plazo, la misma pantalla se ve tranquila. No requiere columna ni almacenamiento.

Composición (de arriba abajo):
- **Foto** de la mascota a ancho completo, esquinas inferiores muy redondeadas y degradé cálido (`expo-linear-gradient`), con el título en `font-titulo`: **"¡{Nombre} es parte de tu familia!"** y debajo "{Refugio} aceptó tu solicitud el {fecha}".
- **Mensaje del refugio** (`comentario`), en una burbuja con el logo del refugio; si no escribió nada, una línea de bienvenida por defecto.
- **Tu camino hasta acá:** el camino de estados completo con fechas ("esperaste 4 días"); el último punto, latiendo.
- **Lo que sigue**, en 3 tarjetas numeradas y reales: (1) coordinar la entrega por el chat; (2) a los 2 días llega el primer seguimiento con "¿Qué tal estuvo la primera noche en casa?" (spec 011); (3) la mascota ya figura en **Mis mascotas** (la aprobación de una adopción crea la mascota propia).
- **Botones:** principal "Hablar con {Refugio}" (abre la sala exacta); secundario "Ver a {Nombre}" (abre la mascota recién creada); terciario "Compartir la noticia" (`Share` nativo de React Native, sin dependencia).
- **Tránsito:** otra variante. Título "¡{Nombre} te espera en tu hogar de tránsito!", con el período (inicio → fin) y los recordatorios, sin la palabra "familia".
- **Del lado del refugio:** al tocar Aceptar, una confirmación con lo que pasó solo (publicación finalizada, N solicitudes cerradas y avisadas).
- **Datos necesarios en el detalle:** `chatId` y, para una adopción aprobada vista por el adoptante, `mascotaAdoptadaId` (el repository ya lo devuelve al aprobar).

### F7 — Camino de estados

Evolución de `ProgresoSolicitud` (no un componente nuevo):

```
 ●━━━━━●━━━━━●─────○
 Enviada  En revisión  Revisada  Decisión
 15/10    16/10        19/10
```

- **Puntos y líneas.** Lleno = ya pasó; anillo = actual; vacío = falta. Se pinta con el **historial real**, no solo con el estado actual.
- **El último punto cambia según cómo termina:** ✓ en el color de la app si fue aprobada; ✗ rosa si fue rechazada; gris si fue cancelada o cerrada (con la causa en el historial).
- **Etapas salteadas** quedan vacías (si la rechazan estando `Pendiente`, las del medio no se pintan).
- **Tres tamaños, un solo componente:** con fechas en el detalle, compacto en las tarjetas del listado (reemplaza la barra de 3 segmentos) y en la tarjeta de la solicitud dentro del chat.
- La línea de tiempo vertical (`LineaTiempoEstados`) queda abajo como **"Historial"**, con la causa y los comentarios.
- Al cambiar de etapa mientras se mira (por un refresco o una notificación), el punto nuevo se enciende con una vibración suave.

### F8 — Vibraciones

Un helper único (`vibrar.exito()`, `.error()`, `.advertencia()`, `.seleccion()`, `.toque()`, `.celebracion()`) sobre `expo-haptics`, y una preferencia **"Vibraciones"** (activada por defecto) en Mi perfil, guardada en el dispositivo. Reglas: una vibración por gesto; ninguna al hacer scroll ni por cada tecla.

| Dónde | Vibración |
|---|---|
| `Toast` (éxito / advertencia / error) | éxito / advertencia / error — **un solo punto cubre toda la app** |
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
| Seguimiento / donación confirmada | éxito |

---

## 5. Impacto técnico (checklist)

**Backend**
- [ ] Seed: estados `Revisada` y `Cerrada`. Migración de **esquema** (no de datos): enum de motivo + columna `motivo` en `SolicitudEstado`; tablas `pregunta_adopcion` y `solicitud_respuesta`, y la columna `nota_interna` en `Solicitud`.
- [ ] Constante única de estados abiertos/finales/motivos; reemplazar las 5 copias y los 5 chequeos `=== 'Pendiente'` (§2).
- [ ] Endpoints: iniciar revisión, marcar revisada, retirar, notas, CRUD de preguntas; `PATCH /:id/estado` pasa a aceptar `motivo` y a exigir `Revisada` para aprobar.
- [ ] `aprobarAdopcion` y la aprobación de tránsito: cerrar las demás **vivas** (no solo `Pendiente`) como `Cerrada`. `listarPendientesDePublicacion` y el aviso de pausa deben ver todas las vivas.
- [ ] Cierre automático al finalizar/retirar publicación, al pasar la mascota a `Fallecido`/`Adoptado` (`sincronizarConEstadoMascota`) y al cerrar su cuenta el publicante (`darDeBajaCuenta`).
- [ ] Cron: todas las etapas vivas, destino `Cerrada · venció sin respuesta`, recordatorio previo; actualizar el job y sus tests.
- [ ] Tope de 5: contar todas las vivas (`contarPendientesDeUsuario`) y la definición de solicitud duplicada.
- [ ] `shared/alertasRefugio.ts`: sumar `Revisada` a las demoradas; revisar `?demoradas=true`.
- [ ] Guard "no se puede eliminar una mascota con solicitudes abiertas" (`mascotas.service`, `admin-mascotas`): debe ver `Revisada`.
- [ ] Notificaciones nuevas: revisada (push), retirada (bandeja al refugio), cerrada por causa (al adoptante).
- [ ] Chat: saludo emitido por el adoptante y `chatId` en `SolicitudDetalleDto`; `mascotaAdoptadaId` cuando corresponde.
- [ ] Límites nuevos en `shared/validation/limits.ts` (saludo, pregunta, respuesta, nota); espejo en el front.
- [ ] Docs: `MODELO_DATOS.md`, spec 003 (estados, reglas, API; limpiar la numeración de reglas desordenada y la nota vieja de la migración "sin aplicar"), criterios de HU-7.x en `REQUISITOS.md`, deuda #19.
- [ ] Tests: transiciones válidas e inválidas, cierres por causa, validación de respuestas, idempotencia del saludo.

**Mobile**
- [ ] `expo-haptics` (módulo nativo: pide **build nuevo del dev client/APK**; en Expo Go ya viene incluido) y el helper `vibrar`.
- [ ] `EstadosSolicitud.ts`, `EstadoSolicitudBadge`, `ProgresoSolicitud` → camino de estados, `LineaTiempoEstados` → Historial, filtros del listado y del panel de Inicio.
- [ ] Formulario: paso "Tu saludo" (con vista previa) y paso de preguntas del refugio; ajustar `borrador.ts`.
- [ ] `PasoExito` → momento animado con auto-avance (y modo quieto de respaldo).
- [ ] `app/solicitudes/[id].tsx` → revisión guiada (refugio) y pantalla de aprobada (adoptante); botón "Retirar solicitud"; arreglar el comentario viejo de "Contactar refugio".
- [ ] Pantalla "Preguntas para adoptantes" y su entrada en `MENU_REFUGIO`.
- [ ] Reutilizar los componentes existentes (`FilaDato`, `TarjetaDatos`, `SeccionTitulada`, `Nota`, `ResumenReputacion`, `ConfirmDialog`, `PressableAnimado`); si hace falta una variante, va al componente compartido. Todo color sale de `PALETA`.

**Web-admin:** etiquetas de `Revisada` y `Cerrada` en `SolicitudesTabla` y `DetalleSolicitudModal`, y en los dashboards que cuentan por estado.

---

## 6. Pendientes menores

- **Sonido:** se decide después (`expo-audio` + un archivo; también pide build nuevo).
- **Edad del solicitante** en la revisión: no se muestra salvo que se pida (se calcula de `fechaNacimiento`).
- **Textos exactos** (copys en voseo de cada pantalla y de las notificaciones): se cierran en la spec.
- **Especies disponibles** para el alcance de las preguntas: confirmar el catálogo al implementar (¿solo perro y gato?).
- **"Mascota perdida"** como causa o estado: descartado por ahora.

## 7. Ideas para más adelante

- Tiempo de respuesta real del refugio visible para el adoptante (reutiliza el cálculo del chat).
- Mensaje opcional del refugio al marcar como revisada.
- Entrevista o visita al hogar como etapa posterior.
- Sonido en el momento de "enviada" y en la aprobada.

---

## 8. Orden de implementación sugerido

1. **Base de estados (F1 + F7):** constante única, estados nuevos, transiciones, causas, retiro, cierres automáticos, cron, camino de estados y filtros "Por revisar / Revisadas / Resueltas".
2. **Saludo y "enviada" (F4 + F5 + parte de F8):** paso "Tu saludo", mensaje del adoptante, momento animado, `expo-haptics` y los puntos de integración centrales (Toast, botones, tabs).
3. **Revisión (F3):** lado a lado, perfil, notas y rechazo con motivo.
4. **Aprobada (F6).**
5. **Preguntas del refugio (F2).**
6. **Resto de vibraciones y pulido visual.**

Cada fase deja la app funcionando por sí sola; se puede cortar en commits o PRs separados dentro de la misma rama.

## 9. Deuda técnica relacionada

- **#19** — pausar/finalizar no toca las solicitudes abiertas: este plan la reduce a la pausa.
- **#43** — el seguimiento de un tránsito ignora el período declarado (180 días fijos). Conviene resolverla cerca de la etapa 1, porque el seguimiento arranca con la aprobación y esa transición se va a tocar igual.
- **#44** — dos configuraciones de ESLint en el backend.
- **#45** — archivo `NUL` sin ignorar en el frontend.
