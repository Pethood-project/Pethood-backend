# MAIL.md — Envío de correo (insumo para una spec futura)

> Borrador de relevamiento, **no es una spec**. Junta lo que hay que decidir y todos los puntos del backend donde un correo tendría sentido, para escribir después la spec de correo sin tener que volver a buscar. Relevado el **2026-10-01**.

## 1. Estado actual

- **No hay ningún servicio de correo.** No hay `nodemailer`, Resend, SMTP ni `src/shared/mailer.ts`, y `env.ts`/`.env.example` no tienen variables de mail.
- Lo único que se le parece es el aviso **in-app**: la tabla `Notificacion` (`tipo`, `mensaje`, `leido`, `usuarioId`), escrita por `crearNotificacion` en `seguimiento`, `admin-publicaciones` y `admin-mascotas`. **Ningún endpoint la lee todavía** (deuda #27).
- `REQUISITOS.md` ya promete correo en dos HU y deja una puerta abierta en otra:
  - HU-1.1: «envía email de confirmación» al registrarse.
  - HU-1.6: «Recuperación de contraseña vía email».
  - Módulo 4: «push + posible email».
  - HU-15.2 aclara «sin envío de mails por ahora» para soporte.

## 2. Puntos donde aplicaría

### A. Ya prometido por los requisitos (los que rompen una HU hoy)

| # | Punto | Dónde | Qué pasa hoy | Correo |
|---|---|---|---|---|
| 1 | **Recuperar contraseña** (HU-1.6) | `auth.service.ts` `solicitarRecuperacion` (~l.316-335) | Genera un código de 6 dígitos y, fuera de producción, lo imprime con `console.info`. En producción **no se entrega**: el flujo no funciona. | Código de recuperación al email. **Es el más urgente.** |
| 2 | **Confirmación de registro** (HU-1.1) | `auth.service.ts` `registrar` (~l.130) | No se envía nada. | Bienvenida o confirmación. La HU dice «envía email de confirmación». No hay verificación de email, así que hay que decidir si es solo aviso o un enlace de confirmación. |

### B. Notificaciones del Módulo 4 (hoy sin canal de lectura ni correo)

| # | Evento | HU | Dónde se dispara | Destinatario |
|---|---|---|---|---|
| 3 | Solicitud aceptada o rechazada | HU-4.1 | `solicitudes.service.ts` `resolverSolicitud` (~l.481) | Adoptante |
| 4 | Solicitud nueva | HU-4.2 | `solicitudes.service.ts` `crearSolicitud` (~l.336) | Refugio (miembros) o publicador |
| 5 | Mensaje nuevo en chat | HU-4.3 | `chats.service.ts` `enviarMensaje` (~l.531) | La otra parte, **solo si está offline** (`websockets/presencia.ts`) |
| 6 | Seguimiento pedido o vencido | HU-4.4 | `seguimiento.service.ts` (~l.255, tipo `SEGUIMIENTO_VENCIDO`) | Adoptante |
| 7 | Pregunta del refugio fuera de secuencia | HU-4.4 | `seguimiento.service.ts` `enviarPregunta` (~l.552, `SEGUIMIENTO_PREGUNTA_REFUGIO`) | Adoptante |
| 8 | Actualización del seguimiento subida | HU-4.5 | `seguimiento.service.ts` `subirActualizacion` (~l.682) | Refugio |
| 9 | Solicitud cancelada por vencimiento | HU-7.6 | `jobs/cancelar-solicitudes-vencidas.job.ts` | Solicitante (hoy no se le avisa) |

### C. Moderación y administración

| # | Evento | Dónde | Destinatario |
|---|---|---|---|
| 10 | Reporte resuelto (spec 008) | `reportes.service.ts` (nuevo) | Reportante |
| 11 | Baja de publicación por el admin | `admin-publicaciones.service.ts` `darDeBaja` (~l.126; ya crea `Notificacion`) | Dueño |
| 12 | Baja de mascota por el admin | `admin-mascotas.service.ts` (~l.86; ya crea `Notificacion`) | Dueño |
| 13 | **Suspensión** de usuario | `admin-usuarios.service.ts` `suspenderUsuario` (~l.121) | Usuario (hoy se entera al loguearse, `USUARIO_SUSPENDIDO`) |
| 14 | Suspensión / reactivación de refugio | `suspenderRefugio` (~l.342), `reactivarRefugio` (~l.367) | Refugio |
| 15 | Reactivación de usuario | `reactivarUsuario` (~l.154) | Usuario |
| 16 | Baja de usuario / refugio por el admin | `bajaUsuario` (~l.174), `bajaRefugio` (~l.387) | Afectado |
| 17 | **Refugio verificado** (HU-2.2) | `verificarRefugio` (~l.315) | Refugio: ya puede operar |
| 18 | **Usuario verificado** (spec 002.1) | `verificarUsuario` (~l.86) | Usuario |

### D. Cuenta y seguridad (no pedidos por una HU, valen por seguridad)

| # | Evento | Dónde | Por qué |
|---|---|---|---|
| 19 | Contraseña cambiada | `usuarios.service.ts` `cambiarPassword` (~l.188) y `auth.service.ts` `resetearPassword` (~l.341) | Aviso de seguridad por si no fue la persona |
| 20 | Cuenta reactivada al volver a loguearse | `auth.service.ts` `reactivarCuentaPropia` (~l.84) | Mismo motivo |

### E. Soporte (HU-15.x)

| # | Evento | Dónde | Nota |
|---|---|---|---|
| 21 | Consulta de soporte recibida | `soporte.service.ts` `enviarConsulta` (~l.66) | Acuse al remitente. |
| 22 | Consulta resuelta | `soporte.service.ts` `resolverConsulta` (~l.75) | `ConsultaSoporte` guarda el email del remitente. **Pero hoy el admin no escribe una respuesta**: solo marca «resuelta». Para mandar algo útil haría falta un campo de respuesta. |

## 3. Qué decidir en la spec de correo

1. **Proveedor.** Resend o Brevo por HTTP (`fetch`, sin dependencia) o SMTP con `nodemailer`. Hay que decidir cuenta, remitente y dominio (¿se puede verificar uno?). Resend gratis: 100/día, 3000/mes.
2. **Forma del código.** `src/shared/mailer.ts` con `enviarCorreo({ a, asunto, texto })`, ramificado por `MAIL_ENABLED` igual que `storage.ts` con `R2_ENABLED`. Si está apagado, loguea y no envía (dev y tests no tocan la red). Variables en `env.ts` (Zod) y `.env.example`.
3. **Sincrónico o en cola.** Un `await` dentro del request alarga la respuesta y puede romperla si el proveedor falla. Mínimo aceptable: no esperar y capturar el error (un correo caído nunca debe romper una acción de negocio). Cola o reintentos: post-MVP.
4. **Qué puntos entran.** Propuesta: A completo (1 y 2) + 13 y 17 como primer corte. B según se haga el Módulo 4. El resto, después.
5. **Correo vs. `Notificacion`.** Un solo punto de entrada («avisar a un usuario») que escriba la fila y, si el tipo lo amerita, mande el correo. Evita duplicar la lógica en cada service. Decidir si respeta una preferencia del usuario (¿lo puede apagar?).
6. **Plantillas.** Texto plano en voseo rioplatense, igual que el feedback visual. Sin HTML al principio.
7. **Privacidad.** El correo no debe incluir datos sensibles (teléfono, DNI, motivos internos del admin) salvo lo estrictamente necesario. El código de recuperación va en el cuerpo, con vencimiento corto (el store ya lo maneja en `auth.resetStore`).
8. **Verificación de email al registrarse.** HU-1.1 dice «confirmación», pero no hay modelo de email verificado. Decidir si es solo un aviso o un flujo con enlace.

## 4. Fuera de alcance de este relevamiento

- **Push** (HU-4.3 menciona notificaciones push): canal distinto, con su propia spec.
- Cómo se lee `Notificacion` en la app (deuda #27): se resuelve en el Módulo 4, antes o junto con el correo.
- Correo a refugios por campañas o donaciones (Módulo 12): no relevado.
