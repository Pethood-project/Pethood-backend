-- AlterTable
ALTER TABLE "publicacion" ADD COLUMN     "publicacion_desparasitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicacion_imagenes" TEXT[],
ADD COLUMN     "publicacion_personalidad" TEXT[],
ADD COLUMN     "publicacion_vacunas" TEXT;
