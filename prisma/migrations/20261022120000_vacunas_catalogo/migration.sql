-- Spec 029: las vacunas pasan del enum `tipo_vacuna` a un catálogo (`vacuna` + `vacuna_especie`).
-- Migración de datos a mano: las 7 vacunas del plan de la spec 019 se insertan en orden de
-- calendario (el orden de los selectores es el de creación) con `codigo` = valor del enum, y
-- cada registro de historia clínica pasa de `tipo_vacuna` a `vacuna_id` ANTES de borrar la
-- columna. usuario 1 = SISTEMA (src/shared/auditoria.ts).

-- CreateTable
CREATE TABLE "vacuna" (
    "vacuna_id" SERIAL NOT NULL,
    "vacuna_codigo" TEXT NOT NULL,
    "vacuna_nombre" TEXT NOT NULL,
    "vacuna_descripcion" TEXT NOT NULL,
    "vacuna_color" TEXT,
    "vacuna_usuario_alta" INTEGER NOT NULL,
    "vacuna_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vacuna_usuario_modificacion" INTEGER,
    "vacuna_fecha_modificacion" TIMESTAMP(3),
    "vacuna_usuario_baja" INTEGER,
    "vacuna_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "vacuna_pkey" PRIMARY KEY ("vacuna_id")
);

-- CreateTable
CREATE TABLE "vacuna_especie" (
    "vacuna_especie_id" SERIAL NOT NULL,
    "vacuna_id" INTEGER NOT NULL,
    "especie_id" INTEGER NOT NULL,
    "vacuna_especie_usuario_alta" INTEGER NOT NULL,
    "vacuna_especie_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vacuna_especie_usuario_modificacion" INTEGER,
    "vacuna_especie_fecha_modificacion" TIMESTAMP(3),
    "vacuna_especie_usuario_baja" INTEGER,
    "vacuna_especie_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "vacuna_especie_pkey" PRIMARY KEY ("vacuna_especie_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacuna_vacuna_codigo_key" ON "vacuna"("vacuna_codigo");

-- CreateIndex
CREATE UNIQUE INDEX "vacuna_vacuna_nombre_key" ON "vacuna"("vacuna_nombre");

-- CreateIndex
CREATE UNIQUE INDEX "vacuna_especie_vacuna_id_especie_id_key" ON "vacuna_especie"("vacuna_id", "especie_id");

-- AddForeignKey
ALTER TABLE "vacuna_especie" ADD CONSTRAINT "vacuna_especie_vacuna_id_fkey" FOREIGN KEY ("vacuna_id") REFERENCES "vacuna"("vacuna_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacuna_especie" ADD CONSTRAINT "vacuna_especie_especie_id_fkey" FOREIGN KEY ("especie_id") REFERENCES "especie"("especie_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Datos: el plan de la spec 019, en orden de calendario (perro y después gato). La
-- antirrábica es una sola para las dos especies, con la descripción unificada (spec 029 §9).
INSERT INTO "vacuna" ("vacuna_codigo", "vacuna_nombre", "vacuna_descripcion", "vacuna_usuario_alta") VALUES
  ('PRIMOVACUNACION', 'Primovacunación',
   '6 a 8 semanas: Primovacunación con Puppy / Polivalente (Parvovirus y Moquillo).', 1),
  ('MULTIPLE', 'Vacuna Múltiple',
   '9 a 12 semanas: Vacuna Múltiple o Séxtuple (Parvovirus, Moquillo, Hepatitis, Parainfluenza y Leptospirosis).', 1),
  ('REFUERZO_MULTIPLE', 'Refuerzo Múltiple',
   '14 a 16 semanas: Refuerzo de la vacuna Múltiple/Óctuple.', 1),
  ('ANTIRRABICA', 'Antirrábica',
   'A partir de los 3 a 4 meses: Vacuna Antirrábica (obligatoria por ley).', 1),
  ('TRIVALENTE_FELINA', 'Trivalente Felina',
   '8 semanas: Vacuna Trivalente Felina (Panleucopenia, Calicivirus y Rinotraqueítis).', 1),
  ('REFUERZO_TRIVALENTE_LEUCEMIA', 'Refuerzo Trivalente + Leucemia',
   '12 semanas: Refuerzo de la Trivalente Felina + Leucemia Felina (FeLV) (recomendada si el gato tiene acceso al exterior o convivencia con otros gatos).', 1),
  ('REFUERZO_LEUCEMIA', 'Refuerzo Leucemia Felina',
   '16 semanas: Segundo refuerzo de Leucemia Felina (si aplica).', 1);

-- En una base nueva `especie` todavía está vacía (la llena el seed): no se asocia nada y el
-- seed completa las asociaciones, que upsertea por (vacuna, especie).
INSERT INTO "vacuna_especie" ("vacuna_id", "especie_id", "vacuna_especie_usuario_alta")
SELECT v."vacuna_id", e."especie_id", 1
FROM (VALUES
  ('PRIMOVACUNACION', 'Perro'),
  ('MULTIPLE', 'Perro'),
  ('REFUERZO_MULTIPLE', 'Perro'),
  ('ANTIRRABICA', 'Perro'),
  ('ANTIRRABICA', 'Gato'),
  ('TRIVALENTE_FELINA', 'Gato'),
  ('REFUERZO_TRIVALENTE_LEUCEMIA', 'Gato'),
  ('REFUERZO_LEUCEMIA', 'Gato')
) AS plan ("codigo", "especie")
JOIN "vacuna" v ON v."vacuna_codigo" = plan."codigo"
JOIN "especie" e ON e."especie_nombre" = plan."especie";

-- AlterTable: la columna nueva se completa desde el enum antes de borrarlo.
ALTER TABLE "historia_clinica" ADD COLUMN "vacuna_id" INTEGER;

UPDATE "historia_clinica" hc
SET "vacuna_id" = v."vacuna_id"
FROM "vacuna" v
WHERE v."vacuna_codigo" = hc."historia_clinica_tipo_vacuna"::text;

-- Corta la migración si algún registro con vacuna quedó sin `vacuna_id` (no se pierde ninguno).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "historia_clinica"
    WHERE "historia_clinica_tipo_vacuna" IS NOT NULL AND "vacuna_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay registros de historia clínica con tipo_vacuna sin vacuna_id';
  END IF;
END $$;

ALTER TABLE "historia_clinica" DROP COLUMN "historia_clinica_tipo_vacuna";

-- DropEnum
DROP TYPE "tipo_vacuna";

-- AddForeignKey
ALTER TABLE "historia_clinica" ADD CONSTRAINT "historia_clinica_vacuna_id_fkey" FOREIGN KEY ("vacuna_id") REFERENCES "vacuna"("vacuna_id") ON DELETE RESTRICT ON UPDATE CASCADE;
