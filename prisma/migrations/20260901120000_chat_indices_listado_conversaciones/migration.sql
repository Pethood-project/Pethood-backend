-- Índices para el listado de conversaciones (HU-5.1). Las tres tablas ya existían desde
-- el schema inicial: acá NO se cambia ninguna estructura, sólo se agregan índices.
--
-- Van como SQL a mano por el mismo motivo que los de `favorito`: Prisma no sabe expresar
-- índices PARCIALES (`WHERE ...`) en schema.prisma.

-- Último mensaje de cada chat y orden del listado.
--
-- Es el índice que hace posible resolver el "último mensaje de TODOS mis chats" en una
-- sola query (`SELECT DISTINCT ON (chat_id) ... ORDER BY chat_id, fecha_alta DESC`) en vez
-- de iterar chat por chat. El historial paginado de HU-5.2 lo va a usar igual.
--
-- NO es parcial: `mensaje` no tiene `fecha_baja` (excepción de auditoría de
-- MODELO_DATOS.md — el mensaje sólo tiene alta), así que no hay bajas que descartar.
CREATE INDEX "mensaje_chat_fecha_alta_idx"
  ON "mensaje" ("chat_id", "mensaje_fecha_alta" DESC);

-- Contador de mensajes no leídos por chat.
--
-- Parcial porque las filas no leídas son una minoría que ADEMÁS se achica sola: todo
-- mensaje termina leído al abrir la sala. El índice queda del tamaño de la cola pendiente
-- y no crece con el volumen histórico de mensajes.
--
-- `usuario_id` está en la clave porque el conteo siempre excluye los mensajes propios: los
-- no leídos de un usuario son los del chat que NO emitió él.
CREATE INDEX "mensaje_chat_usuario_no_leido_idx"
  ON "mensaje" ("chat_id", "usuario_id")
  WHERE "mensaje_leido" = false;

-- Punto de entrada de la query: "mis salas activas".
--
-- El índice que ya existía (`usuario_chat_chat_id_usuario_id_idx`) arranca por `chat_id`,
-- así que no sirve para buscar por `usuario_id`, que es justo lo que hace este listado.
-- Parcial porque siempre se descartan los participantes dados de baja.
CREATE INDEX "usuario_chat_usuario_activo_idx"
  ON "usuario_chat" ("usuario_id")
  WHERE "usuario_chat_fecha_baja" IS NULL;
