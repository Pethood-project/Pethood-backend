# MODELO_DATOS.md — PetHood

Modelo de datos derivado del diagrama de clases de factibilidad/diseño (Grupo N°09). Es la fuente de verdad para nombres de tablas, campos, PK/FK y cardinalidades. Todas las entidades siguen el patrón de auditoría transversal salvo excepción indicada.

## Convención de auditoría (aplica a TODAS las entidades salvo que se aclare lo contrario)

Todas las tablas incluyen, además de sus campos propios:

```
{entidad}_usuario_alta
{entidad}_fecha_alta
{entidad}_usuario_modificacion
{entidad}_fecha_modificacion
{entidad}_usuario_baja
{entidad}_fecha_baja
```

Por brevedad, estos 6 campos se omiten en el detalle de cada entidad más abajo y solo se listan los campos propios del negocio. Dar por hecho que existen siempre, salvo en las entidades marcadas explícitamente como **solo alta** o **alta/baja sin modificación**.

## Catálogos (tablas de referencia, sin lógica propia)

Estas son tablas simples de tipo catálogo, usadas como FK desde otras entidades. Todas tienen `{nombre}_id PK`, `{nombre}_nombre`, `{nombre}_descripcion` + auditoría.

- **Especie** (`especie_id PK`) — ej. Perro, Gato.
- **Raza** (`raza_id PK`, FK a `especie_id`) — depende de la especie seleccionada (el frontend debe filtrar razas dinámicamente al elegir especie).
- **Estado_Mascota** (`estado_mascota_id PK`) — valores: Disponible, En_Tratamiento, Adoptado, Fallecido, En_Transito (ver nota de negocio).
- **Estado_Publicacion** (`estado_publicacion_id PK`) — valores: Activa, Pausada, Finalizada. Es el estado del aviso, no el de la mascota (ver `Publicacion_Estado`). **Agregado fuera del diagrama de clases (2026-09-25)**: pendiente reflejarlo en el diagrama del grupo.
- **Estado_Usuario** (`estado_usuario_id PK`).
- **Estado_Refugio** (`estado_refugio_id PK`).
- **Estado_Solicitud** (`estado_solicitud_id PK`).
- **Estado_Campaña** (`estado_campaña_id PK`) — valores: Inactiva, Activa, Finalizada, Cancelada.
- **Estado_Animal_Perdido** (`estado_animal_perdido_id PK`) — incluye "Encontrado/Perdido/Resuelto".
- **Tipo_Solicitud** (`tipo_solicitud_id PK`) — incluye `tipo_solicitud_secuencia_dias` (usado para ventanas de tiempo, ej. la cancelación automática a los 6 meses).
- **Rol** (`rol_id PK`) — Administrador, Refugio, Adoptante.

**Nota de negocio sobre estados de Mascota:** los valores vistos en el diagrama son `disponible`, `En_Tratamiento`, `Adoptado`, `Fallecido`, `En_Transito`. Un refugio solo puede continuar el flujo de publicación ("Continuar: Crear la publicación") si el estado elegido es "Disponible" o "En tránsito"; si elige "En tratamiento" ese botón permanece deshabilitado.

## Entidades principales

### Usuario

`usuario_id PK`, `usuario_nombre`, `usuario_apellido`, `usuario_email`, `usuario_contraseña` (nullable si la cuenta se creó solo con Google), `usuario_telefono` (obligatorio en el registro con email/contraseña; nullable para cuentas Google), `usuario_dni` (nullable — el registro mobile actual y OAuth no lo exigen), `usuario_fecha_nacimiento` (nullable), `usuario_google_id` (nullable, único — id `sub` de Google OAuth 2.0), `usuario_verificado`, `usuario_imagen_url`, `usuario_ubicacion` (nullable — barrio/ciudad del perfil, GUI-15), FK `refugio_id` (nullable — solo aplica si el usuario pertenece a un refugio), FK `estado_id` (→ Estado_Usuario).

Relaciones: 1 Usuario → N Mascota, N Publicacion, N Solicitud, N Favorito, N Notificacion, N Hogar, N Reseña (como autor), N Donacion, N Campaña, N Usuario_Chat, N Mensaje, N Rol_Usuario, N Animal_Perdido (como reportante).

