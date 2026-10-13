-- Spec 021 (HU-12.1 a HU-12.3): alias/CBU por campaña y estado de la donación.

-- CreateTable
CREATE TABLE "estado_donacion" (
    "estado_donacion_id" SERIAL NOT NULL,
    "estado_donacion_nombre" TEXT NOT NULL,
    "estado_donacion_descripcion" TEXT,
    "estado_donacion_usuario_alta" INTEGER NOT NULL,
    "estado_donacion_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_donacion_usuario_modificacion" INTEGER,
    "estado_donacion_fecha_modificacion" TIMESTAMP(3),
    "estado_donacion_usuario_baja" INTEGER,
    "estado_donacion_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "estado_donacion_pkey" PRIMARY KEY ("estado_donacion_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estado_donacion_estado_donacion_nombre_key" ON "estado_donacion"("estado_donacion_nombre");

-- Los estados van acá y no sólo en el seed: la columna NOT NULL de abajo necesita "Realizada"
-- para las donaciones que ya existen. El seed los upsertea por nombre, así que no se duplican.
-- usuario_alta = 1 es el usuario SISTEMA (src/shared/auditoria.ts).
INSERT INTO "estado_donacion" ("estado_donacion_nombre", "estado_donacion_usuario_alta")
VALUES ('Pendiente', 1), ('Realizada', 1), ('Cancelada', 1);

-- AlterTable
ALTER TABLE "campania" ADD COLUMN "campania_alias" TEXT,
ADD COLUMN "campania_cbu" TEXT;

-- AlterTable: primero nullable, se completa y recién después NOT NULL. Las donaciones que ya
-- existían quedan "Realizada" porque hasta hoy los dashboards las contaban como donadas.
ALTER TABLE "donacion" ADD COLUMN "donacion_motivo_rechazo" TEXT,
ADD COLUMN "estado_donacion_id" INTEGER;

UPDATE "donacion"
SET "estado_donacion_id" = (
    SELECT "estado_donacion_id" FROM "estado_donacion" WHERE "estado_donacion_nombre" = 'Realizada'
);

ALTER TABLE "donacion" ALTER COLUMN "estado_donacion_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "campania_refugio_id_estado_campania_id_idx" ON "campania"("refugio_id", "estado_campania_id");

-- CreateIndex
CREATE INDEX "donacion_campania_id_estado_donacion_id_idx" ON "donacion"("campania_id", "estado_donacion_id");

-- AddForeignKey
ALTER TABLE "donacion" ADD CONSTRAINT "donacion_estado_donacion_id_fkey" FOREIGN KEY ("estado_donacion_id") REFERENCES "estado_donacion"("estado_donacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;
