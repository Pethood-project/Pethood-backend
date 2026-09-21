# REQUISITOS.md — PetHood

Síntesis operativa de la Etapa 5 (relevamiento e ingeniería de requisitos) para uso de Claude Code. No reemplaza el documento original del equipo — si hace falta el texto exacto de un criterio de aceptación puntual para la entrega académica, consultar el PDF fuente (`Etapa_5.pdf`). Este archivo organiza la información para que sea accionable durante el desarrollo.

## 1. Actores del sistema

| Actor | Descripción |
|---|---|
| **Adoptante** | Usuario particular. Publica sus propias mascotas, busca/solicita adopciones, hace seguimiento, reseña, puede ofrecer hogar de tránsito. |
| **Refugio** | Cuenta validada por el administrador. Publica mascotas en adopción, gestiona solicitudes, historia clínica, campañas de donación, moderación de sus publicaciones. |
| **Administrador global** | Valida refugios y usuarios, modera reportes, gestiona roles, accede a dashboards globales. |
| **SISTEMA** | Usuario técnico usado como autor de bajas automáticas (cron jobs). No es un actor humano. |

## 2. Definición del tipo aplicativo (arquitectura)

- **App móvil híbrida** (iOS/Android) con **React Native + Expo**. Destinatarios: adoptantes, rescatistas independientes, personal operativo de refugios en campo. Justificación técnica explícita del documento: mobile-first para explotar cámara nativa (seguimiento post-adopción) y uso en campo.
- **Panel web de escritorio** con **Next.js + Tailwind CSS**. Destinatarios: administradores globales y refugios/fundaciones verificados. Justificación: alta densidad de datos para moderación, configuración, dashboards estadísticos y exportación CSV — se degrada en pantallas móviles.
- Ambos consumen **una única API REST** de backend.

## 3. Mapa de módulos (tres capas de requerimientos)

### 3.1 Transversales (Core / Cross-cutting)

Cruzan horizontalmente toda la plataforma:

- **Interfaz y accesibilidad**: mobile híbrida (usuarios finales) + web de escritorio (administración/dashboards).
- **Feedback visual**: respuesta visual ante cada input; modales confirmatorios con código de colores semáforo en acciones críticas.
- **Accesibilidad visual**: paleta contrastante, tipografías estandarizadas.
- **Seguridad y sesión**: RBAC vía middleware backend, JWT stateless.
- **Optimización multimedia**: compresión asíncrona de imágenes en middleware backend.
- **Gestión de perfiles base**: registro, login, visualización/edición de datos demográficos, logout, recuperación de contraseña.
- **Auditoría y trazabilidad**: todas las entidades llevan usuario/fecha de alta, modificación y baja.

### 3.2 Funcionales (Core de negocio)

- Roles y Administración Central
- Moderación y Reportes
- Notificaciones
- Chat y Mensajería (arquitectura WebSockets)
- Publicación de Mascotas
- Adopción y Acogimiento Temporal (Tránsito)
- Historia Clínica Inmutable
- Seguimiento Post-Adopción
- Sistema de Reputación
- Navegación y Ubicación Administrativa (Provincia/Localidad — **no GPS**)
- Campañas de Recaudación
- Mascotas Perdidas y Encontradas

### 3.3 Soporte / Validación (reglas de negocio ocultas del backend)

Ver sección 8 de este documento — estas son las reglas no negociables que debe implementar el backend independientemente de la UI.

## 4. Tabla de validez de campos y archivos (aplica globalmente)

| Tipo de dato | Reglas | Ejemplo válido |
|---|---|---|
| Fecha | Mes ≤12, día según corresponda al mes, año ≥1900, nunca vacío/cero/negativo | 31/12/2026 |
| Nombre y Apellido | Solo caracteres alfabéticos | Nombre Apellido |
| DNI | Solo números positivos, 7 u 8 dígitos | 1111111 |
| Título | Alfanumérico y símbolos | titulo#1 |
| Descripción | Alfanumérico y símbolos | descripcion:test |
| Email | Debe contener `@` y dominio | mail@gmail.com |
| Imagen | ≤5MB | png, jpg, webp, jpeg |
| Documentos | ≤5MB | pdf |
| Filtros | Todos de selección múltiple | — |

