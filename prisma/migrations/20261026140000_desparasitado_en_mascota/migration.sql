-- "Desparasitado" se pregunta al crear la mascota, igual que "castrado", y no al publicarla.
ALTER TABLE "mascota" ADD COLUMN "mascota_desparasitado" BOOLEAN NOT NULL DEFAULT false;

-- Lo que ya se había declarado en las publicaciones vivas pasa a la mascota.
UPDATE "mascota" AS m
SET "mascota_desparasitado" = true
WHERE EXISTS (
  SELECT 1
  FROM "publicacion" AS p
  WHERE p."mascota_id" = m."mascota_id"
    AND p."publicacion_desparasitado" = true
    AND p."publicacion_fecha_baja" IS NULL
);

ALTER TABLE "publicacion" DROP COLUMN "publicacion_desparasitado";
