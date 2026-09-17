-- Índices de `favorito`. La tabla ya existía desde el schema inicial: acá sólo se le
-- agregan garantías. Van como SQL a mano porque Prisma no sabe expresar índices PARCIALES
-- (`WHERE ...`) en schema.prisma.

-- Un único favorito ACTIVO por (usuario, mascota).
--
-- Parcial y no UNIQUE plano porque la baja es lógica: al quitar un favorito la fila queda
-- con `favorito_fecha_baja` seteada, y un único total impediría para siempre volver a
-- guardar esa misma mascota.
--
-- Es una garantía de base y no un chequeo en el servicio a propósito: el swipe de HU-6.5
-- hace updates optimistas con reintentos, y dos POST concurrentes pasarían los dos por
-- cualquier validación de lectura previa antes de insertar.
CREATE UNIQUE INDEX "favorito_usuario_mascota_activo_uq"
  ON "favorito" ("usuario_id", "mascota_id")
  WHERE "favorito_fecha_baja" IS NULL;

-- Orden por defecto de HU-6.6: los favoritos de un usuario, del más reciente al más
-- antiguo. Parcial porque el listado siempre descarta los dados de baja.
CREATE INDEX "favorito_usuario_fecha_alta_idx"
  ON "favorito" ("usuario_id", "favorito_fecha_alta" DESC)
  WHERE "favorito_fecha_baja" IS NULL;