## 5. Sistema de mensajería de UI (tono y voz — aplica a ambos frontends)

Todo mensaje al usuario usa **voseo** (Rioplatense). Tipos de mensaje y su tono:

| Tipo | Cuándo | Tono | Ejemplo |
|---|---|---|---|
| Éxito | Acción completada | Celebratorio, corto, cálido | "¡Listo! Tu publicación ya está activa." |
| Advertencia | Riesgo antes de confirmar | Preventivo, empático | "Tené en cuenta que si cambiás de provincia, se van a reiniciar los filtros." |
| Error | Acción falló | Resolutivo, directo, sin tecnicismos | "No pudimos guardar los cambios. Revisá tu conexión e intentalo de nuevo." |
| Campo obligatorio vacío | Campo requerido sin completar | Preciso, asistencia rápida | "Este campo es obligatorio. Completalo para poder continuar." |
| Formato inválido | Campo con formato incorrecto | Didáctico | "El correo no es válido. Asegurate de incluir el '@' y un dominio correcto." |
| Archivo inválido/pesado | Imagen/documento fuera de norma | Informativo, técnico-amigable | "La foto es muy pesada. Subí una imagen en JPG o PNG que pese menos de 5 MB." |

Estos mensajes están etiquetados en el documento fuente como componentes de GUI reutilizables: GUI-0.1.1 (Éxito), GUI-0.1.2 (Advertencia), GUI-0.1.3 (Error), GUI-0.1.4 (Campos vacíos), GUI-0.1.5 (Campos inválidos), GUI-0.1.6 (Archivo inválido). Implementarlos como componentes de toast/alert reutilizables desde el día 1 (Fase 0 del roadmap).

## 6. Módulos e historias de usuario

Cada módulo lista sus HUs con: actor, qué hace, y las reglas de validación/negocio más importantes extraídas de los criterios de aceptación. Para el texto exacto de cada criterio (útil si hace falta literalidad para la entrega académica), ver el PDF original.

### Módulo 1: Gestión de Perfiles

- **HU-1.1 Registro de usuario** (Adoptante). Campos: Nombre, Apellido, DNI, email, contraseña, teléfono. Al confirmar: crea cuenta, envía email de confirmación, redirige a login. Errores cubiertos: email duplicado, contraseñas no coinciden, campos vacíos, DNI duplicado.
- **HU-1.2 Inicio de sesión** (Adoptante y refugio). Login con email + contraseña. Redirige según rol. Soporta sesiones concurrentes en múltiples dispositivos. Opción "olvidé mi contraseña".
- **HU-1.3 Visualizar perfil personal**.
- **HU-1.4 Editar perfil personal**. Al cancelar con cambios sin guardar, pide confirmación en modal. Valida email duplicado al cambiarlo.
- **HU-1.5 Crear perfil con foto e información personal**.
- **HU-1.6 Recuperación de contraseña** vía email.
- **HU-1.7 Cierre de sesión**.
- **HU-1.8 Dar de baja cuenta**. Precondición: no debe tener procesos activos pendientes (adopciones/tránsitos/solicitudes en curso).

### Módulo 2: Roles y Administración

- **HU-2.1 Gestionar roles** (admin).
- **HU-2.2 Validar refugio** (admin) — habilita a un Refugio a operar.
- **HU-2.3 Validar usuarios** (admin) — verificación de DNI y teléfono; es precondición de varias otras HUs (ej. crear mascota).
- **HU-2.4 Alta y baja de un refugio** (admin).
- **HU-2.5 Baja de usuario** (admin).

### Módulo 3: Moderación y Reportes

