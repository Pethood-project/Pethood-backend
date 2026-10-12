-- Chat: responder un mensaje puntual y eliminar uno propio (decisión del 2026-10-12).
--
-- `mensaje_respondido_id`: el mensaje que éste cita, como el "deslizar para responder" de
-- cualquier app de mensajería. Que sea de la misma sala y de tipo TEXTO lo valida el service.
--
-- `mensaje_usuario_baja` / `mensaje_fecha_baja`: la baja lógica del mensaje. Hasta acá
-- `mensaje` era la excepción de auditoría "solo alta" (MODELO_DATOS.md); ahora el autor puede
-- eliminar lo que mandó. La fila NO se borra: la sala la sigue listando como el aviso "Se
-- eliminó este mensaje" (sin contenido ni adjuntos), y moderación la sigue viendo entera.
--
-- Sin índice nuevo: los dos campos se leen siempre junto con la fila del mensaje, nunca se
-- filtra por ellos. `mensaje_chat_fecha_alta_idx` sigue cubriendo el historial.
ALTER TABLE "mensaje" ADD COLUMN     "mensaje_fecha_baja" TIMESTAMP(3),
ADD COLUMN     "mensaje_respondido_id" INTEGER,
ADD COLUMN     "mensaje_usuario_baja" INTEGER;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_mensaje_respondido_id_fkey" FOREIGN KEY ("mensaje_respondido_id") REFERENCES "mensaje"("mensaje_id") ON DELETE SET NULL ON UPDATE CASCADE;
