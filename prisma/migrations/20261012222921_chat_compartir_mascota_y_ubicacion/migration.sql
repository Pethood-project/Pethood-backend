-- Chat: compartir una mascota y mandar la ubicación del refugio (decisión del 2026-10-12).
--
-- Dos tarjetas nuevas de la hoja "Enviar en el chat". A diferencia de SOLICITUD y
-- ANIMAL_PERDIDO, no las emite SISTEMA: las manda una persona de la sala, así que van de su
-- lado y su autor las puede eliminar.
--
-- - MASCOTA: una mascota compartida. Como persona, una que tiene en favoritos y es de la
--   contraparte; como refugio, una propia publicada. Lleva `mascota_id`; nombre, foto, estado y
--   publicación se resuelven en cada pedido.
-- - UBICACION_REFUGIO: la ubicación del refugio de la sala, que manda alguien del refugio.
--   No lleva columna propia: sale de `chat.refugio_id` y del perfil del refugio, también en
--   cada pedido, así que muestra siempre la dirección vigente.
--
-- Agregar dos valores al enum en una misma migración necesita PostgreSQL 12 o más (la base de
-- dev y Neon son 16).
ALTER TYPE "tipo_mensaje" ADD VALUE 'MASCOTA';
ALTER TYPE "tipo_mensaje" ADD VALUE 'UBICACION_REFUGIO';

-- AlterTable
ALTER TABLE "mensaje" ADD COLUMN     "mascota_id" INTEGER;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_mascota_id_fkey" FOREIGN KEY ("mascota_id") REFERENCES "mascota"("mascota_id") ON DELETE SET NULL ON UPDATE CASCADE;
