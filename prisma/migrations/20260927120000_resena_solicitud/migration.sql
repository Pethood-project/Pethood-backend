-- AlterTable
ALTER TABLE "resena" ADD COLUMN "solicitud_id" INTEGER;

-- CreateIndex
CREATE INDEX "resena_solicitud_id_idx" ON "resena"("solicitud_id");

-- AddForeignKey
ALTER TABLE "resena" ADD CONSTRAINT "resena_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("solicitud_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una sola reseña ACTIVA por autor y solicitud. Prisma no sabe expresar índices parciales:
-- vive sólo acá (ver el comentario de Resena en schema.prisma). Las reseñas sembradas sin
-- solicitud quedan con NULL y no chocan entre sí porque Postgres trata cada NULL como distinto.
CREATE UNIQUE INDEX "resena_solicitud_autor_activo_uq" ON "resena"("solicitud_id", "resena_usuario_autor")
    WHERE "resena_fecha_baja" IS NULL;