- **HU-3.1 Reportar publicación**.
- **HU-3.2 Reportar usuario** (refugio o adoptante).
- **HU-3.3 Reportar reseña**.
- **HU-3.4 Suspender usuario** (admin, tras reporte).
- **HU-3.5 Eliminar publicación reportada** (admin).
- **HU-3.6 Visualizar reportes pendientes** (admin).
- **HU-3.7 Resolver reporte** (admin).

Nota: la entidad `Reporte_Problema` referenciada acá no está confirmada en el diagrama de clases visual — ver `docs/MODELO_DATOS.md`, sección de entidades a confirmar.

### Módulo 4: Notificaciones

- **HU-4.1** Notificación de solicitud de adopción aceptada/rechazada.
- **HU-4.2** Notificación de nueva solicitud al refugio.
- **HU-4.3** Notificación de mensaje nuevo en chat.
- **HU-4.4** Notificación de seguimiento post-adopción al adoptante.
- **HU-4.5** Notificación de revisión de seguimiento al refugio.

Motor de eventos asíncronos: push + posible email, disparado por eventos de Solicitud, Chat/Mensaje y Seguimiento.

### Módulo 5: Chat

- **HU-5.1 Acceso y visualización del listado de conversaciones activas**.
- **HU-5.2 Envío y recepción de mensajes en la sala de chat** (WebSockets, tiempo real).
- **HU-5.3 Búsqueda y filtrado de conversaciones por nombre de contacto**.

Chats habilitados exclusivamente entre adoptante↔refugio, o entre adoptantes en el caso de coordinación de mascotas perdidas.

### Módulo 6: Publicación de Mascotas

- **HU-6.1 Crear mascota** (propia o para publicar en adopción). Ver detalle completo de validaciones en sección 7 de este documento — es la HU más rica en reglas de UI/validación de todo el relevamiento.
- **HU-6.2 Editar mascota**.
- **HU-6.3 Eliminar mascota** (baja lógica).
- **HU-6.4 Visualizar mis mascotas**.
- **HU-6.5 Visualizar mascotas publicadas** (feed).
- **HU-6.6 Visualizar mascotas agregadas a favoritos**.

### Módulo 7: Adopción de Mascotas

- **HU-7.1 Solicitar adopción de mascota**.
- **HU-7.2 Guardar mascota en favoritos**.
- **HU-7.3 Ver historial de solicitudes realizadas**.
- **HU-7.4 Gestionar estados de solicitudes** (refugio acepta/rechaza).
- **HU-7.5 Visualizar historial de solicitudes**.
- **HU-7.6 Cancelación automática de solicitudes vencidas** — cron: más de 6 meses en "Pendiente" → baja con `usuario_baja = "SISTEMA"`.
- **HU-7.7 Visualizar solicitudes** (feed de inicio para el adoptante).

### Módulo 8: Historia Clínica

- **HU-8.1 Registrar historia clínica**.
- **HU-8.2 Acceder a historia clínica**.
- **HU-8.3 Modificar historia clínica** — **no es un update real**: da de baja el registro erróneo y crea uno nuevo (inmutabilidad).
- **HU-8.4 Dar de baja historia clínica**.

### Módulo 9: Seguimiento Post-Adopción

- **HU-9.1 Enviar seguimiento de mascota** — foto obligatoria vía cámara nativa (no galería).
- **HU-9.2 Ver seguimientos**.
- **HU-9.3 Revisar actualización de seguimiento** (por el refugio).

### Módulo 10: Sistema de Reputación

- **HU-10.1 Crear reseña con puntuación (1-5) y comentario**.
- **HU-10.2 Adoptante reseña a refugio o adoptante**.
- **HU-10.3 Refugio reseña a adoptante**.
- **HU-10.4 Refugio reseña a hogar de tránsito**.
- **HU-10.5 Visualizar reseñas en publicaciones y solicitudes**.
- **HU-10.6 Dar de baja reseñas** (nunca editar contenido).

### Módulo 11: Navegación y Búsqueda

