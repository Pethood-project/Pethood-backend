-- Vacunas de la mascota (spec 019).
--
-- Las vacunas dejan de ser texto libre en la publicación y pasan a ser registros de
-- historia clínica con el tipo de vacuna aplicado: las medallas de la mascota salen de ahí.

-- ─────────────── Tipo de vacuna ───────────────

CREATE TYPE "tipo_vacuna" AS ENUM (
  'PRIMOVACUNACION',
  'MULTIPLE',
  'REFUERZO_MULTIPLE',
  'TRIVALENTE_FELINA',
  'REFUERZO_TRIVALENTE_LEUCEMIA',
  'REFUERZO_LEUCEMIA',
  'ANTIRRABICA'
);

ALTER TABLE "historia_clinica" ADD COLUMN "historia_clinica_tipo_vacuna" "tipo_vacuna";

-- ─────────────── Publicación sin vacunas ───────────────
--
-- El texto libre no se puede traducir a un tipo de vacuna con fecha, así que se descarta:
-- las vacunas se vuelven a cargar desde la historia clínica de la mascota.

ALTER TABLE "publicacion" DROP COLUMN "publicacion_vacunas";
