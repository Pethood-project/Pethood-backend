# ROADMAP.md — PetHood

Plan de desarrollo sugerido, ordenado por dependencias reales entre módulos (no por número de módulo del documento de requisitos). La idea es poder levantar el backend en capas y enchufar frontend a medida que cada capa queda estable, evitando construir sobre entidades que todavía van a cambiar.

Cada fase indica: entidades del modelo de datos involucradas, HUs cubiertas, y qué se puede tocar en paralelo en frontend una vez el backend de esa fase tiene sus endpoints estables.

## Fase 0 — Fundaciones (Sprint 0)

**Objetivo:** dejar la base técnica lista para que todo lo demás se construya encima sin retrabajo.

- Backend:
  - Setup del proyecto (framework elegido, estructura de carpetas, linting).
  - Conexión a PostgreSQL, migraciones, seed de catálogos base (Especie, Raza, Estado_Mascota, Estado_Usuario, Estado_Solicitud, Estado_Campaña, Estado_Refugio, Estado_Animal_Perdido, Tipo_Solicitud, Rol).
  - Middleware de auditoría genérico (inyección automática de usuario/fecha alta-mod-baja en cada operación de escritura).
  - Middleware de compresión de imágenes.
  - JWT: emisión, verificación, refresh.
  - Middleware RBAC.
- Frontend (ambos): scaffolding de proyecto, sistema de diseño base (paleta accesible, tipografías, componentes de toast/modal reutilizables según GUI-0.1.x del documento de requisitos).

**No depende de nada. Todo lo demás depende de esta fase.**

## Fase 1 — Identidad y usuarios (Módulos 1 y 2)

**Entidades:** `Usuario`, `Estado_Usuario`, `Rol`, `Rol_Usuario`, `Refugio`, `Estado_Refugio`.

**HUs:** HU-1.1 a HU-1.8 (registro, login, perfil, recuperación de contraseña, cierre de sesión, baja de cuenta), HU-2.1 a HU-2.5 (roles, validación de refugios, validación de usuarios, alta/baja de refugio, baja de usuario).

**Backend primero:**
- Endpoints de auth (registro, login, refresh, logout, recuperar contraseña).
- CRUD de Usuario con estados y verificación (DNI/teléfono).
- CRUD de Refugio con flujo de validación por el admin.
- Endpoints de gestión de roles.

**Frontend después (paralelo mobile + web-admin):**
- Mobile: GUI-01 Registrarse, GUI-02 Login, GUI-09 Perfil Adoptante, GUI-15 Editar Perfil Adoptante.
- Web-admin: pantallas de validación de refugios/usuarios (uso admin).

Es la base de todo: sin usuarios y sesión no se puede avanzar a nada más.

## Fase 2 — Mascotas y publicaciones (Módulo 6)

**Entidades:** `Especie`, `Raza`, `Mascota`, `Estado_Mascota`, `Mascota_Estado`, `Publicacion`.

**HUs:** HU-6.1 a HU-6.6 (crear, editar, eliminar, visualizar mis mascotas, visualizar publicadas, favoritos).

**Backend:**
- CRUD de Mascota (con validaciones de HU-6.1: nombre 2-25 caracteres, fecha de nacimiento no futura, peso numérico con 1 decimal, foto obligatoria ≤5MB).
- Endpoint de creación de Publicación asociada a Mascota (para refugios, con descripción ≤50 caracteres, requisitos del adoptante como tags, ubicación).
- Endpoint de listado con paginación por defecto de la app.
- Enforcement de quota: máx. 5 publicaciones activas por adoptante particular.

**Frontend:**
- Mobile: GUI-04 Mascotas Adoptante, GUI-16 Crear Mascota Adoptante, GUI-30 Crear Mascota Refugio, GUI-24 Nueva pub de adopción, GUI-05 Adoptar (feed), GUI-29 Mascota Refugio.

Depende de Fase 1 (necesita Usuario/Refugio existentes).

## Fase 3 — Favoritos, navegación y filtros (Módulos 6.6, 11)

**Entidades:** `Favorito`.

**HUs:** HU-6.6, HU-11.1 a HU-11.4 (filtrar por características, fecha, ubicación administrativa, texto libre).

**Backend:** endpoint de favoritos, endpoints de búsqueda/filtrado (todos los filtros son de selección múltiple, según tabla de validez de campos).

**Frontend:** GUI-12 Favoritos, GUI-23 Filtros Avanzados.

Depende de Fase 2 (necesita Publicacion/Mascota).

