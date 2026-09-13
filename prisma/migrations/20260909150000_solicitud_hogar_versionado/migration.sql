-- HU-7.1: el hogar del usuario pasa a versionarse.
--
-- Sigue habiendo UN hogar vigente por usuario (el índice parcial `hogar_usuario_activo_uq`
-- de la migración anterior no se toca): cuando el solicitante cambia una respuesta, la fila
-- vieja se da de baja lógica y se crea una nueva, igual que HistoriaClinica.
--
-- `solicitud.hogar_id` apunta a la versión que estaba vigente al enviar, o sea a lo que el
-- refugio evaluó. Así una mudanza posterior no reescribe lo declarado, y el refugio puede
-- ver las dos cosas: dónde dijo que estaría y dónde dice estar ahora.
ALTER TABLE "solicitud" ADD COLUMN "hogar_id" INTEGER;

ALTER TABLE "solicitud"
  ADD CONSTRAINT "solicitud_hogar_id_fkey"
  FOREIGN KEY ("hogar_id") REFERENCES "hogar"("hogar_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Solicitudes anteriores a HU-7.1: se les asigna el hogar vigente del solicitante, si tiene
-- alguno. Es lo más cercano a la verdad que hay — cuando se crearon, el formulario todavía
-- no preguntaba por el hogar. Las que queden en NULL se muestran sin esa sección.
UPDATE "solicitud" s
SET "hogar_id" = h."hogar_id"
FROM "hogar" h
WHERE h."usuario_id" = s."usuario_id"
  AND h."hogar_fecha_baja" IS NULL
  AND s."hogar_id" IS NULL;

-- El detalle de una solicitud entra por acá.
CREATE INDEX "solicitud_hogar_id_idx" ON "solicitud" ("hogar_id");
