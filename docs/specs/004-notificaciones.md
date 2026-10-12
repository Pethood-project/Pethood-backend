# Spec 004 — Notificaciones

**Estado:** APROBADA
**Sprint:** 13 (entrega 13/10) · **Responsable:** equipo · **Última actualización:** 2026-09-29

## 1. Objetivo

Avisar a cada usuario de lo que le importa (HU-4.1 a HU-4.5) por tres canales — mail, push y bandeja dentro de la app — con la bandeja como fuente de verdad: todo lo que se notifica queda ahí, se haya podido enviar o no por los otros dos canales.

## 2. Alcance

- **Incluye (Fase 1, esta entrega):** modelo de datos de notificaciones y dispositivos push; servicio central `notificar(...)` que usan el resto de los módulos; API de bandeja (listar, contador, marcar leída/todas, eliminar, registrar/quitar dispositivo); envío de push y mail en segundo plano con reintentos; aviso en tiempo real a la app abierta; tareas programadas de los escenarios de Fase 1; app mobile (permiso, registro/baja de dispositivo, campana con contador, pantalla de bandeja, navegación al tocar).

  Escenarios cubiertos: Cuenta (bienvenida, verificación de mail, recuperar contraseña, contraseña cambiada, perfil incompleto), Solicitudes de adopción (HU-4.1, HU-4.2 y los escenarios extra del documento fuente: pendiente hace muchos días, cancelada por vencida HU-7.6, mascota adoptada por otro, publicación baja/pausada, favorito no disponible, adopción completada), Chat (HU-4.3, agrupado), Seguimiento post-adopción (HU-4.4, HU-4.5, recordatorio 24h, vencido 48h, varios seguidos sin completar, tránsito por comenzar/por vencer), Refugios y administración (registro pendiente, aprobado/rechazado, nuevo refugio para el admin, usuario validado, cuenta suspendida, cuenta dada de baja).

- **NO incluye (pausado, ver `docs/DEUDA_TECNICA.md`):** Campañas, Mascotas Perdidas/Encontradas, Reputación, Moderación (salvo "cuenta suspendida", que sí está en Fase 1), Historia Clínica, Soporte, y todo lo de "Fase 3" del documento fuente (resumen semanal, mantenimiento programado, etc.). Se retoman cuando esos módulos estén más maduros.
- **NO incluye geolocalización:** el proyecto no usa GPS en ningún lado (ver `ARQUITECTURA.md`); no aplica a esta entrega de todos modos porque el único escenario que la mencionaba (mascota perdida en la zona) es Fase 2.
- **NO incluye preferencias de notificación por usuario** en esta entrega (asumido, sin objeción).

## 3. Entidades involucradas

Ver `MODELO_DATOS.md` para el detalle completo.

- `Notificacion` (existente, se extiende): agrega `entidadTipo`/`entidadId` (navegación polimórfica, no FK).
- `DispositivoPush` (nueva): `usuarioId FK`, `expoPushToken`, `plataforma`, únicos por `(usuarioId, expoPushToken)`.

## 4. API (contrato backend)

