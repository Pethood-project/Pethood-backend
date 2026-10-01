-- HU-13.2 (spec 024): la sala de reencuentro de un aviso de animal perdido/encontrado.
--
-- Hasta acá el único lugar del sistema que creaba salas era la solicitud de adopción, y su
-- regla es "la sala es entre las partes": una segunda solicitud al mismo refugio cae en la
-- conversación que ya existe. Para un reclamo esa regla no sirve, porque marcar el aviso
-- Resuelto deja su sala en sólo lectura y con una sala compartida eso cortaría una
-- conversación que no tiene nada que ver con el aviso.
--
-- De ahí la columna: la sala de un reclamo se identifica POR AVISO y por quien reclamó.

-- CONSTITUTION §7: no hay chat sin interacción previa. Acá la interacción es el reclamo
-- mismo — el artículo lo nombra junto con la solicitud ("solicitud de adopción o reporte de
-- mascota perdida").
--
-- Nullable y excluyente con `solicitud_id`: una sala nace de una solicitud o de un reclamo.
ALTER TABLE "chat" ADD COLUMN     "animal_perdido_id" INTEGER;

-- La tarjeta del aviso que abre la sala, como `mensaje.solicitud_id` hace con la solicitud.
-- Sólo se llena en los mensajes de tipo ANIMAL_PERDIDO.
ALTER TABLE "mensaje" ADD COLUMN     "animal_perdido_id" INTEGER;

-- Un tipo más de mensaje: la tarjeta del aviso reclamado. El enum ya tenía TEXTO y SOLICITUD.
ALTER TYPE "tipo_mensaje" ADD VALUE 'ANIMAL_PERDIDO';

-- UNA sala por aviso y por reclamante. Evita la segunda cuando dos requests entran a la vez:
-- el chequeo de lectura previo del servicio no alcanza. Parcial sobre las salas vivas, igual
-- que `chat_solicitud_unico_idx`.
--
-- La segunda columna es `chat_usuario_alta` y no una columna nueva de reclamante porque en
-- una sala de reclamo el que la crea ES el que reclama: el servicio es el único que las
-- abre y lo documenta. La búsqueda del servicio, en cambio, va por participación, que es la
-- pregunta semántica ("¿ya hay sala de este aviso donde este usuario participe?").
CREATE UNIQUE INDEX "chat_reclamo_unico_idx"
  ON "chat" ("animal_perdido_id", "chat_usuario_alta")
  WHERE "animal_perdido_id" IS NOT NULL AND "chat_fecha_baja" IS NULL;

-- Las salas de un aviso, que es lo que recorre el paso a Resuelto para dejar su mensaje de
-- cierre en cada una.
CREATE INDEX "chat_animal_perdido_id_idx" ON "chat"("animal_perdido_id");

-- AddForeignKey
ALTER TABLE "chat" ADD CONSTRAINT "chat_animal_perdido_id_fkey" FOREIGN KEY ("animal_perdido_id") REFERENCES "animal_perdido"("animal_perdido_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_animal_perdido_id_fkey" FOREIGN KEY ("animal_perdido_id") REFERENCES "animal_perdido"("animal_perdido_id") ON DELETE SET NULL ON UPDATE CASCADE;
