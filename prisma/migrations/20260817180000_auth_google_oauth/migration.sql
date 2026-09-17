-- Auth: campos para registro mobile (fecha de nacimiento) y OAuth 2.0 con Google.
-- DNI y contraseña pasan a ser opcionales (cuentas Google / registro sin DNI).

ALTER TABLE "usuario" ALTER COLUMN "usuario_contrasena" DROP NOT NULL;
ALTER TABLE "usuario" ALTER COLUMN "usuario_dni" DROP NOT NULL;

ALTER TABLE "usuario" ADD COLUMN "usuario_fecha_nacimiento" TIMESTAMP(3);
ALTER TABLE "usuario" ADD COLUMN "usuario_google_id" TEXT;

CREATE UNIQUE INDEX "usuario_usuario_google_id_key" ON "usuario"("usuario_google_id");
