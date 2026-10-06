-- HU-13.1 (spec 020): el lugar donde se perdió o se encontró el animal deja de ser texto libre
-- y pasa a la dirección estructurada que el equipo adoptó para el perfil (Módulo 11): provincia
-- y localidad del catálogo de georef, más un aclaratorio libre y opcional. Reemplaza a la
-- columna provisoria `animal_perdido_ubicacion` (DEUDA_TECNICA.md, ítem 21).
--
-- Se suman además las coordenadas del LUGAR, geocodificadas al publicar. Las del dispositivo
-- (`animal_perdido_latitud/longitud`) quedan como estaban y nunca se exponen.

ALTER TABLE "animal_perdido"
ADD COLUMN     "animal_perdido_provincia" TEXT,
ADD COLUMN     "animal_perdido_localidad" TEXT,
ADD COLUMN     "animal_perdido_referencia" TEXT,
ADD COLUMN     "animal_perdido_lugar_latitud" DOUBLE PRECISION,
ADD COLUMN     "animal_perdido_lugar_longitud" DOUBLE PRECISION;

-- El texto libre viejo era, en la práctica, una localidad ("Godoy Cruz", "Maipú"): se conserva
-- ahí para no perder el dato. La provincia no se puede deducir del texto y queda nula; el seed
-- completa la de sus avisos.
UPDATE "animal_perdido"
SET "animal_perdido_localidad" = NULLIF(TRIM("animal_perdido_ubicacion"), '')
WHERE "animal_perdido_ubicacion" IS NOT NULL;

ALTER TABLE "animal_perdido" DROP COLUMN "animal_perdido_ubicacion";

-- Filtro por provincia y localidad del portal.
CREATE INDEX "animal_perdido_animal_perdido_provincia_animal_perdido_loca_idx" ON "animal_perdido"("animal_perdido_provincia", "animal_perdido_localidad");
