---
name: nuevo-modulo
description: Flujo paso a paso para crear o extender un módulo de este backend (Express + Prisma): usar cuando se pida un endpoint nuevo, un CRUD, un módulo de negocio, o implementar una spec de backend. Cubre el scaffold de 5 archivos, registro de rutas, validación Zod y tests.
---

# Nuevo módulo del backend

Procedimiento completo para agregar un módulo en `src/modules/`. Antes de empezar: **sin spec aprobada no se codea** — si `docs/specs/` no tiene la spec del módulo, frenar y proponer armarla con `docs/specs/SPEC_TEMPLATE.md`.

## Paso 0 — Contexto

1. Leer la spec aprobada del módulo en `docs/specs/`. Los contratos de API salen de ahí, no se inventan.
2. Verificar entidades y nombres de campo exactos en `docs/MODELO_DATOS.md`.
3. Revisar si ya existe una regla de validación genérica reutilizable en `src/shared/validation/` (ver "Validación" abajo).

## Paso 1 — Scaffold de los 5 archivos

Crear `src/modules/<modulo>/` con (patrón real en `src/modules/mascotas/`):

| Archivo | Responsabilidad | Prohibido |
|---|---|---|
| `<modulo>.dto.ts` | Schemas Zod de entrada/salida, compone helpers de `shared/validation/schemas.ts` con `LIMITES` de `limits.ts` | Validación genérica inline |
| `<modulo>.repository.ts` | Único punto de acceso a Prisma del módulo | Lógica de negocio |
| `<modulo>.service.ts` | Reglas de negocio: quotas, transiciones de estado, permisos | Importar Prisma directamente |
| `<modulo>.controller.ts` | HTTP puro: extrae datos, valida con DTO (`parsearOFallar`), llama service, responde. Errores con `AppError` de `middlewares/errorHandler` | Reglas de negocio |
| `<modulo>.routes.ts` | `Router()` exportado como `<modulo>Router`; aplica middlewares por ruta | — |

Cadena típica de middlewares (ver `mascotas.routes.ts`): `autenticar` → `uploadImagen('foto')` → `comprimirImagen`, y `requerirRol(...)` de `middlewares/roles.ts` para RBAC.

## Paso 2 — Registrar la ruta

En `src/routes/index.ts`: `apiRouter.use('/<recursos>', <modulo>Router)`. Recursos en plural español sin tildes (`/solicitudes`, `/campanas`). Borrar el comentario placeholder correspondiente.

## Paso 3 — Reglas transversales que no se negocian

- Auditoría en toda entidad: `usuario_alta`, `fecha_alta`, `usuario_modificacion`, `fecha_modificacion`, `usuario_baja`, `fecha_baja` (helpers en `shared/auditoria.ts`). Bajas siempre lógicas.
- Toda entrada pasa por Zod antes del service; toda salida de error usa el formato `{ error: { codigo, mensaje } }` vía `errorHandler` — nunca `res.status().json()` suelto con otro shape.
- Operaciones críticas escriben en `LogAuditoria` (`shared/logAuditoria.ts`).
- Quotas anti-spam si aplica (máx. 5 activas según entidad) — viven en el service.
- El backend no asume que una imagen recibida es confiable, aunque el frontend exija cámara nativa.

## Paso 4 — Tests

En `tests/unit/modules/<modulo>/`: testear el service mockeando el repository (es la razón de ser de la separación service/repository). Si hay lógica de fechas/estados cubrir bordes.

## Paso 5 — Verificación

```bash
npm run lint && npm test && npm run build
```
