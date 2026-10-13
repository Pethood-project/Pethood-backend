-- Spec 002.1: documentación de identidad del usuario (foto del DNI + selfie).
ALTER TABLE "usuario" ADD COLUMN "usuario_dni_imagen_url" TEXT,
ADD COLUMN "usuario_selfie_url" TEXT;
