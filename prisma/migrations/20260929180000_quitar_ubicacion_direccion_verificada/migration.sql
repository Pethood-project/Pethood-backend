-- AlterTable
ALTER TABLE "refugio" DROP COLUMN "refugio_direccion",
ADD COLUMN     "refugio_ubicacion_verificada" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "usuario_ubicacion",
ADD COLUMN     "usuario_ubicacion_verificada" BOOLEAN NOT NULL DEFAULT false;