Todas bajo `/api/v1/notificaciones`, requieren `autenticar`. Un usuario solo ve y modifica sus propias notificaciones (nunca se expone si una notificación de otro usuario existe: los accesos cruzados devuelven 404).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/notificaciones` | Paginado por cursor (`cursor`, `limite`) → `{ notificaciones, hayMas, proximoCursor }`, más nuevas primero. |
| GET | `/notificaciones/no-leidas/contador` | `{ contador }`. |
| POST | `/notificaciones/:id/leida` | Marca una como leída. 404 si no es propia. |
| POST | `/notificaciones/leidas` | Marca todas las propias como leídas. |
| DELETE | `/notificaciones/:id` | Baja lógica ("eliminar" de la bandeja). 404 si no es propia. |
| POST | `/notificaciones/dispositivos` | Body `{ expoPushToken, plataforma }`. Upsert del dispositivo del usuario autenticado. |
| DELETE | `/notificaciones/dispositivos/:expoPushToken` | Baja lógica del dispositivo (logout). |

Errores con el formato estándar `{ error: { codigo, mensaje } }`.

## 5. Pantallas (frontend)

- **Campana con contador** (navbar superior, no en las tabs inferiores): visible en las pantallas principales autenticadas. El contador se actualiza en tiempo real por socket mientras la app está abierta.
- **Bandeja** (`app/notificaciones/index.tsx`): lista paginada de más reciente a más antigua, distinción visual leída/no leída, acción marcar todas como leídas, acción eliminar por ítem, estado vacío ("Todavía no tenés notificaciones"). Tocar un ítem navega a la pantalla de la entidad referenciada (`entidadTipo`/`entidadId`) y la marca como leída.
- **Aviso amable de permiso de push no otorgado**, sin bloquear el resto de la app (regla 11).

## 6. Reglas de negocio y validaciones

Numeradas igual que el documento fuente del usuario, para trazabilidad:

1. Toda notificación se persiste siempre en la bandeja, se envíe o no por otro canal.
2. Push y mail se suman según la urgencia del escenario (definida por quien llama a `notificar(...)`); el mail se reserva para cuenta, seguridad, decisiones sobre solicitudes y vencimientos.
3. Si el usuario tiene la app abierta (hay un socket conectado con ese `usuarioId`), no se envía push: solo se actualiza la bandeja/campana en tiempo real.
4. Los mensajes de chat se notifican solo si el destinatario no tiene esa conversación abierta en ese momento (sala de socket específica, más fino que la regla 3), y los mensajes seguidos se agrupan en una sola notificación ("Tenés N mensajes nuevos de X").
5. Al tocar una notificación se navega a la pantalla correspondiente.
6. El texto de push no muestra datos sensibles.
7. Los avisos marcados como no urgentes no suenan de noche (22:00–08:00, hora de Argentina): se entregan igual, sin sonido.
8. Un usuario solo puede ver y modificar sus propias notificaciones.
9. La bandeja resuelve: paginado, leídas/no leídas, marcar una, marcar todas, eliminar (baja lógica), estado vacío.
10. Al cerrar sesión, el dispositivo deja de recibir push de esa cuenta (baja lógica de `DispositivoPush`); un usuario puede tener varios dispositivos activos.
11. Sin permiso de push otorgado, se avisa amablemente pero la bandeja sigue funcionando entera.
12. Tono voseo argentino en todos los textos.
13. Auditoría estándar completa en `Notificacion` y `DispositivoPush`.

No se notifica (regla explícita del documento fuente): confirmaciones de algo que el usuario acaba de hacer, que alguien vio/favoriteó tu publicación, que alguien te reportó (solo al reportante cuando se resuelve — Fase 2 de todos modos), cada mensaje de chat por separado cuando llegan varios seguidos.

## 7. Criterios de aceptación

- [ ] Al aceptarse/rechazarse una solicitud, el adoptante recibe mail + push (si offline) + fila en bandeja, con `entidadTipo='SOLICITUD'`.
- [ ] Con la app abierta (socket conectado), un evento que dispararía push no genera push, solo actualiza el contador en tiempo real.
- [ ] Tres mensajes de chat seguidos sin abrir la conversación generan UNA fila en bandeja ("Tenés 3 mensajes nuevos de X"), no tres.
- [ ] `GET /notificaciones` de un usuario nunca devuelve filas de otro usuario; `POST .../leida` y `DELETE` sobre una notificación ajena devuelven 404.
- [ ] Cerrar sesión da de baja el dispositivo push de esa sesión; otro dispositivo del mismo usuario sigue recibiendo push.
- [ ] Sin permiso de push otorgado, el resto de la app (incluida la bandeja) sigue funcionando sin errores.
- [ ] Los jobs programados (seguimiento 24h/48h, solicitud sin responder, tránsito por comenzar/vencer) generan las notificaciones esperadas sin duplicar en corridas sucesivas (idempotentes).

## 8. Casos borde y errores

- Token de push inválido (`DeviceNotRegistered` de Expo) → se da de baja el `DispositivoPush` automáticamente, no se reintenta.
- Fallo transitorio de Resend o de Expo → reintento con backoff (hasta 3 intentos); si se agotan, la notificación ya quedó en bandeja igual (no se pierde el aviso, solo el canal extra).
- Notificación cuya entidad referenciada ya no existe (ej. la solicitud fue borrada) → el cliente la muestra igual, y al tocarla informa que ya no está disponible en vez de romper la navegación.
- Usuario sin dispositivos push registrados → el paso de push se omite sin error; la bandeja y el mail no dependen de eso.

## 9. Notas y decisiones

- **Proveedor de mail:** Resend (tier gratis, SDK de Node simple). Elegido por el equipo para esta entrega — 2026-09-29.
- **Proveedor de push:** Expo Push Notifications (`expo-server-sdk` + `expo-notifications`), nativo del stack. Requiere development build (EAS) para probarse de punta a punta: Expo Go no soporta push remoto desde el SDK 53. Decisión y aclaración con el usuario — 2026-09-29.
- **Cola de reintentos:** BullMQ + Redis (Upstash, tier free), worker en el mismo proceso que Express/Socket.io — mismo criterio ya usado para los websockets (no requiere un segundo servicio).
- **Tareas programadas:** se implementan como *repeatable jobs* de BullMQ (no como CLI + cron del SO, que es el patrón de `jobs/cancelar-solicitudes-vencidas.job.ts`) porque el worker de BullMQ ya va a estar corriendo en el proceso — un solo mecanismo de background work en vez de dos. El job de HU-7.6 existente no se toca en su mecanismo.
- **Fases 2 y 3 del documento fuente quedan pausadas** hasta que Campañas, Mascotas Perdidas (el resto de sus escenarios), Reputación, Moderación completa, Historia Clínica y Soporte estén más maduros — decisión del usuario, 2026-09-29.
