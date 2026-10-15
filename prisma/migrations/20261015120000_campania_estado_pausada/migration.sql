-- Spec 028: la campaña suma el estado «Pausada» y deja de existir «Cancelada» (ahora se
-- elimina con baja lógica, sólo si no tiene donaciones). Sólo cambian datos del catálogo, el
-- esquema queda igual. usuario 1 = SISTEMA (src/shared/auditoria.ts).

-- En una base nueva el catálogo todavía está vacío (lo llena el seed, que upsertea por nombre):
-- ninguna de estas sentencias rompe ni duplica.
INSERT INTO "estado_campania" ("estado_campania_nombre", "estado_campania_usuario_alta")
VALUES ('Pausada', 1)
ON CONFLICT ("estado_campania_nombre") DO NOTHING;

-- Las canceladas pasan a Finalizada: conservan su historial de donaciones y siguen en
-- «Mis Campañas».
UPDATE "campania"
SET "estado_campania_id" = (
      SELECT "estado_campania_id" FROM "estado_campania"
      WHERE "estado_campania_nombre" = 'Finalizada'
    ),
    "campania_usuario_modificacion" = 1,
    "campania_fecha_modificacion" = NOW()
WHERE "estado_campania_id" = (
  SELECT "estado_campania_id" FROM "estado_campania"
  WHERE "estado_campania_nombre" = 'Cancelada'
);

-- Baja lógica del estado: el filtro de «Mis Campañas» sale de los estados vigentes.
UPDATE "estado_campania"
SET "estado_campania_usuario_baja" = 1,
    "estado_campania_fecha_baja" = NOW()
WHERE "estado_campania_nombre" = 'Cancelada' AND "estado_campania_fecha_baja" IS NULL;
