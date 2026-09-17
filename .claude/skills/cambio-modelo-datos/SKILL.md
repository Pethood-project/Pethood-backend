---
name: cambio-modelo-datos
description: Cambiar el modelo de datos de este backend (schema.prisma, migraciones Prisma, entidades, campos) y sincronizar los límites compartidos limits.ts con el repo hermano: usar cuando se agregue, modifique o elimine una entidad o campo, o haya que tocar validaciones compartidas.
---

# Cambio de modelo de datos

Procedimiento para evolucionar el modelo sin romper los dos repos. La trampa principal del proyecto: `limits.ts` está **duplicado a mano** entre backend y frontend porque son repos separados sin import posible.

## Paso 0 — Confirmar el modelo conceptual

Verificar en `docs/MODELO_DATOS.md` atributos, PK/FK y cardinalidades exactas. No inventar campos. Si el cambio contradice el documento, actualizar la decisión con el equipo antes de tocar código.

## Paso 1 — Schema y migración

```bash
# editar prisma/schema.prisma
npx prisma migrate dev --name <descripcion-corta>
npx prisma generate   # si el cliente no se regeneró solo
```

Reglas del schema:

- Toda entidad nueva lleva auditoría completa: `usuario_alta`, `fecha_alta`, `usuario_modificacion`, `fecha_modificacion`, `usuario_baja`, `fecha_baja`. Bajas lógicas, nunca DELETE físico.
- Excepciones conocidas: `Mensaje` solo tiene alta; `Historia_Clinica` nunca se actualiza (baja + alta de uno nuevo).
- Nombres de campo según MODELO_DATOS.md (convención snake_case física).

## Paso 2 — Sincronizar limits.ts (si cambiaron longitudes/rangos)

Si el cambio afecta longitudes, rangos numéricos o fechas, actualizar **ambos archivos en el mismo PR/cambio**:

1. `src/shared/validation/limits.ts` (este repo)
2. `apps/mobile/shared/validation/limits.ts` en el repo hermano del frontend

Si divergen: la UI corta a una longitud y el server valida otra — bug silencioso garantizado.

## Paso 3 — Propagar documentación

- Actualizar `docs/MODELO_DATOS.md` si cambia el modelo conceptual.
- Si cambia algo estructural, propagar a mano al `AGENTS.md` del repo hermano — no se sincronizan solos.

## Paso 4 — Verificación

```bash
npm run build && npm test
# si se tocó limits.ts del mobile, desde el repo hermano:
# cd apps/mobile && npx tsc --noEmit
```

Si hay datos existentes que quedan inválidos con el nuevo schema, decidir migración de datos vs. seed nuevo antes de commitear.
