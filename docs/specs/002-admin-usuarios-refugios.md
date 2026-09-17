# Spec 002 — Administración de Usuarios y Refugios (web-admin)

**Estado:** LISTO
**Fase:** 1 (Identidad y usuarios, Módulos 1 y 2 — ROADMAP.md) · **Responsable:** ncorrea-13 · **Última actualización:** 2026-08-24

## 1. Objetivo

Darle al administrador global la gestión de cuentas desde el panel web-admin: verificación de usuarios (DNI/teléfono), suspensión, baja lógica, gestión de roles, y ciclo completo de refugios (alta, validación, suspensión, baja).

## 2. Alcance

- **Incluye:** HU-2.1 (gestionar roles), HU-2.2 (validar refugio), HU-2.3 (validar usuarios), HU-2.4 (alta y baja de refugio), HU-2.5 (baja de usuario). También el endpoint de suspensión de usuario, que sirve a HU-3.4 (Módulo 3) pero es el mismo recurso.
- **NO incluye:** CRUD de catálogos especies/razas (contrato en API.ADMIN.md, spec propia — depende de Mascota, Fase 2); moderación/reportes (Módulo 3, entidad `ReporteProblema` no confirmada — ambigüedad #2 REQUISITOS.md §10); dashboards (spec 009); alta/baja de cuenta propia (HU-1.8, módulo `usuarios`); notificaciones al afectado (Módulo 4).

## 3. Entidades involucradas

Ningún cambio en `schema.prisma`. Se operan `Usuario`, `Rol`, `RolUsuario`, `Refugio`, `EstadoUsuario`, `EstadoRefugio` (ver MODELO_DATOS.md).

**Único dato nuevo:** valor `Suspendido` en el catálogo `Estado_Refugio` (hoy solo existen `Pendiente_Verificacion`, `Activo`, `Inactivo` — `prisma/seed.ts:50`). Se agrega vía seed dedicado `prisma/seed-admin-usuarios.ts` (mismo patrón que `seed-dashboard.ts`: se corre a mano, sin hook en package.json):

```bash
npx tsx prisma/seed-admin-usuarios.ts
```

Sin migración — es un INSERT en tabla catálogo.

## 4. API (contrato backend)

Todos bajo `/api/v1/admin`, JWT + rol `Administrador`. Contrato fuente: `pethood-frontend/apps/web-admin/API.ADMIN.md` (actualizado en este mismo cambio).

| Método | Ruta | Descripción |
|---|---|---|
| GET | /admin/usuarios | Listado paginado de usuarios |
| PATCH | /admin/usuarios/:id/verificar | HU-2.3 — verifica DNI/teléfono |
| PATCH | /admin/usuarios/:id/suspender | Suspende (estado `Suspendido`) |
| PATCH | /admin/usuarios/:id/reactivar | `Suspendido` → `Activo` |
| PATCH | /admin/usuarios/:id/baja | HU-2.5 — baja lógica |
| PATCH | /admin/usuarios/:id/roles | HU-2.1 — agrega/quita roles |
| POST | /admin/refugios | HU-2.4 — alta de refugio |
| GET | /admin/refugios | Listado paginado de refugios |
| GET | /admin/refugios/:id | Detalle (miembros + resumen actividad) |
| PATCH | /admin/refugios/:id/verificar | HU-2.2 — habilita a operar |
| PATCH | /admin/refugios/:id/suspender | Suspende (estado `Suspendido`) |
| PATCH | /admin/refugios/:id/reactivar | `Suspendido` → `Activo` |
| PATCH | /admin/refugios/:id/baja | HU-2.4 — baja lógica |

### Convenciones

- **Estados** (valores literales del catálogo, igual que `ESTADO_USUARIO` en shared): `Pendiente_Verificacion`, `Activo`, `Suspendido`, `Inactivo`. API.ADMIN.md usaba antes `PEND_VERIFICACION`/`ACTIVO` — corregido.
- **Roles**: códigos API existentes de spec 001 (`shared/roles.ts`): `ADMIN`, `ADOPTANTE`, `MIEMBRO_REFUGIO` — mapean a `Administrador`/`Adoptante`/`Refugio` de la BD. No se inventan nombres nuevos.
- Respuesta plana sin envelope, errores `{ error: { codigo, mensaje } }`.

### Ejemplos no triviales

```
PATCH /admin/usuarios/5/suspender        ← también baja: { "motivo": "..." } requerido
→ 200 { "mensaje": "...", "usuario": { "id": 5, "estado": "Suspendido" } }

PATCH /admin/usuarios/5/roles
body { "agregar": ["MIEMBRO_REFUGIO"], "quitar": [] }
→ 200 { "mensaje": "...", "roles": ["ADOPTANTE", "MIEMBRO_REFUGIO"] }
   + si agrega MIEMBRO_REFUGIO: body admite opcional "refugioId" para asignar el refugio

POST /admin/refugios
body { "nombre": "Refugio Patitas", "direccion": "Av. San Martin 1234",
       "telefono": "+54 261 555-1234", "email": "patitas@refugio.com",
       "descripcion": "..." }
→ 201 — crea con estado `Pendiente_Verificacion` y verificado=false
```

Errores por endpoint: `404 *_NO_ENCONTRADO`; transición de estado inválida → `409 ESTADO_INVALIDO` / `USUARIO_YA_SUSPENDIDO` / `USUARIO_YA_VERIFICADO` / `REFUGIO_YA_*`; `403 NO_SE_PUEDE_SUSPENDER_ADMIN` (también aplica a baja); `403 NO_SE_PUEDE_EDITAR_ADMIN` (roles, incluye auto-edición); `409 ULTIMO_ADMINISTRADOR` (roles); `409 DATOS_INCOMPLETOS` (verificar usuario sin dni/teléfono); `400 VALIDACION` (motivo vacío, body inválido, paginación inválida).

## 5. Pantallas (frontend — solo web-admin)

- Listado de usuarios con filtros (búsqueda, rol, estado, verificado) — acciones por fila según estado actual.
- Modal confirmación para suspender/baja (con campo motivo obligatorio) — regla transversal #6, voseo.
- Detalle de refugio (modal previo a verificar): datos + miembros + resumen.
- Alta de refugio (formulario).
- Gestión de roles: selector sobre el detalle del usuario.

Contrato visual completo en API.ADMIN.md. El backend valida todo; el frontend solo anticipa para UX.

## 6. Reglas de negocio y validaciones

1. Solo rol `Administrador` (`middlewares/roles.ts`) en todos los endpoints.
2. **Transiciones de usuario** (service, no controller):
   - `Pendiente_Verificacion` --verificar--> `Activo`
   - `Activo` --suspender--> `Suspendido` --reactivar--> `Activo`
   - baja: permitida desde cualquier estado activo/en verificación/suspendido → setea `fechaBaja`, `usuarioBaja` y estado `Inactivo`.
   - La baja **no tiene reversión por API** (reingreso = flujo de registro; evita semántica ambigua de "resucitar" cuentas con contenido asociado).
3. **Verificar usuario exige datos**: si `dni` o `telefono` son null (ej. cuenta Google) → `409 DATOS_INCOMPLETOS`. No se puede verificar lo que no existe.
4. **Blindaje de administradores**: ningún endpoint admin puede suspender, dar de baja ni quitar roles a un usuario con rol `ADMIN` (incluye auto-bloqueo). Excepción: verificar un admin sí se permite.
5. **Nunca cero administradores**: quitar rol ADMIN solo si queda otro usuario activo con ese rol.
6. `motivo` obligatorio en suspender y baja (1-500 chars, `textoSchema`); se persiste en `LogAuditoria` (append-only) junto con id del admin — `Usuario` no tiene columna de motivo y no se agregan campos solo para esto.
7. Auditoría estándar: toda mutación setea `usuarioModificacion`/`fechaModificacion` (o `usuarioBaja`/`fechaBaja`); operaciones críticas además escriben `LogAuditoria` (regla transversal #1).
8. **JWT stateless**: suspender/baja no invalida tokens emitidos (regla transversal #3) — el bloqueo hace efecto en el próximo login/refresh (`auth.service.ts:58-66` ya rechaza `Suspendido` e `Inactivo`). Documentado, no es bug.
9. **Transiciones de refugio**: `Pendiente_Verificacion` --verificar--> `Activo` (setea `verificado=true`); `Activo` --suspender--> `Suspendido` --reactivar--> `Activo`; baja lógica desde cualquier estado → `fechaBaja` + estado `Inactivo`.
10. Alta de refugio (POST): siempre nace `Pendiente_Verificacion`/`verificado=false` — un solo camino hacia `Activo` (pasar por HU-2.2), sin atajos.
11. Suspensión de refugio **no bloquea acá** la publicación de sus miembros — ese enforcement vive en los servicios de Mascotas/Publicaciones/Campañas cuando se construyan (deben consultar estado del refugio). Esta spec deja la nota, no implementa módulos ajenos.
12. Paginación: `page ≥ 1`, `1 ≤ limit ≤ 50`; filtros con Zod en `dto.ts` componiendo `src/shared/validation/` (nada de validación genérica inline).
13. Capas: routes → controller (HTTP puro) → service (transiciones y blindajes) → repository (Prisma). Service testeable con repository mockeado.

## 7. Criterios de aceptación

- [ ] Given soy admin, When listo usuarios con filtro `rol=MIEMBRO_REFUGIO&estado=Pendiente_Verificacion`, Then solo recibo esos usuarios, paginados.
- [ ] Given usuario en `Pendiente_Verificacion` con dni y teléfono, When verifico, Then pasa a `Activo`, `verificado=true`, queda en LogAuditoria.
- [ ] Given usuario sin dni (cuenta Google), When verifico, Then `409 DATOS_INCOMPLETOS`.
- [ ] Given usuario `Activo`, When suspendo con motivo, Then estado `Suspendido` y su próximo login falla con 403.
- [ ] Given usuario `Suspendido`, When reactivo, Then vuelve a `Activo` y puede loguear.
- [ ] Given usuario con rol ADMIN, When intento suspenderlo/bajarlo/quitarle roles, Then `403`/`409` según corresponda, nunca se ejecuta.
- [ ] Given existe un solo administrador activo, When otro admin le quita el rol ADMIN a ese usuario, Then `409 ULTIMO_ADMINISTRADOR` y el rol no se modifica.
- [ ] Given un admin intenta modificar sus propios roles (auto-edición), Then `403 NO_SE_PUEDE_EDITAR_ADMIN`, sin importar si quedan otros admins.
- [ ] Given usuario cualquiera, When doy de baja con motivo, Then `fechaBaja`/`usuarioBaja` seteados, estado `Inactivo`, login rechazado, y desaparece de listados con filtro default.
- [ ] Given refugio `Pendiente_Verificacion`, When verifico, Then `Activo` + `verificado=true`.
- [ ] Given refugio creado por POST, When consulto su detalle, Then figura en `Pendiente_Verificacion` con verificado=false.
- [ ] Given refugio `Activo`, When suspendo/reactivo/doy de baja, Then mismas semánticas que usuario (estados y auditoría).
- [ ] Given adoptante o refugio llamando cualquier endpoint, Then `403 ROL_NO_AUTORIZADO`.
- [ ] Given motivo vacío o >500 chars, Then `400 VALIDACION`.

## 8. Casos borde y errores

- Id inexistente → 404 con código específico (`USUARIO_NO_ENCONTRADO` / `REFUGIO_NO_ENCONTRADO`).
- Transición repetida (ya verificado, ya suspendido) → 409, mensaje accionable.
- Auto-suspensión / auto-baja del admin → bloqueada por regla 4.
- Quitar rol a usuario inexistente o rol inexistente en `agregar/quitar` → 400 con el rol culpable en el mensaje.
- `agregar` y `quitar` con el mismo rol → 400 (ambiguo).
- Agregar `MIEMBRO_REFUGIO` sin `refugioId` → 400 (un miembro sin refugio es estado inválido del modelo).
- Búsqueda con caracteres especiales / SQL-like → parametrizada por Prisma, sin riesgo; `%` tratado literal.
- Concurrencia: dos admins verifican a la vez → segunda operación recibe 409 por re-chequeo de estado en el UPDATE condicional (`where` incluye estado esperado).
- BD sin seed de catálogos → service falla temprano con error claro (patrón `exigirCatalogos` de auth.service).

## 9. Notas y decisiones

- 2026-08-24 (ncorrea-13): el contrato preexistente en API.ADMIN.md tenía gaps contra las HUs; resueltos con el equipo: (a) se agregan endpoints de baja+reactivación para usuario y refugio; (b) se agrega alta de refugio (HU-2.4 es "alta Y baja"); (c) se agrega gestión de roles (HU-2.1); (d) `Suspendido` se suma al catálogo `Estado_Refugio` vía seed del módulo, no tocando `seed.ts` compartido.
- 2026-08-24 (ncorrea-13): **corrección sobre decisión inicial** — se había acordado usar nombres crudos de BD para roles, pero spec 001 ya fija códigos API (`ADOPTANTE`/`MIEMBRO_REFUGIO`/`ADMIN`) con traducción centralizada en `shared/roles.ts`; cambiar solo este módulo rompería consistencia. Prevalecen los códigos API. Los estados sí usan valores literales del seed (`Pendiente_Verificacion`…), corrigiendo API.ADMIN.md que documentaba `PEND_VERIFICACION`.
- 2026-08-24 (ncorrea-13): baja de usuario sin reversión por API — deliberado. Reactivar una baja confundiría los dos caminos ("suspendí" vs "eliminé"); si el equipo pide des-baja, se especifica aparte.
- Suspender usuario vive acá aunque su HU sea la 3.4 (Módulo 3): el recurso es el mismo y Módulo 3 solo lo invoca tras un reporte.
- Catálogos especies/razas y moderación quedan fuera a propósito: dependen de Fase 2 y de la entidad `ReporteProblema` respectivamente. Sus contratos ya bosquejados en API.ADMIN.md no cambian con esta spec salvo nombres de estados.