- **HU-11.1 Filtrar publicaciones por características** (tamaño, edad, especie).
- **HU-11.2 Filtrar publicaciones por fecha**.
- **HU-11.3 Filtrar publicaciones por cercanía** (ubicación administrativa, no GPS).
- **HU-11.4 Filtrar publicaciones por texto libre**.

Todos los filtros son de selección múltiple (ver tabla de validez, sección 4).

### Módulo 12: Campañas de Recaudación

- **HU-12.1 Crear campaña de donación** — ver detalle completo en sección
  7. Precondición: refugio validado, sesión activa, máximo 5 campañas activas.
- **HU-12.2 Acceder a alias y CBU para donar**.
- **HU-12.3 Validar donaciones recibidas** — el refugio confirma manualmente, el monto declarado no impacta el progreso automáticamente.
- **HU-12.4 Gestión de estados automáticos** (cron).
- **HU-12.5 Dar de baja campaña**.
- **HU-12.6 Finalizar campaña**.
- **HU-12.7 Gestión de estados de campaña**.

### Módulo 13: Mascotas Perdidas y Encontradas

- **HU-13.1 Registrar mascota perdida**.
- **HU-13.2 Reclamar mascota perdida/encontrada** — abre chat de reencuentro directamente.
- **HU-13.3 Gestión de estados de publicación de animal perdido**, incluyendo marcar como "Resuelto" (cierra el caso y el chat asociado).

**Nota:** se guardan `latitud`/`longitud` al reportar (ver `MODELO_DATOS.md`), pero la app no muestra mapa interactivo — el usuario filtra/visualiza por ubicación administrativa (Provincia/Localidad).

### Módulo 14: Dashboards y Reportes

- **HU-14.1 Dashboard estadístico global** (Administrador) — solo web-admin.
- **HU-14.2 Dashboard de gestión interna** (Refugio) — solo web-admin.
- **HU-14.3 Exportación de datos e informes** (Admin y Refugio) — CSV, procesado por streams.

### Módulo 15: Soporte

- **HU-15.1 Consulta de manual de usuario y FAQs** — contenido estático, tipo landing page.
- **HU-15.2 Canal de contacto y formulario de soporte**.
- **HU-15.3 Gestión de FAQs (contenido administrable)** — **PENDIENTE**. Catálogo mantenible desde web-admin, modelado con dos tablas `Faq` + `Faq_Categoria` (ver `MODELO_DATOS.md`). No implementar hasta que se apruebe la resolución; cuando se implemente, reemplaza el enfoque estático de la consulta de HU-15.1.

## 7. Reglas de validación detalladas — casos más ricos

### 7.1 Crear mascota (HU-6.1) — formulario común (adoptante y refugio)

Campos base para ambos: Foto (obligatoria, explorador nativo o cámara), Nombre (2-25 caracteres, trim, obligatorio), Fecha de nacimiento (calendario, no futura, obligatoria), Sexo (dropdown Macho/Hembra, obligatorio), Peso (numérico, 1 decimal, acepta `.` o `,`), Tamaño (Pequeño/Mediano/Grande), Especie (dropdown que habilita Raza dependiente), Raza (filtrada dinámicamente según especie).

**Solo para refugio, campos adicionales:** Estado (Disponible / En tratamiento / En tránsito), Descripción para la publicación (obligatoria, ≤50 caracteres, trim), Requisitos del adoptante (tag input tipo chips, cada tag ≤25 caracteres), Ubicación (obligatoria, ≤50 caracteres, trim).

**Reglas de habilitación de botones:**
- El botón "Crear mascota" se habilita solo cuando todos los campos base son válidos.
- Para refugio: el botón "Continuar: Crear la publicación" se habilita si el estado elegido es "Disponible" o "En tránsito"; se **deshabilita** si el estado es "En tratamiento".
- Al confirmar creación exitosa: toast de éxito + redirección al home. Ante error de servidor/validación: toast de error, el usuario permanece en pantalla sin perder los datos cargados (para reintentar).

### 7.2 Crear campaña de donación (HU-12.1)

