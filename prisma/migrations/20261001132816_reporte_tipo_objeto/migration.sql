-- Spec 008 (Módulo 3): el reporte pasa a apuntar a lo reportado con `tipo` + `objeto_id`.

-- CreateEnum
CREATE TYPE "tipo_reporte" AS ENUM ('PUBLICACION', 'USUARIO', 'REFUGIO', 'RESENA', 'ANIMAL_PERDIDO');

-- Las filas que hay son del seed: no apuntaban a nada y ningún endpoint las creó nunca, así
-- que no se pueden completar. El seed las vuelve a crear ya con tipo y objeto.
DELETE FROM "reporte_problema";

-- AlterTable
ALTER TABLE "reporte_problema" ADD COLUMN     "reporte_problema_objeto_id" INTEGER NOT NULL,
ADD COLUMN     "reporte_problema_tipo" "tipo_reporte" NOT NULL;

-- CreateIndex
CREATE INDEX "reporte_problema_reporte_problema_tipo_reporte_problema_obj_idx" ON "reporte_problema"("reporte_problema_tipo", "reporte_problema_objeto_id");

-- Un solo reporte pendiente por reportante y objeto (spec 008, regla 4). Parcial: una vez
-- resuelto o dado de baja, el usuario puede volver a reportar lo mismo.
CREATE UNIQUE INDEX "reporte_problema_pendiente_uq"
ON "reporte_problema" ("reporte_problema_usuario_alta", "reporte_problema_tipo", "reporte_problema_objeto_id")
WHERE "reporte_problema_resuelto" = false AND "reporte_problema_fecha_baja" IS NULL;