### Rol_Usuario

Tabla intermedia N:N entre Usuario y Rol. `usuario_id FK NOT NULL`, `rol_id FK NOT NULL` + auditoría propia de la relación.

### Refugio

`refugio_id PK`, `refugio_nombre`, `refugio_direccion`, `refugio_telefono`, `refugio_email`, `refugio_descripcion`, `refugio_verificado`, `refugio_imagen_url`, FK `estado_id` (→ Estado_Refugio).

Relaciones: 1 Refugio → N Campaña, 1 Refugio → N Reseña (como reportado/ `refugio_reportado_id` en Reseña).

### Mascota

`mascota_id PK`, `mascota_nombre`, `mascota_fecha_nacimiento`, `mascota_genero`, `mascota_peso`, `mascota_tamanio`, `mascota_castrado`, `mascota_descripcion`, `mascota_imagen_url`, FK `raza_id NOT NULL`, FK `refugio_id` (nullable), FK `usuario_id NOT NULL` (dueño/creador).

**Campos agregados fuera del diagrama de clases (2026-08-13, HU-6.1):** `mascota_peso` (`Decimal(4,1)`) y `mascota_tamanio` (enum `PEQUENO`/`MEDIANO`/`GRANDE`) **no figuran en el diagrama de clases original**, pero HU-6.1 AC-12 y AC-13 los pide como campos base obligatorios del formulario de creación. Se agregaron por migración. Pendiente: reflejarlos en el diagrama de clases del grupo para que no vuelvan a divergir.

Ambos son nullables en base, igual que `mascota_nombre` y `mascota_fecha_nacimiento` — que también son obligatorios en HU-6.1 pero nacieron nullables. La obligatoriedad se impone en el DTO Zod del módulo, no en la columna, para no bloquear altas de Mascota desde otros flujos (ej. un animal encontrado sin datos completos, Módulo 13).

Validaciones de negocio (HU-6.1): nombre 2-25 caracteres (con trim); fecha de nacimiento nunca futura; peso numérico con hasta 1 decimal (acepta punto o coma); tamaño = selector cerrado Pequeño/Mediano/Grande; sexo = selector cerrado Macho/Hembra; foto obligatoria (≤5MB, jpg/png/webp/jpeg); especie/raza dependientes en cascada.

**Estado inicial al crear (decisión de equipo, 2026-08-13):** toda Mascota nace con una fila en `Mascota_Estado`. El formulario del refugio (GUI-30) tiene selector de Estado explícito (AC-16). El del adoptante (GUI-16) no lo tiene: se deriva del selector "¿Es tu mascota o es para adopción?" — "para adopción" → `Disponible`, "es mi mascota" → `Adoptado` (ya tiene dueño, no se ofrece publicar).

### Mascota_Estado

Histórico N:1 de estados de una mascota. `mascota_estado_id PK`, FK `mascota_id FK NOT NULL`, FK `estado_mascota_id FK NOT NULL` + auditoría (alta/baja, sin campo de modificación propio distinto del genérico).

### Estado_Mascota

Ver catálogos arriba.

### Publicacion

`publicacion_id PK`, `publicacion_titulo`, `publicacion_descripcion` (máx. 50 caracteres, trim), `publicacion_ubicacion`, `publicacion_requisitos`, `publicacion_imagen_url`, FK `mascota_id FK NOT NULL`, FK `usuario_id FK NOT NULL`.

**Campos agregados fuera del diagrama de clases (2026-08-13, HU-6.1):** `publicacion_ubicacion` (texto libre ≤50 caracteres con trim, AC-27) y `publicacion_requisitos` (`text[]`, los "Requisitos del adoptante" del tag input de AC-26, cada etiqueta ≤25 caracteres). Los requisitos se modelan como array plano y no como tabla hija porque cada uno es solo una etiqueta de texto libre sin atributos ni ciclo de vida propio. Pendiente: reflejarlos en el diagrama de clases del grupo.

**Campos agregados por el diseño de GUI-24 (2026-08-17):** tampoco están en el diagrama de clases.

