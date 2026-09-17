# Spec 001 — Gestión de Perfiles y Autenticación

**Estado:** BORRADOR
**Sprint:** 1 · **Responsable:** (asignar) · **Última actualización:** 2026-07-06

## 1. Objetivo

Permitir que cualquier persona se registre como Adoptante o Refugio, inicie sesión de forma segura y gestione su perfil. Es la base de todos los demás módulos.

## 2. Alcance

- **Incluye:** registro con selector de rol, login/logout, recuperación de contraseña, edición de perfil (foto, datos, contraseña), JWT + middleware de auth y roles, **login social OAuth 2.0 con Google**.
- **NO incluye:** moderación/baneos (spec 008), verificación de refugios por admin (spec 008).

## 3. Entidades involucradas

Usuario, Rol, Usuario_Rol, Bio_Usuario, Refugio, Refugio_Miembro (ver MODELO_DATOS.md). El registro como Refugio crea el Usuario + el Refugio en estado `PEND_VERIFICACION` y lo vincula vía Refugio_Miembro.

## 4. API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | /api/v1/auth/registro | público | Crea usuario (JSON o multipart con foto opcional `imagen`; si `R2_ENABLED=true` sube a R2 y guarda solo la URL) |
| POST | /api/v1/auth/login | público | Devuelve JWT + datos básicos del usuario |
| POST | /api/v1/auth/logout | JWT | Invalida sesión (client-side; opcional blacklist) |
| POST | /api/v1/auth/google | público | Login/registro con ID token de Google (mobile) |
| GET | /api/v1/auth/google | público | Redirige al consentimiento OAuth 2.0 de Google (web) |
| GET | /api/v1/auth/google/callback | público | Intercambia el code de Google y redirige al frontend con JWT |
| POST | /api/v1/auth/recuperar | público | Envía (o, en dev, devuelve) un código de 6 dígitos para resetear. No revela si el email existe. |
| POST | /api/v1/auth/resetear | público | Cambia la contraseña con email + código válido |
| GET | /api/v1/usuarios/me | JWT | Perfil propio (datos, foto, barrio/ciudad, conteos de mascotas/favoritos y valoración) |
| PATCH | /api/v1/usuarios/me | JWT | Edita nombre, apellido, email, teléfono, ubicación y foto (`multipart` campo `imagen`) |
| PATCH | /api/v1/usuarios/me/password | JWT | Cambia contraseña (exige la actual si la cuenta ya tiene una) |

Ejemplo registro:

```json
POST /api/v1/auth/registro
{ "nombre": "Ana", "apellido": "Pérez", "email": "ana@mail.com",
  "password": "********", "telefono": "+54 261 ...", "rol": "ADOPTANTE" }
→ 201 { "usuario": { "id": 1, "email": "...", "roles": ["ADOPTANTE"] }, "token": "..." }
```

Ejemplo login Google (mobile, ID token):

```json
POST /api/v1/auth/google
{ "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." }
→ 200 { "usuario": { "id": 1, "email": "...", "roles": ["ADOPTANTE"] }, "token": "..." }
```

Errores: `400 VALIDACION`, `409 EMAIL_DUPLICADO`, `401 CREDENCIALES_INVALIDAS`, `429 DEMASIADOS_INTENTOS`, `503 GOOGLE_NO_CONFIGURADO`.

## 5. Pantallas

1. **Registro:** foto opcional, datos personales, selector de rol (Adoptante/Refugio — si Refugio, campos extra del refugio), validaciones inline (email válido, contraseña ≥ 8 con mayúscula y número, confirmación).
2. **Login:** email + contraseña, link "¿Olvidaste tu contraseña?", errores sin revelar si el email existe.
3. **Recuperación:** ingreso de email → mensaje genérico de envío.
4. **Edición de perfil:** cambio de foto, datos y contraseña; modal de confirmación al descartar cambios sin guardar.

## 6. Reglas de negocio y validaciones

1. Email único (backend, índice único + error 409).
2. Contraseña hasheada con bcrypt (costo ≥ 10); nunca viaja ni se loguea en texto plano.
3. Usuario nuevo nace `PEND_VERIFICACION`; pasa a `ACTIVO` al verificar email (si el email no se implementa en sprint 1, nace ACTIVO y se documenta la deuda).
4. Refugio nuevo nace `PEND_VERIFICACION` hasta aprobación del admin (spec 008); mientras tanto puede completar su perfil pero no publicar.
5. JWT expira (ej. 7 días); rutas privadas exigen token válido; rutas de refugio exigen rol MIEMBRO_REFUGIO.
6. Registro y cambios de contraseña generan entrada en LogAuditoria.

## 7. Criterios de aceptación

- [ ] Puedo registrarme como adoptante y quedo logueado (token recibido).
- [ ] Puedo registrarme como refugio y se crea el refugio en PEND_VERIFICACION.
- [ ] No puedo registrarme con un email ya usado (mensaje claro).
- [ ] Login con credenciales inválidas devuelve error genérico sin distinguir email/contraseña.
- [ ] Puedo editar mi perfil y ver los cambios reflejados.
- [ ] Descartar cambios en edición muestra modal de confirmación.
- [ ] Un request sin token a una ruta privada devuelve 401.
- [ ] Las contraseñas en la base están hasheadas (verificable en la tabla).

## 8. Casos borde

Token expirado (401 + redirección a login) · doble submit de registro (idempotencia por email único) · pérdida de conexión al guardar perfil (reintento, sin duplicar) · usuario SUSPENDIDO intenta loguear (403 con mensaje de contacto).

## 9. Notas y decisiones

- 2026-07-06: spec inicial generada a partir de historias de usuario (Integrante 1). Pendiente revisión del equipo.
- 2026-08-17: se agrega OAuth 2.0 con Google. El registro mobile envía `nombre`, `apellido`, `email`, `password`, `fechaNacimiento` y `telefono` (DNI opcional). `usuario_dni` y `usuario_contraseña` pasan a ser nullable para cuentas Google. El JWT incluye `usuarioId`, `id` (alias), `email` y `roles` en códigos de API (`ADOPTANTE` / `MIEMBRO_REFUGIO` / `ADMIN`).
- 2026-08-18: HU-1.3 a HU-1.6. `GET/PATCH /usuarios/me` cubren visualizar/editar/completar perfil (foto + barrio/ciudad). La foto se persiste en R2 si está habilitado, o en disco local. `POST /auth/recuperar` genera un código de 6 dígitos (en development/test viaja en la respuesta porque no hay SMTP). `POST /auth/resetear` lo consume. `PATCH /usuarios/me/password` actualiza la contraseña estando autenticado.
