-- AlterTable
ALTER TABLE "refugio" ADD COLUMN     "refugio_calle_altura" TEXT,
ADD COLUMN     "refugio_latitud" DOUBLE PRECISION,
ADD COLUMN     "refugio_localidad" TEXT,
ADD COLUMN     "refugio_longitud" DOUBLE PRECISION,
ADD COLUMN     "refugio_provincia" TEXT;

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "usuario_calle_altura" TEXT,
ADD COLUMN     "usuario_latitud" DOUBLE PRECISION,
ADD COLUMN     "usuario_localidad" TEXT,
ADD COLUMN     "usuario_longitud" DOUBLE PRECISION,
ADD COLUMN     "usuario_mapa_url" TEXT,
ADD COLUMN     "usuario_provincia" TEXT;