| Campo | Tipo | Para qué |
| --- | --- | --- |
| `publicacion_imagenes` | `text[]` | Hasta 5 fotos. **El orden del array es el orden de la galería**: la primera es la portada. `publicacion_imagen_url` se mantiene sincronizado con esa portada para no romper lo que ya lee ese campo. Si no se suben fotos propias, se hereda la de la mascota. |
| `publicacion_personalidad` | `text[]` | Rasgos elegidos como pastillas (≤25 caracteres cada uno). Hoy las opciones están fijas en el frontend; cuando se definan, deberían pasar a ser un catálogo como Especie o Raza. |
| `publicacion_desparasitado` | `boolean` | Del interruptor de GUI-24. |
| `publicacion_vacunas` | `text` | Texto libre ≤200. **Provisional**: el diseño muestra pastillas por vacuna (Rabia, Parvovirus, Moquillo, Triple) y conceptualmente esto pertenece a `Historia_Clinica` (Módulo 8, Fase 6). Se guarda como texto hasta que ese módulo exista. |

**A revisar con el equipo:** los datos de salud (desparasitado, vacunas) viven hoy en `Publicacion` por conveniencia de la pantalla, pero su lugar natural es `Historia_Clinica`. Cuando se implemente la Fase 6, evaluar migrarlos.

**Pendiente de definición:** `publicacion_titulo` es NOT NULL en el schema, pero el formulario de GUI-24 (AC-25 a AC-28) no pide un título — solo descripción, requisitos y ubicación. Confirmar con el equipo si el título se deriva del nombre de la mascota o si falta el campo en la pantalla.

Relaciones: 1 Publicacion → N Solicitud, N Favorito (vía Mascota), 1 Publicacion → N Reseña (visibles en contexto de publicación/solicitud).

Regla de negocio: máximo 5 publicaciones activas simultáneas por adoptante particular (quota anti-spam).

Relaciones de estado: 1 Publicacion → N Publicacion_Estado (histórico; una sola fila vigente).

### Publicacion_Estado

Histórico N:1 de estados de una publicación, mismo patrón que `Mascota_Estado`. `publicacion_estado_id PK`, FK `publicacion_id FK NOT NULL`, FK `estado_publicacion_id FK NOT NULL` + auditoría (alta/baja, sin campo de modificación propio). Cambiar de estado es baja de la fila vigente + alta de una nueva, así queda el historial completo. Un índice único **parcial** (`publicacion_estado_activo_uq`, sólo en la migración) garantiza una sola fila vigente por publicación. **Agregado fuera del diagrama de clases (2026-09-25).**

**Toda publicación nace con estado**, según el de su mascota en ese momento. Las transiciones hoy son **automáticas** y siguen al estado de la mascota:

| Mascota | Publicación | Efecto |
| --- | --- | --- |
| `Disponible` | `Activa` | se ve en el feed y se puede solicitar |
| `En_Transito`, `En_Tratamiento` | `Pausada` | sigue viva, pero fuera del feed |
| `Adoptado`, `Fallecido` | `Finalizada` | aviso cerrado |

El feed muestra sólo las publicaciones `Activa`, y la quota de 5 publicaciones activas cuenta sólo esas. Las publicaciones que existían antes de este cambio recibieron su estado con la misma regla en la migración `20260925125459_estado_publicacion`.

**Previsto (con la HU de modificar publicación):** transiciones manuales — pausar, finalizar, reactivar — y eliminar (baja lógica de la publicación). Ver `DEUDA_TECNICA.md` ítem 16.

### Favorito

`favorito_id PK`, FK `usuario_id FK NOT NULL`, FK `mascota_id FK NOT NULL`. Relación N:N entre Usuario y Mascota vía esta tabla intermedia.

### Solicitud

`solicitud_id PK`, `solicitud_motivacion`, `solicitud_fecha_respuesta`, `solicitud_comentario`, `solicitud_fecha_inicio_transito`, `solicitud_fecha_fin_transito`, FK `publicacion_id FK NOT NULL`, FK `usuario_id FK NOT NULL` (solicitante), FK `tipoSolicitud_id FK NOT NULL`.

