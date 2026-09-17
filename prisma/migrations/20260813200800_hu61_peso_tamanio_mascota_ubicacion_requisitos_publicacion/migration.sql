-- CreateEnum
CREATE TYPE "TamanioMascota" AS ENUM ('PEQUENO', 'MEDIANO', 'GRANDE');

-- AlterTable
ALTER TABLE "mascota" ADD COLUMN     "mascota_peso" DECIMAL(4,1),
ADD COLUMN     "mascota_tamanio" "TamanioMascota";

-- AlterTable
ALTER TABLE "publicacion" ADD COLUMN     "publicacion_requisitos" TEXT[],
ADD COLUMN     "publicacion_ubicacion" TEXT;