## Fase 4 — Solicitudes de adopción (Módulo 7)

**Entidades:** `Solicitud`, `Solicitud_Estado`, `Estado_Solicitud`, `Tipo_Solicitud`.

**HUs:** HU-7.1 a HU-7.7 (solicitar adopción, guardar en favoritos —ya cubierto en Fase 3—, historial, gestión de estados, cancelación automática por 6 meses, visualizar solicitudes).

**Backend:**
- Endpoint de creación de Solicitud (valida quota: máx. 5 "Pendiente" por usuario).
- Endpoint de cambio de estado de solicitud (aceptar/rechazar por refugio).
- **Cron job** de cancelación automática de solicitudes con más de 6 meses en "Pendiente" (usuario de baja = "SISTEMA").

**Frontend:** GUI-10 Ficha Animal, GUI-27 Solicitudes, GUI-11 Estado de Solicitud.

Depende de Fase 2 (Mascota/Publicacion) y Fase 1 (Usuario).

## Fase 5 — Chat y notificaciones (Módulos 4 y 5)

**Entidades:** `Chat`, `Usuario_Chat`, `Mensaje`, `Notificacion`.

**HUs:** HU-5.1 a HU-5.3 (listado de conversaciones, envío/recepción de mensajes, búsqueda de conversaciones), HU-4.1 a HU-4.5 (notificaciones de solicitud aceptada/rechazada, nueva solicitud, mensaje nuevo, seguimiento post-adopción, revisión de seguimiento).

**Backend:**
- Infraestructura de WebSockets para chat en tiempo real.
- CRUD de Chat/Mensaje (el mensaje solo tiene alta; el chat tiene alta y baja).
- Motor de notificaciones (push + posiblemente email) enganchado a eventos de Solicitud, Chat y Seguimiento.

**Frontend:** GUI-08 Chat Adoptante, GUI-31 Chat Refugio, GUI-14 Conversación.

Depende de Fase 4 (una solicitud aceptada suele habilitar un chat) y Fase 1 (usuarios).

## Fase 6 — Historia clínica (Módulo 8)

**Entidades:** `Historia_Clinica`.

**HUs:** HU-8.1 a HU-8.4 (registrar, acceder, modificar —vía baja+alta, nunca update—, dar de baja).

**Backend:** CRUD con **inmutabilidad estricta**: no hay endpoint de update; "modificar" = dar de baja lógica + crear nuevo registro.

**Frontend:** GUI-18 Ficha Médica, GUI-20 Agregar Registro Médico, GUI-19 Detalle Ficha Médica.

Depende de Fase 2 (Mascota debe existir).

## Fase 7 — Seguimiento post-adopción (Módulo 9)

**Entidades:** `Seguimiento`, `Pregunta_Seguimiento`.

**HUs:** HU-9.1 a HU-9.3 (enviar seguimiento, ver seguimientos, revisar actualización).

**Backend:** endpoint de creación de Seguimiento asociado a Solicitud, lógica de preguntas de seguimiento configurables.

**Frontend:** GUI-21 Seguimiento Adopción/Tránsito, GUI-22 Actualización de seguimiento. **Importante:** la captura de foto debe forzar cámara nativa (bloquear galería) — esto es un requisito de frontend mobile no negociable.

Depende de Fase 4 (Solicitud debe existir y estar aceptada).

## Fase 8 — Reputación (Módulo 10)

**Entidades:** `Reseña`.

**HUs:** HU-10.1 a HU-10.6 (crear reseña, adoptante→refugio/adoptante, refugio→adoptante, refugio→hogar de tránsito, visualizar, dar de baja).

**Backend:** CRUD de Reseña (1-5 estrellas + comentario libre). Solo alta y baja lógica, sin edición.

**Frontend:** GUI-26 Perfil Público Refugio (con reseñas visibles).

Depende de Fase 4 (adopción concretada habilita reseña) y Fase 1.

## Fase 9 — Moderación y reportes (Módulo 3)

**Entidades:** `Reporte_Problema` (o equivalente — ver nota en `docs/MODELO_DATOS.md` sobre esta entidad, que aparece en la matriz de trazabilidad pero no está desarrollada como caja propia en el diagrama visual, revisar con el equipo).

**HUs:** HU-3.1 a HU-3.7 (reportar publicación/usuario/reseña, suspender usuario, eliminar publicación reportada, visualizar y resolver reportes).

**Backend:** CRUD de reportes + endpoints admin de moderación (suspender, eliminar, resolver).

**Frontend:** pantallas de moderación en **web-admin** exclusivamente (no es tarea de la app mobile).