**Campos agregados fuera del diagrama de clases (HU-7.1):** `solicitud_fecha_inicio_transito` y `solicitud_fecha_fin_transito`, ambos nullable. Son el período que el solicitante ofrece cuando el tipo es `Transito`; en una adopción quedan nulos. El diagrama original no los tenía y la HU los pide explícitamente ("el sistema le muestra en la misma solicitud de adopción el tiempo de inicio y el tiempo de fin") — ver `REQUISITOS.md` §10.

Van en `Solicitud` y no en `Hogar` porque son de ESA solicitud: el hogar es el perfil del usuario y lo comparten todas.

Reglas de negocio: máximo 5 solicitudes en estado "Pendiente" simultáneas por usuario. Cancelación automática (usuario "SISTEMA") a los 6 meses sin resolución. Solo se puede solicitar una publicación viva de otro usuario cuya mascota esté `Disponible`, y no se puede tener más de una solicitud abierta sobre la misma publicación.

### Solicitud_Estado

Histórico de estados de una solicitud. `solicitud_estado_id PK`, FK `solicitud_id FK NOT NULL`, FK `estado_solicitud_id FK NOT NULL`.

### Tipo_Solicitud

Ver catálogos. Incluye `tipo_solicitud_secuencia_dias` para parametrizar ventanas de tiempo (ej. adopción vs. tránsito pueden tener plazos distintos).

### Historia_Clinica

`historia_clinica_id PK`, `historia_clinica_fecha_visita`, `historia_clinica_fecha_proxima`, `historia_clinica_requiere_revision`, `historia_clinica_vacunacion`, `historia_clinica_titulo`, `historia_clinica_descripcion`, `historia_clinica_documento_url`, FK `mascota_id FK NOT NULL`.

**Regla de negocio crítica: inmutabilidad.** No existe operación de UPDATE sobre un registro de historia clínica ya persistido. "Modificar" = dar de baja lógica del registro erróneo + crear uno nuevo. El campo de fecha de modificación genérico no debería usarse nunca en la práctica para esta entidad (si aparece poblado, es una señal de bug).

### Seguimiento

`seguimiento_id PK`, `seguimiento_descripcion`, `seguimiento_foto_url`, `seguimiento_plazo`, FK `solicitud_id FK NOT NULL`, FK `pregunta_seguimiento_id FK NOT NULL`.

**Regla de negocio crítica: anti-fraude.** La foto de evidencia (`seguimiento_foto_url`) debe originarse exclusivamente desde la API de cámara nativa del dispositivo — el frontend mobile debe bloquear el acceso a la galería para este campo específico.

### Pregunta_Seguimiento

`pregunta_seguimiento_id PK`, `pregunta_seguimiento_texto`, `pregunta_seguimiento_posicion`, `pregunta_seguimiento_es_adopcion: boolean` (distingue si la pregunta aplica a flujo de adopción o de tránsito).

### Reseña

`reseña_id PK`, `reseña_puntuacion` (1-5), `reseña_comentario`, FK `reseña_usuario_autor FK NOT NULL` (autor), FK `refugio_reportado_id` (nullable), FK `usuario_reportado_id` (nullable).

**Nota sobre auditoría:** en el diagrama, Reseña tiene alta y modificación pero **no tiene campos de baja separados visibles como el resto** — sin embargo HU-10.6 ("Dar de baja reseñas") indica que sí soporta baja lógica. Tratarla igual que el resto de entidades con baja lógica estándar. Nunca se edita el contenido de una reseña ya creada (solo alta y baja, sin endpoint de update de contenido).

### Chat

`chat_id PK`, `chat_tipo` (probablemente distingue chat adoptante↔refugio vs. chat de coordinación de mascota perdida/encontrada — confirmar con el equipo el enum exacto; **hoy no se escribe**), FK `refugio_id` (nullable), FK `solicitud_id` (nullable).

`solicitud_id` es la solicitud que habilitó la sala (CONSTITUTION §7: no hay chat sin interacción previa). Es nullable porque las salas de coordinación por mascota perdida (HU-13.2) no salen de una solicitud. Un índice único parcial sobre `(solicitud_id) WHERE solicitud_id IS NOT NULL AND chat_fecha_baja IS NULL` evita dos salas para la misma solicitud.

