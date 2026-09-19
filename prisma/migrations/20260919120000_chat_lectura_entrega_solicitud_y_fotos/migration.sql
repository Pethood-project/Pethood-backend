-- Brechas de la pantalla de chat (HU-5.1 / HU-5.2): estado de lectura y entrega por
-- participante, varias fotos por mensaje y la solicitud embebida en la sala.
--
-- Escrita a mano —igual que los índices de HU-5.1— porque además del DDL lleva el backfill
-- de los datos que ya existen: sin él, las conversaciones actuales aparecerían enteras como
-- no leídas y las fotos ya enviadas se perderían del array nuevo.

-- ─────────────── Tipo de mensaje ───────────────

CREATE TYPE "tipo_mensaje" AS ENUM ('TEXTO', 'SOLICITUD');

-- ─────────────── Lectura y entrega POR PARTICIPANTE ───────────────
--
-- Reemplazan a `mensaje_leido`, que es un booleano único por mensaje y sin dueño: alcanza
-- para una sala de dos pero rompe con tres o más (el primero que abre le baja el badge al
-- resto). Es la deuda que `docs/api-chats.md` venía anotando desde HU-5.1.
--
-- Además habilitan el acuse de entrega, que `mensaje_leido` no podía representar: con dos
-- marcas de tiempo por participante un mensaje puede estar entregado y todavía no leído.

ALTER TABLE "usuario_chat" ADD COLUMN     "usuario_chat_ultima_entrega" TIMESTAMP(3),
ADD COLUMN     "usuario_chat_ultima_lectura" TIMESTAMP(3);

-- Backfill: lo que cada participante ya tenía leído según el booleano viejo.
--
-- Para cada fila de `usuario_chat`, la fecha del mensaje AJENO más reciente marcado como
-- leído. Los mensajes propios no cuentan: un mensaje lo lee el que no lo emitió.
--
-- La entrega arranca igual que la lectura porque lo leído estuvo necesariamente entregado.
-- Un chat sin mensajes leídos queda en NULL, que es "nunca leyó nada": correcto.
UPDATE "usuario_chat" uc
   SET "usuario_chat_ultima_lectura" = ultimo."fecha",
       "usuario_chat_ultima_entrega" = ultimo."fecha"
  FROM (
        SELECT m."chat_id", p."usuario_id", MAX(m."mensaje_fecha_alta") AS "fecha"
          FROM "mensaje" m
          JOIN "usuario_chat" p
            ON p."chat_id" = m."chat_id"
           AND p."usuario_id" <> m."usuario_id"
         WHERE m."mensaje_leido" = true
         GROUP BY m."chat_id", p."usuario_id"
       ) AS ultimo
 WHERE uc."chat_id" = ultimo."chat_id"
   AND uc."usuario_id" = ultimo."usuario_id";

-- Índice del conteo de no leídos con el modelo nuevo.
--
-- El de HU-5.1 (`mensaje_chat_usuario_no_leido_idx`) era parcial sobre `mensaje_leido` y ya
-- no sirve: ahora el filtro es por fecha contra la marca del participante. Se deja igual,
-- porque la columna vieja sigue poblándose y todavía hay lecturas que la miran.
--
-- No es parcial: cualquier mensaje de la sala puede ser el que dispare el conteo, según
-- hasta dónde haya leído cada uno.
CREATE INDEX "mensaje_chat_usuario_fecha_idx"
  ON "mensaje" ("chat_id", "usuario_id", "mensaje_fecha_alta");

-- ─────────────── Varias fotos por mensaje ───────────────
--
-- Mismo par que `publicacion_imagen_url` / `publicacion_imagenes`: el array tiene todas y la
-- columna vieja queda como la PRIMERA, para que el preview del listado siga resolviéndose
-- sin mirar el array.

ALTER TABLE "mensaje" ADD COLUMN     "mensaje_imagenes" TEXT[],
ADD COLUMN     "mensaje_tipo" "tipo_mensaje" NOT NULL DEFAULT 'TEXTO',
ADD COLUMN     "solicitud_id" INTEGER;

-- Backfill: la foto única que ya tenían los mensajes pasa a ser el primer elemento.
UPDATE "mensaje"
   SET "mensaje_imagenes" = ARRAY["mensaje_imagen_url"]
 WHERE "mensaje_imagen_url" IS NOT NULL;

-- ─────────────── La solicitud que originó la sala ───────────────
--
-- CONSTITUTION §7: no hay chat sin interacción previa. Nullable porque las salas de
-- coordinación por mascota perdida (HU-13.2) y las que ya existían no salen de una solicitud.

ALTER TABLE "chat" ADD COLUMN     "solicitud_id" INTEGER;

-- Evita dos salas para la misma solicitud cuando dos requests entran a la vez: un chequeo
-- de lectura previo no alcanza. Parcial sobre las salas vivas, igual que los de `favorito`.
CREATE UNIQUE INDEX "chat_solicitud_unico_idx"
  ON "chat" ("solicitud_id")
  WHERE "solicitud_id" IS NOT NULL AND "chat_fecha_baja" IS NULL;

-- AddForeignKey
ALTER TABLE "chat" ADD CONSTRAINT "chat_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("solicitud_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("solicitud_id") ON DELETE SET NULL ON UPDATE CASCADE;
