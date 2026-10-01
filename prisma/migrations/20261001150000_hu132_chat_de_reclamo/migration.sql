-- HU-13.2 (spec 024): la tarjeta del aviso de animal perdido/encontrado en la conversación.
--
-- Reclamar un aviso deja la tarjeta del aviso en la conversación con quien lo publicó, y abre
-- esa conversación si todavía no existía. **La sala es entre las partes**, igual que la de una
-- solicitud de adopción: si las dos personas ya se estaban escribiendo, el reclamo cae en la
-- conversación que ya tenían en vez de abrir una segunda con el mismo contacto (decisión del
-- equipo del 2026-10-01; ver spec 024 §9).

-- Qué aviso abrió la sala, cuando la abrió un reclamo. Mismo papel que `solicitud_id`: es el
-- origen de la conversación, no la lista de todo lo que se habló en ella.
--
-- CONSTITUTION §7: no hay chat sin interacción previa. Acá la interacción es el reclamo, que el
-- artículo nombra junto con la solicitud ("solicitud de adopción o reporte de mascota perdida").
ALTER TABLE "chat" ADD COLUMN     "animal_perdido_id" INTEGER;

-- El aviso de cada tarjeta, como `mensaje.solicitud_id` hace con la solicitud. Sólo se llena en
-- los mensajes de tipo ANIMAL_PERDIDO. Una misma sala puede acumular varias tarjetas —dos avisos
-- de la misma persona, o un aviso y una solicitud—, así que el aviso vive en el mensaje y no
-- solamente en el chat.
ALTER TABLE "mensaje" ADD COLUMN     "animal_perdido_id" INTEGER;

-- Un tipo más de mensaje: la tarjeta del aviso reclamado. El enum ya tenía TEXTO y SOLICITUD.
ALTER TYPE "tipo_mensaje" ADD VALUE 'ANIMAL_PERDIDO';

-- UNA tarjeta por aviso y por sala. Es el equivalente de `chat_solicitud_unico_idx`: evita la
-- segunda cuando dos requests entran a la vez, que un chequeo de lectura previo no alcanza a
-- cubrir. Parcial porque sólo las tarjetas llevan la columna.
--
-- No es único por aviso a secas: el mismo aviso reclamado por cinco personas deja cinco
-- tarjetas, una en la conversación de cada reclamante con el reportante.
CREATE UNIQUE INDEX "mensaje_aviso_por_chat_unico_idx"
  ON "mensaje" ("animal_perdido_id", "chat_id")
  WHERE "animal_perdido_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "chat" ADD CONSTRAINT "chat_animal_perdido_id_fkey" FOREIGN KEY ("animal_perdido_id") REFERENCES "animal_perdido"("animal_perdido_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_animal_perdido_id_fkey" FOREIGN KEY ("animal_perdido_id") REFERENCES "animal_perdido"("animal_perdido_id") ON DELETE SET NULL ON UPDATE CASCADE;