### Usuario_Chat

Tabla intermedia N:N entre Usuario y Chat (participantes de una sala). `chat_id FK NOT NULL`, `usuario_id FK NOT NULL`, `usuario_chat_ultima_lectura` (nullable), `usuario_chat_ultima_entrega` (nullable) + auditoría.

**Las dos marcas de tiempo son el estado de lectura y entrega de la sala, por participante.** Un mensaje ajeno cuenta como no leído si su `mensaje_fecha_alta` es posterior a `usuario_chat_ultima_lectura`; `ultima_entrega` es el mismo hecho un paso antes (le llegó al dispositivo, no lo abrió). Van acá y no en `Mensaje` porque `mensaje_leido` es un booleano **sin dueño**: con tres o más personas en la sala, el primero que abre le baja el contador al resto. Además es una escritura por sala en lugar de un UPDATE masivo sobre `mensaje`.

### Mensaje

`mensaje_id PK`, `mensaje_contenido`, `mensaje_leido`, `mensaje_imagen_url`, `mensaje_imagenes` (TEXT[]), `mensaje_tipo` (enum `tipo_mensaje`: `TEXTO` | `SOLICITUD`), FK `chat_id FK NOT NULL`, FK `usuario_id FK NOT NULL` (emisor), FK `solicitud_id` (nullable).

- **`mensaje_leido` quedó obsoleto.** Lo reemplazan las marcas de `Usuario_Chat`. Se sigue poblando para no romper lecturas viejas de la columna, pero ninguna query del backend lo consulta. No usarlo en código nuevo.
- **`mensaje_imagen_url` es la PRIMERA de `mensaje_imagenes`**, desnormalizada para que el preview del listado no tenga que mirar el array. Mismo par que `publicacion_imagen_url` / `publicacion_imagenes`. Un mensaje admite hasta 5 fotos (`LIMITES.mensaje.fotos.maximo`).
- **`mensaje_tipo = SOLICITUD`** es la tarjeta que PetHood inserta en la sala al enviarse una solicitud: la emite el usuario SISTEMA y lleva `solicitud_id`. No es una burbuja de texto y su `mensaje_contenido` va vacío — el texto lo pone la UI.

**Nota de auditoría — excepción:** el mensaje **solo tiene alta**, no baja (consistente con la nota del documento de requisitos: "El mensaje solo va a tener alta, y el chat va a tener alta y baja"). No implementar endpoint de borrado de mensaje individual.

### Notificacion

`notificacion_id PK`, `notificacion_tipo`, `notificacion_mensaje`, `notificacion_leido`, FK `usuario_id FK` (destinatario).

Disparada por eventos de: Solicitud (aceptada/rechazada/nueva), Chat/Mensaje (mensaje nuevo), Seguimiento (post-adopción, revisión).

### Hogar

`hogar_id PK`, `hogar_direccion`, `hogar_tiene_patio`, `hogar_tiene_mascotas`, `hogar_descripcion`, `hogar_tipo_vivienda`, `hogar_inicio_disponibilidad`, `hogar_fin_disponibilidad`, `hogar_imagen_url`, FK `usuario_id FK NOT NULL`.

Representa el hogar de tránsito de un usuario/adoptante — no es una entidad de rol separada, es un atributo/perfil extendido del Usuario para cuando ofrece tránsito temporal. Ver `ROADMAP.md` sobre por qué no es módulo autónomo.

**Un solo hogar VIGENTE por usuario**, garantizado por el índice parcial `hogar_usuario_activo_uq (usuario_id) WHERE hogar_fecha_baja IS NULL` (mismo criterio que los índices de `Favorito`: parcial y no único plano, porque con baja lógica un único total impediría volver a cargar un hogar después de darlo de baja). El paso 2 del formulario de solicitud (GUI-7.1.1) actualiza el hogar existente en vez de crear otro, así la segunda solicitud del usuario arranca con las respuestas ya puestas.

**Campos agregados fuera del diagrama de clases (HU-7.1)** — el formulario de solicitud pregunta cosas que el diagrama no contemplaba; ver `REQUISITOS.md` §10:

