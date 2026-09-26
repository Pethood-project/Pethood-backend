-- AlterTable
ALTER TABLE "pregunta_seguimiento" ADD COLUMN     "pregunta_seguimiento_es_inicial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "solicitud_id" INTEGER;

-- AlterTable
ALTER TABLE "seguimiento" ADD COLUMN     "seguimiento_es_manual" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "pregunta_seguimiento" ADD CONSTRAINT "pregunta_seguimiento_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("solicitud_id") ON DELETE SET NULL ON UPDATE CASCADE;

