-- HU-13.1 (spec 020): el día en que el animal se perdió o se encontró, que pide el campo
-- "Fecha" del formulario (pantalla 26 del diseño). No es la fecha de publicación del aviso,
-- que sigue siendo `animal_perdido_fecha_alta` y es la que ordena y filtra el portal.
--
-- Nullable por el mismo motivo que las columnas de la migración anterior: los avisos cargados
-- antes no la tienen. La obligatoriedad la impone el DTO.
ALTER TABLE "animal_perdido" ADD COLUMN     "animal_perdido_fecha_suceso" TIMESTAMP(3);