| Campo | Tipo | Qué responde |
| --- | --- | --- |
| `hogar_espacio_exterior` | texto: `Balcon` \| `Patio` \| `Jardin` \| `Ninguno` | "¿Tenés espacios al aire libre?" |
| `hogar_detalle_mascotas` | texto, nullable | "¿Cuáles?", solo si `hogar_tiene_mascotas` |
| `hogar_tiene_ninios` | boolean | "¿Vive algún niño en tu casa?" |
| `hogar_experiencia_previa` | boolean | "¿Tuviste mascotas antes?" |
| `hogar_horas_solo` | entero: 4, 8 o 12 | "¿Cuántas horas por día quedaría sola?" (es el TOPE del rango elegido, no una cantidad exacta) |

`hogar_tipo_vivienda` estaba en el diagrama sin valores definidos; HU-7.1 los fija en `Casa` / `Departamento` / `Otro`.

**`hogar_tiene_patio` pasa a ser un derivado.** Ya no se pregunta: el formulario pide `hogar_espacio_exterior` y el servicio calcula el booleano (`Patio` o `Jardin` → verdadero). La columna se conserva porque está en el diagrama de clases, pero la respuesta real del usuario es la otra — no escribirla a mano.

### Campaña

`campaña_id PK`, `campaña_titulo`, `campaña_descripcion`, `campaña_objetivo`, `campaña_fechaInicio`, `campaña_fechaFin`, `campaña_imagen_url`, FK `refugio_id FK NOT NULL`, FK `estado_campaña_id FK NOT NULL`.

Validaciones (HU-12.1): descripción ≤300 caracteres; objetivo numérico entre $10.000 y $2.500.000; fecha_inicio ≥ hoy; fecha_fin > fecha_inicio; imagen jpg/png/webp; máximo 5 campañas activas por refugio.

Transiciones automáticas (cron, usuario "SISTEMA"): Inactiva→Activa al llegar fecha_inicio; →Finalizada al llegar fecha_fin o alcanzar el monto objetivo acumulado.

### Estado_Campaña

Ver catálogos. Valores: Inactiva, Activa, Finalizada, Cancelada.

### Donacion

`donacion_id PK`, `donacion_monto`, FK `campaña_id FK NOT NULL`, FK `usuario_id FK NOT NULL` (donante).

**Regla de negocio crítica:** el monto declarado por el adoptante NO impacta automáticamente el progreso acumulado de la campaña. Solo se contabiliza cuando el refugio verifica manualmente el ingreso real en su cuenta y confirma (acción explícita "Aceptar" en el flujo de HU-12.3).

### Animal_Perdido

`animal_perdido_id PK`, `animal_perdido_descripcion`, `animal_perdido_imagen_url`, `animal_perdido_latitud`, `animal_perdido_longitud`, `animal_perdido_fecha_resuelto`, FK `usuario_reportante_id FK NOT NULL`, FK `mascota_id` (nullable — puede reportarse un animal encontrado que no está registrado como Mascota propia de nadie en el sistema), FK `animal_perdido_estado_animal_perdido FK NOT NULL`.

**Resuelto:** `animal_perdido_latitud` / `animal_perdido_longitud` se mantienen — sí se captura la coordenada al reportar un animal perdido/encontrado (ej. desde el GPS del dispositivo al momento del reporte). Lo que **no existe** es un mapa interactivo en la UI: el usuario busca y visualiza por ubicación administrativa (Provincia/Localidad), no por un mapa con pines. No quitar estos campos del modelo ni reemplazarlos por FK a Provincia/Localidad — conviven ambos: lat/long como dato del reporte, Provincia/Localidad como criterio de filtro para el usuario.

### Estado_Animal_Perdido

Ver catálogos.

### Reporte_Problema

`reporte_problema_id`, `reporte_problema_motivo`, `reporte_problema_respuesta`, `reporte_problema_resuelto`, `reporte_problema_mensaje_sistema` y sus datos de auditoría. No hay relación con ninguna tabla.

### Consulta_Soporte

