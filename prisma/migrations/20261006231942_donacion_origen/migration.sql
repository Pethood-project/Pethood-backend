-- Spec 027: desde dónde dijo el donante que transfirió (MERCADO_PAGO | OTRO_BANCO).
-- Nullable: las donaciones anteriores no lo tienen.
ALTER TABLE "donacion" ADD COLUMN "donacion_origen" TEXT;
