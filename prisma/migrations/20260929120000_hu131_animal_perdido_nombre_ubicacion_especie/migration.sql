-- HU-13.1 (spec 020): lo que el aviso de animal perdido/encontrado necesita y el diagrama de
-- clases no tenía. La tabla ya existía desde el schema inicial.
--
-- Las tres columnas son NULLABLES a propósito: la obligatoriedad la imponen el DTO y el
-- servicio (el nombre, además, sólo es obligatorio en un aviso "Perdido"), igual que los
-- campos que HU-6.1 le sumó a `mascota`. Así los avisos cargados antes no quedan inválidos.
--
-- `animal_perdido_ubicacion` es texto libre como `usuario_ubicacion`, PROVISORIO hasta que
-- exista el catálogo de Provincia/Localidad (ver docs/DEUDA_TECNICA.md).
ALTER TABLE "animal_perdido" ADD COLUMN     "animal_perdido_nombre" TEXT,
ADD COLUMN     "animal_perdido_ubicacion" TEXT,
ADD COLUMN     "especie_id" INTEGER;

-- Filtro por especie del portal.
CREATE INDEX "animal_perdido_especie_id_idx" ON "animal_perdido"("especie_id");

ALTER TABLE "animal_perdido" ADD CONSTRAINT "animal_perdido_especie_id_fkey" FOREIGN KEY ("especie_id") REFERENCES "especie"("especie_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Orden y cursor del portal: más reciente primero, con el id como desempate para que dos
-- avisos del mismo instante no se repitan ni se salteen entre páginas.
--
-- Va como SQL a mano por el mismo motivo que los de `favorito` y `chat`: Prisma no sabe
-- expresar índices PARCIALES (`WHERE ...`) en schema.prisma. Es parcial porque el listado
-- nunca muestra avisos dados de baja.
CREATE INDEX "animal_perdido_listado_idx"
  ON "animal_perdido" ("animal_perdido_fecha_alta" DESC, "animal_perdido_id" DESC)
  WHERE "animal_perdido_fecha_baja" IS NULL;
