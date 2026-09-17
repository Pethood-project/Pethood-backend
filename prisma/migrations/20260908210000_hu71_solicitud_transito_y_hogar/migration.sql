-- HU-7.1 (solicitar adopción o tránsito).
--
-- Solicitud: período ofrecido cuando el tipo es "Transito". Nulos en una adopción.
ALTER TABLE "solicitud" ADD COLUMN "solicitud_fecha_inicio_transito" TIMESTAMP(3);
ALTER TABLE "solicitud" ADD COLUMN "solicitud_fecha_fin_transito" TIMESTAMP(3);

-- Hogar: respuestas del paso 2 del formulario que no tenían columna.
-- "hogar_tiene_patio" se conserva (está en el diagrama de clases) pero pasa a ser un
-- derivado de "hogar_espacio_exterior", que es la respuesta real del usuario.
ALTER TABLE "hogar" ADD COLUMN "hogar_espacio_exterior" TEXT;
ALTER TABLE "hogar" ADD COLUMN "hogar_detalle_mascotas" TEXT;
ALTER TABLE "hogar" ADD COLUMN "hogar_tiene_ninios" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hogar" ADD COLUMN "hogar_experiencia_previa" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hogar" ADD COLUMN "hogar_horas_solo" INTEGER;

-- Filas anteriores a esta migración: se les infiere el espacio exterior desde el booleano
-- que ya tenían, para que no queden con el campo vacío en la pantalla del refugio.
UPDATE "hogar"
SET "hogar_espacio_exterior" = CASE WHEN "hogar_tiene_patio" THEN 'Patio' ELSE 'Ninguno' END
WHERE "hogar_espacio_exterior" IS NULL;

-- Un usuario tiene un solo hogar VIGENTE: el paso 2 del formulario actualiza el que ya
-- tiene en vez de crear otro, así la segunda solicitud arranca con las respuestas puestas.
--
-- Parcial y no UNIQUE plano por la misma razón que los índices de "favorito": la baja es
-- lógica, y un único total impediría para siempre volver a cargar un hogar después de
-- darlo de baja. Va como SQL a mano porque Prisma no sabe expresar índices parciales.
CREATE UNIQUE INDEX "hogar_usuario_activo_uq"
  ON "hogar" ("usuario_id")
  WHERE "hogar_fecha_baja" IS NULL;
