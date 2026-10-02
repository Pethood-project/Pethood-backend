-- HU-13.1 (spec 020): un aviso lleva hasta 5 fotos, que el detalle muestra en una galería.
--
-- Mismo par que `publicacion_imagen_url` / `publicacion_imagenes`: el array tiene todas en el
-- orden de la galería y la columna vieja queda como la PRIMERA, que es la portada de la
-- tarjeta del portal.
ALTER TABLE "animal_perdido" ADD COLUMN     "animal_perdido_imagenes" TEXT[];

-- Backfill: la foto única que ya tenían los avisos pasa a ser el primer elemento.
UPDATE "animal_perdido"
   SET "animal_perdido_imagenes" = ARRAY["animal_perdido_imagen_url"];