`consulta_soporte_id PK`, `consulta_soporte_nombre_completo`, `consulta_soporte_email`, `consulta_soporte_asunto`, `consulta_soporte_mensaje`, `consulta_soporte_resuelta` (boolean, default `false`) + auditoría. Mensajes del formulario de contacto (HU-15.2), enviados por cualquier persona sin sesión. El admin los lee y los marca como resueltos en web-admin. Sin relación con ninguna tabla: al no haber usuario autenticado, `usuario_alta` es el usuario SISTEMA. No confundir con `Reporte_Problema` (moderación, HU-3).

### Faq_Categoria

`faq_categoria_id PK`, `faq_categoria_nombre`, `faq_categoria_descripcion` + auditoría. Catálogo de agrupación de preguntas frecuentes (ej. Adopciones, Refugios, Cuenta).

### Faq

`faq_id PK`, `faq_pregunta`, `faq_respuesta`, `faq_orden`, FK `faq_categoria_id FK NOT NULL` + auditoría.

**HU-15.3:** contenido administrable por web-admin, sin tocar código. Ver spec 015.

## Entidades cuya existencia formal hay que confirmar

- **Reporte_Problema**: aparece nombrada explícitamente en la matriz de trazabilidad del documento de requisitos (HU-3.1 a HU-3.7, "Moderación y Reportes") asociada a Usuario, Publicacion y Reseña, pero **no aparece dibujada como entidad propia en las capturas del diagrama de clases** revisadas. Antes de la Fase 9 del roadmap, confirmar con el equipo si ya existe en una versión más actualizada del diagrama o si hay que modelarla desde cero (sugerencia mínima: `reporte_id PK`, `reporte_motivo`, `reporte_estado`, FK polimórfica o FKs nullable a `publicacion_id` / `usuario_reportado_id` / `reseña_id` + auditoría).

## Resumen de cardinalidades clave (para no perderlas al migrar)

- Raza
  -> Especie

- Usuario
  -> Refugio (opcional)
  -> Estado_Usuario

- Rol_Usuario
  -> Usuario
  -> Rol

- Refugio
  -> Estado_Refugio

- Mascota
  -> Usuario (dueño/creador)
  -> Refugio (opcional)
  -> Raza

- Mascota_Estado
  -> Mascota
  -> Estado_Mascota

- Publicacion
  -> Mascota
  -> Usuario (creador)

- Publicacion_Estado
  -> Publicacion
  -> Estado_Publicacion

- Favorito
  -> Usuario
  -> Mascota

- Solicitud
  -> Publicacion
  -> Usuario (solicitante)
  -> Tipo_Solicitud

- Solicitud_Estado
  -> Solicitud
  -> Estado_Solicitud

- Historia_Clinica
  -> Mascota

- Seguimiento
  -> Solicitud
  -> Pregunta_Seguimiento

- Reseña
  -> Usuario (autor, vía `reseña_usuario_autor`)
  -> Refugio (reportado, opcional)
  -> Usuario (reportado, opcional)

- Chat
  -> Refugio (opcional)

- Usuario_Chat
  -> Usuario
  -> Chat

- Mensaje
  -> Chat
  -> Usuario (emisor)

- Notificacion
  -> Usuario (destinatario)

- Hogar
  -> Usuario

- Campaña
  -> Refugio
  -> Estado_Campaña

- Donacion
  -> Usuario (donante)
  -> Campaña

- Animal_Perdido
  -> Usuario (reportante)
  -> Mascota (opcional)
  -> Estado_Animal_Perdido

- Faq
  -> Faq_Categoria

## Cómo usar este documento desde Claude Code

- Al generar migraciones/modelos ORM, copiar los nombres de campo tal cual (`snake_case` con el prefijo de la entidad), porque así están en el diagrama fuente y así los va a buscar el resto del equipo.
- Si una tarea requiere un campo que no está listado acá, no inventarlo: marcar la duda y preguntar, especialmente en la entidad señalada arriba como pendiente de confirmar (Reporte_Problema).
- Los catálogos (Estado_*, Tipo_Solicitud, Especie, Raza, Rol) deberían poder gestionarse desde el panel admin, aunque no tengan HU propia detallada — son configuración base del sistema (ver módulo transversal "Configuración y parámetros" en `docs/REQUISITOS.md`).