Depende de Fase 2, 8 y 1 (necesita poder reportar Publicacion/Usuario/Reseña).

## Fase 10 — Campañas de donación (Módulo 12)

**Entidades:** `Campaña`, `Estado_Campaña`, `Donacion`.

**HUs:** HU-12.1 a HU-12.7 (crear campaña, acceder a alias/CBU, validar donaciones, gestión de estados automáticos, dar de baja, finalizar).

**Backend:**
- CRUD de Campaña (quota: máx. 5 campañas activas por refugio; objetivo entre $10.000 y $2.500.000; fecha_fin > fecha_inicio).
- **Cron job** de transición automática de estados (Inactiva→Activa, Activa→Finalizada por fecha o monto).
- Endpoint de confirmación manual de donación por el refugio (el monto declarado NO suma automáticamente al progreso).

**Frontend:** GUI-36 Campañas Refugio, GUI-37 Crear/Editar Campaña, GUI-13 Campañas Adoptante.

Depende de Fase 1 (refugio validado).

## Fase 11 — Mascotas perdidas y encontradas (Módulo 13)

**Entidades:** `Animal_Perdido`, `Estado_Animal_Perdido`.

**HUs:** HU-13.1 a HU-13.3 (registrar mascota perdida, reclamar perdida/encontrada, gestión de estados de publicación).

**Backend:** CRUD de Animal_Perdido, integrado con Chat para coordinar reencuentro, cierre al marcar "Resuelto".

**Frontend:** GUI-06 Mascotas Perdidas, GUI-25 Nueva pub perdida/encontrada.

Depende de Fase 2 (Mascota) y Fase 5 (Chat, para coordinar el reencuentro).

## Fase 12 — Dashboards, reportes y exportación (Módulo 14)

**Entidades:** ninguna nueva — son vistas agregadas sobre todo lo anterior.

**HUs:** HU-14.1 (dashboard admin global), HU-14.2 (dashboard refugio), HU-14.3 (exportación CSV).

**Backend:** endpoints de agregación/estadísticas, endpoint de exportación por streams (nunca cargar todo en memoria).

**Frontend:** exclusivamente **web-admin** — GUI-38 Dashboard Refugio, GUI-39 Dashboard Admin, GUI-40 Dashboard Admin Vacío, GUI-41 Error de Exportación.

Depende de que TODAS las fases anteriores tengan datos que agregar — se recomienda dejarla para el final o para hacerla en paralelo sobre datos de prueba mientras el resto avanza.

## Fase 13 — Soporte y ayuda (Módulo 15)

**HUs:** HU-15.1 (manual de usuario y FAQs), HU-15.2 (canal de contacto), HU-15.3 (gestión de FAQs). Spec 015.

Manual estático en el frontend; FAQs y consultas de contacto en base, administradas desde web-admin. Se puede hacer en cualquier momento, en paralelo, sin bloquear nada. Bajo prioridad.

## Orden resumido

```
Fase 0 (fundaciones)
  └─ Fase 1 (usuarios/roles/refugios)
       ├─ Fase 2 (mascotas/publicaciones)
       │    ├─ Fase 3 (favoritos/filtros)
       │    ├─ Fase 4 (solicitudes)
       │    │    ├─ Fase 5 (chat/notificaciones)
       │    │    │    └─ Fase 11 (perdidas y encontradas)
       │    │    ├─ Fase 6 (historia clínica)
       │    │    ├─ Fase 7 (seguimiento post-adopción)
       │    │    └─ Fase 8 (reputación)
       │    │         └─ Fase 9 (moderación)
       │    └─ Fase 9 (moderación, también depende de Fase 2)
       └─ Fase 10 (campañas)
Fase 12 (dashboards) — al final, transversal a todo
Fase 13 (soporte/FAQ) — en paralelo, sin dependencias
```

## Notas para Claude Code al usar este roadmap

- No saltar de fase sin que la anterior tenga al menos los endpoints CRUD básicos + validaciones core funcionando — varias fases dependen de FKs de fases anteriores (ver `docs/MODELO_DATOS.md` para las cardinalidades exactas antes de generar migraciones).
- Los cron jobs (Fase 4 y Fase 10) conviene implementarlos como jobs independientes y testeables por separado, no como lógica inline en el endpoint de consulta.
- Cuando una fase dice "Frontend: GUI-XX", esas GUIs están nombradas tal cual figuran en el documento de requisitos original — mantené esos nombres en comentarios o nombres de componentes para trazabilidad con la consigna académica.