Campos obligatorios en el modal de creación: título, descripción (≤300 caracteres), objetivo (solo números, mínimo $10.000, máximo $2.500.000), fecha de inicio (calendario, ≥ hoy), fecha de fin (calendario, > fecha de inicio), imagen (jpg/png/webp).

Botones: "Cancelar" (rojo, vuelve al historial) y "Confirmar" (verde, crea la campaña en estado "Inactiva").

Reglas:
- Si el refugio ya tiene 5 campañas activas: bloquea la creación con mensaje de límite alcanzado.
- Filtros disponibles en el listado: por Fecha (desde obligatorio, hasta opcional — la fecha de inicio de la campaña debe caer en ese intervalo) y por Estado (selección múltiple: Inactiva, Activa, Finalizada, Cancelada).
- Listado ordenado por defecto: más reciente primero.
- Pantalla vacía (sin campañas creadas): mensaje "No tiene campañas creadas".

### 7.3 Registro de usuario (HU-1.1) y login (HU-1.2)

Registro: Nombre, Apellido, DNI, email, contraseña, teléfono. Validaciones específicas: email duplicado bloquea el registro con mensaje explícito; contraseñas que no coinciden bloquean con mensaje explícito; DNI duplicado bloquea con mensaje explícito.

Login: email + contraseña. Mensaje de error genérico para no filtrar cuál de los dos datos es incorrecto ("El correo o contraseña ingresados son incorrectos"). Soporta múltiples sesiones concurrentes en distintos dispositivos sin invalidar las anteriores.

## 8. Reglas de negocio ocultas del backend (Requerimientos de Soporte /
   Validación — sección 20.3.3 del documento original)

Estas son restricciones lógicas que **no tienen pantalla propia** pero son obligatorias de implementar en el backend:

1. **Validación de formatos e integridad de campos** — ver tabla sección 4.
2. **Restricciones de tiempo en fechas**: bloquear fechas futuras en campos de eventos ya sucedidos (visitas médicas, nacimientos); bloquear fechas pasadas en campos de planificación (turnos futuros, inicio de campañas).
3. **Quotas anti-spam**:
   - Máx. 5 publicaciones activas simultáneas por adoptante particular.
   - Máx. 5 solicitudes de adopción en "Pendiente" por usuario.
   - Máx. 5 campañas activas por refugio.
4. **Inmutabilidad de historia clínica**: nunca UPDATE, siempre baja+alta.
5. **Bloqueo de galería en seguimiento**: solo cámara nativa en tiempo real.
6. **Cron — cancelación automática**: solicitudes "Pendiente" > 6 meses → baja con usuario "SISTEMA".
7. **Cron — estados de campaña**: evaluación diaria de fechas y montos para transicionar Inactiva→Activa→Finalizada automáticamente.
8. **Auditoría interna obligatoria** en todas las tablas de PostgreSQL (alta/mod/baja con usuario y fecha).
9. **Validación manual de donaciones**: el monto declarado no suma al progreso hasta que el refugio confirme el ingreso real.
10. **Procesamiento de CSV por streams**: import/export masivo nunca debe cargar el archivo completo en memoria.

## 9. Matriz de trazabilidad (resumen — HU → entidad → módulo)

Ver tabla completa en el PDF original (sección 20.2). Resumen de mapeo HU → entidad principal, agrupado por los módulos de este documento, para saber rápidamente qué entidades tocar al implementar cada HU:

- Módulo 1-2 (perfiles/roles): entidad `Usuario`, `Refugio`.
- Módulo 3 (moderación): `Usuario`, `Publicacion`, `Reseña`, `Reporte_Problema` (a confirmar).
- Módulo 4 (notificaciones): `Solicitud`, `Chat`, `Mensaje`, `Seguimiento`.
- Módulo 5 (chat): `Chat`, `Mensaje`.
- Módulo 6 (mascotas/publicaciones): `Mascota`, `Publicacion`.
- Módulo 7 (adopción): `Solicitud`, `Mascota`, `Favorito`, `Estado_Solicitud`.
- Módulo 8 (historia clínica): `Usuario`, `Mascota`, `Historia_Clinica`.
- Módulo 9 (seguimiento): `Seguimiento`, `Mascota`.
- Módulo 10 (reputación): `Usuario`, `Refugio`, `Reseña`.
- Módulo 11 (navegación): `Publicacion`.
- Módulo 12 (campañas): `Campaña`, `Usuario`, `Estado_Mascota` (¿posible referencia cruzada rara en la matriz original entre Campaña y Estado_Mascota — revisar si es error del documento fuente o si hay una relación real no evidente en el diagrama de clases).
- Módulo 13 (perdidas y encontradas): `Usuario`, `Animal_Perdido`, `Estado_Animal_Perdido`.
- Módulo 14 (dashboards): agregaciones sobre todo lo anterior.
- Módulo 15 (soporte): sin entidad de dominio, contenido estático.

## 10. Ambigüedades detectadas en el documento fuente (no resolver solo)

El propio documento de Etapa 5 incluye, en la sección 20.3, una nota donde se describe una reestructuración del mapa de módulos con cambios de alcance explícitos (remoción de mapa interactivo, absorción del módulo de hogares de tránsito dentro de Adopción/Reputación). Esto genera algunas tensiones con partes más antiguas del mismo documento y con el diagrama de clases:

1. **Resuelto:** el diagrama de clases tiene `animal_perdido_latitud` / `animal_perdido_longitud` — esos campos SÍ se guardan (se captura la coordenada al reportar un animal perdido/encontrado), pero **no hay mapa interactivo en la UI**. La búsqueda/visualización para el usuario es por ubicación administrativa (Provincia/Localidad), no por mapa con pines. No implementar ningún SDK de mapas; sí persistir lat/long si el flujo de reporte las captura (ej. desde el GPS del dispositivo al momento de reportar), como dato adicional no explotado visualmente por ahora.
2. La entidad `Reporte_Problema` se menciona en texto pero no se ve dibujada en las capturas de diagrama revisadas.
3. La matriz de trazabilidad asocia HU-12.7 (Gestión de Estados de Campaña) con `Estado_Mascota`, lo cual no tiene relación obvia de negocio (¿error de tipeo en el documento por `Estado_Campaña`?). **Confirmar con el equipo.**
4. **HU-7.1 pide datos que el diagrama de clases no tiene.** Los criterios de aceptación hablan del "tiempo de inicio y el tiempo de fin" del tránsito, y `Solicitud` no tiene dónde guardarlos; el formulario aprobado (GUI-7.1.1) además pregunta por niños en la casa, experiencia previa con mascotas, horas que el animal quedaría solo y qué espacio al aire libre hay, y `Hogar` solo tenía un booleano de patio. Se agregaron dos columnas a `Solicitud` y cinco a `Hogar` (detalle en `MODELO_DATOS.md`), conservando `hogar_tiene_patio` como derivado para no romper el diagrama. **Decisión tomada con el equipo el 2026-09-09; falta reflejarla en el diagrama de clases de la entrega.**
5. **HU-7.1 referencia GUI-0.1.4 para dos mensajes que no son de campo vacío.** "No podés solicitar otra mascota" (tope de 5 pendientes) y "Tenés que verificarte antes de solicitar una adopción" son bloqueos de precondición, pero la HU los etiqueta como GUI-0.1.4, que según la sección 5 de este documento es el componente de *campo obligatorio vacío*. Por el tono corresponderían a GUI-0.1.2 (Advertencia). Se implementaron con los textos literales de la HU, en un cartel modal con la salida del bloqueo. **Confirmar la referencia de GUI con el equipo antes de la entrega.**

Ante cualquiera de estas ambigüedades, Claude Code no debe asumir silenciosamente una interpretación: señalarla y preguntar, dado que forma parte de una entrega académica donde la trazabilidad importa.
