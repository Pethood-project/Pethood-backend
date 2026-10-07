-- AlterTable
ALTER TABLE "donacion" ADD COLUMN     "donacion_mp_pago_id" TEXT;

-- CreateTable
CREATE TABLE "conexion_mercado_pago" (
    "conexion_mp_id" SERIAL NOT NULL,
    "refugio_id" INTEGER NOT NULL,
    "conexion_mp_user_id" TEXT NOT NULL,
    "conexion_mp_access_token" TEXT NOT NULL,
    "conexion_mp_refresh_token" TEXT NOT NULL,
    "conexion_mp_vence" TIMESTAMP(3) NOT NULL,
    "conexion_mp_estado" TEXT NOT NULL,
    "conexion_mp_usuario_alta" INTEGER NOT NULL,
    "conexion_mp_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conexion_mp_usuario_modificacion" INTEGER,
    "conexion_mp_fecha_modificacion" TIMESTAMP(3),
    "conexion_mp_usuario_baja" INTEGER,
    "conexion_mp_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "conexion_mercado_pago_pkey" PRIMARY KEY ("conexion_mp_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conexion_mercado_pago_refugio_id_key" ON "conexion_mercado_pago"("refugio_id");

-- CreateIndex
CREATE UNIQUE INDEX "donacion_donacion_mp_pago_id_key" ON "donacion"("donacion_mp_pago_id");

-- AddForeignKey
ALTER TABLE "conexion_mercado_pago" ADD CONSTRAINT "conexion_mercado_pago_refugio_id_fkey" FOREIGN KEY ("refugio_id") REFERENCES "refugio"("refugio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

