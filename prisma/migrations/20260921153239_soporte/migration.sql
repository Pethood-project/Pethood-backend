-- CreateTable
CREATE TABLE "consulta_soporte" (
    "consulta_soporte_id" SERIAL NOT NULL,
    "consulta_soporte_nombre_completo" TEXT NOT NULL,
    "consulta_soporte_email" TEXT NOT NULL,
    "consulta_soporte_asunto" TEXT NOT NULL,
    "consulta_soporte_mensaje" TEXT NOT NULL,
    "consulta_soporte_resuelta" BOOLEAN NOT NULL DEFAULT false,
    "consulta_soporte_usuario_alta" INTEGER NOT NULL,
    "consulta_soporte_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consulta_soporte_usuario_modificacion" INTEGER,
    "consulta_soporte_fecha_modificacion" TIMESTAMP(3),
    "consulta_soporte_usuario_baja" INTEGER,
    "consulta_soporte_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "consulta_soporte_pkey" PRIMARY KEY ("consulta_soporte_id")
);

-- CreateTable
CREATE TABLE "faq_categoria" (
    "faq_categoria_id" SERIAL NOT NULL,
    "faq_categoria_nombre" TEXT NOT NULL,
    "faq_categoria_descripcion" TEXT,
    "faq_categoria_usuario_alta" INTEGER NOT NULL,
    "faq_categoria_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faq_categoria_usuario_modificacion" INTEGER,
    "faq_categoria_fecha_modificacion" TIMESTAMP(3),
    "faq_categoria_usuario_baja" INTEGER,
    "faq_categoria_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "faq_categoria_pkey" PRIMARY KEY ("faq_categoria_id")
);

-- CreateTable
CREATE TABLE "faq" (
    "faq_id" SERIAL NOT NULL,
    "faq_pregunta" TEXT NOT NULL,
    "faq_respuesta" TEXT NOT NULL,
    "faq_orden" INTEGER NOT NULL,
    "faq_categoria_id" INTEGER NOT NULL,
    "faq_usuario_alta" INTEGER NOT NULL,
    "faq_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faq_usuario_modificacion" INTEGER,
    "faq_fecha_modificacion" TIMESTAMP(3),
    "faq_usuario_baja" INTEGER,
    "faq_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "faq_pkey" PRIMARY KEY ("faq_id")
);

-- AddForeignKey
ALTER TABLE "faq" ADD CONSTRAINT "faq_faq_categoria_id_fkey" FOREIGN KEY ("faq_categoria_id") REFERENCES "faq_categoria"("faq_categoria_id") ON DELETE RESTRICT ON UPDATE CASCADE;
