-- Trazabilidad de la solicitud (spec 030): estados Revisada y Cerrada con causa estructurada,
-- nota interna del refugio, preguntas propias del refugio con sus respuestas y el vínculo de
-- una adopción aprobada con la mascota que nació de ella.
-- usuario 1 = SISTEMA (src/shared/auditoria.ts).
--
-- El esquema sale de `prisma migrate diff` contra el schema anterior; lo único escrito a mano
-- es el alta de los dos estados nuevos del catálogo, al final.

-- CreateEnum
CREATE TYPE "tipo_pregunta_adopcion" AS ENUM ('TEXTO', 'SI_NO', 'OPCIONES');

-- CreateEnum
CREATE TYPE "motivo_solicitud" AS ENUM ('NO_CUMPLE_REQUISITOS', 'MASCOTA_CON_HOGAR', 'SIN_CONTACTO', 'OTRO', 'RETIRADA_POR_SOLICITANTE', 'CUENTA_CERRADA_SOLICITANTE', 'ADOPTADA_POR_OTRA_PERSONA', 'MASCOTA_FALLECIDA', 'PUBLICACION_RETIRADA', 'PUBLICANTE_CERRO_CUENTA', 'VENCIDA_SIN_RESPUESTA');

-- AlterTable
ALTER TABLE "solicitud" ADD COLUMN     "mascota_adoptada_id" INTEGER,
ADD COLUMN     "solicitud_nota_interna" TEXT;

-- AlterTable
ALTER TABLE "solicitud_estado" ADD COLUMN     "solicitud_estado_motivo" "motivo_solicitud";

-- CreateTable
CREATE TABLE "pregunta_adopcion" (
    "pregunta_adopcion_id" SERIAL NOT NULL,
    "refugio_id" INTEGER NOT NULL,
    "especie_id" INTEGER,
    "pregunta_adopcion_texto" TEXT NOT NULL,
    "pregunta_adopcion_tipo" "tipo_pregunta_adopcion" NOT NULL DEFAULT 'TEXTO',
    "pregunta_adopcion_opciones" TEXT[],
    "pregunta_adopcion_obligatoria" BOOLEAN NOT NULL DEFAULT false,
    "pregunta_adopcion_orden" INTEGER NOT NULL DEFAULT 0,
    "pregunta_adopcion_activa" BOOLEAN NOT NULL DEFAULT true,
    "pregunta_adopcion_usuario_alta" INTEGER NOT NULL,
    "pregunta_adopcion_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pregunta_adopcion_usuario_modificacion" INTEGER,
    "pregunta_adopcion_fecha_modificacion" TIMESTAMP(3),
    "pregunta_adopcion_usuario_baja" INTEGER,
    "pregunta_adopcion_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "pregunta_adopcion_pkey" PRIMARY KEY ("pregunta_adopcion_id")
);

-- CreateTable
CREATE TABLE "solicitud_respuesta" (
    "solicitud_respuesta_id" SERIAL NOT NULL,
    "solicitud_id" INTEGER NOT NULL,
    "pregunta_adopcion_id" INTEGER,
    "solicitud_respuesta_pregunta_texto" TEXT NOT NULL,
    "solicitud_respuesta_respuesta" TEXT NOT NULL,
    "solicitud_respuesta_orden" INTEGER NOT NULL DEFAULT 0,
    "solicitud_respuesta_usuario_alta" INTEGER NOT NULL,
    "solicitud_respuesta_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solicitud_respuesta_usuario_modificacion" INTEGER,
    "solicitud_respuesta_fecha_modificacion" TIMESTAMP(3),
    "solicitud_respuesta_usuario_baja" INTEGER,
    "solicitud_respuesta_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "solicitud_respuesta_pkey" PRIMARY KEY ("solicitud_respuesta_id")
);

-- CreateIndex
CREATE INDEX "pregunta_adopcion_refugio_id_idx" ON "pregunta_adopcion"("refugio_id");

-- CreateIndex
CREATE INDEX "solicitud_respuesta_solicitud_id_idx" ON "solicitud_respuesta"("solicitud_id");

-- AddForeignKey
ALTER TABLE "solicitud" ADD CONSTRAINT "solicitud_mascota_adoptada_id_fkey" FOREIGN KEY ("mascota_adoptada_id") REFERENCES "mascota"("mascota_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregunta_adopcion" ADD CONSTRAINT "pregunta_adopcion_refugio_id_fkey" FOREIGN KEY ("refugio_id") REFERENCES "refugio"("refugio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregunta_adopcion" ADD CONSTRAINT "pregunta_adopcion_especie_id_fkey" FOREIGN KEY ("especie_id") REFERENCES "especie"("especie_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_respuesta" ADD CONSTRAINT "solicitud_respuesta_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("solicitud_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_respuesta" ADD CONSTRAINT "solicitud_respuesta_pregunta_adopcion_id_fkey" FOREIGN KEY ("pregunta_adopcion_id") REFERENCES "pregunta_adopcion"("pregunta_adopcion_id") ON DELETE SET NULL ON UPDATE CASCADE;


-- En una base nueva el catálogo lo llena el seed, que upsertea por nombre: la sentencia no
-- rompe ni duplica.
INSERT INTO "estado_solicitud" ("estado_solicitud_nombre", "estado_solicitud_usuario_alta")
VALUES ('Revisada', 1), ('Cerrada', 1)
ON CONFLICT ("estado_solicitud_nombre") DO NOTHING;
