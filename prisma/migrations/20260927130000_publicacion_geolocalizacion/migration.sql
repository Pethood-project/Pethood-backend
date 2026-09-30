-- AlterTable
ALTER TABLE "publicacion" ADD COLUMN "publicacion_ubicacion_latitud" DECIMAL(9,6),
ADD COLUMN "publicacion_ubicacion_longitud" DECIMAL(9,6);

-- Índices para las búsquedas del Módulo 11 (HU-11.2/11.3/11.4).
-- `pg_trgm` habilita el índice GIN sobre ILIKE parcial de texto libre; la extensión es
-- estándar de PostgreSQL. Si el motor no la tuviera, el índice puede omitirse sin afectar
-- la lógica: el filtro sigue funcionando, sólo más lento.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "publicacion_titulo_trgm_idx" ON "publicacion" USING GIN ("publicacion_titulo" gin_trgm_ops);
CREATE INDEX "publicacion_descripcion_trgm_idx" ON "publicacion" USING GIN ("publicacion_descripcion" gin_trgm_ops);
CREATE INDEX "publicacion_personalidad_gin_idx" ON "publicacion" USING GIN ("publicacion_personalidad");
CREATE INDEX "publicacion_ubicacion_trgm_idx" ON "publicacion" USING GIN ("publicacion_ubicacion" gin_trgm_ops);
CREATE INDEX "publicacion_fecha_alta_idx" ON "publicacion"("publicacion_fecha_alta");
