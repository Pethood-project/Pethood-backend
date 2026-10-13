-- AlterTable
ALTER TABLE "notificacion" ADD COLUMN     "notificacion_entidad_id" INTEGER,
ADD COLUMN     "notificacion_entidad_tipo" TEXT;

-- CreateTable
CREATE TABLE "dispositivo_push" (
    "dispositivo_push_id" SERIAL NOT NULL,
    "dispositivo_push_expo_push_token" TEXT NOT NULL,
    "dispositivo_push_plataforma" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "dispositivo_push_usuario_alta" INTEGER NOT NULL,
    "dispositivo_push_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispositivo_push_usuario_modificacion" INTEGER,
    "dispositivo_push_fecha_modificacion" TIMESTAMP(3),
    "dispositivo_push_usuario_baja" INTEGER,
    "dispositivo_push_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "dispositivo_push_pkey" PRIMARY KEY ("dispositivo_push_id")
);

-- CreateIndex
CREATE INDEX "dispositivo_push_usuario_id_dispositivo_push_fecha_baja_idx" ON "dispositivo_push"("usuario_id", "dispositivo_push_fecha_baja");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivo_push_usuario_id_dispositivo_push_expo_push_toke_key" ON "dispositivo_push"("usuario_id", "dispositivo_push_expo_push_token");

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_notificacion_fecha_baja_notificacio_idx" ON "notificacion"("usuario_id", "notificacion_fecha_baja", "notificacion_fecha_alta");

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_notificacion_entidad_tipo_notificac_idx" ON "notificacion"("usuario_id", "notificacion_entidad_tipo", "notificacion_entidad_id", "notificacion_leido");

-- AddForeignKey
ALTER TABLE "dispositivo_push" ADD CONSTRAINT "dispositivo_push_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;
