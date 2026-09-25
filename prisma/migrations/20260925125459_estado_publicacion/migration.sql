-- CreateTable
CREATE TABLE "estado_publicacion" (
    "estado_publicacion_id" SERIAL NOT NULL,
    "estado_publicacion_nombre" TEXT NOT NULL,
    "estado_publicacion_descripcion" TEXT,
    "estado_publicacion_usuario_alta" INTEGER NOT NULL,
    "estado_publicacion_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_publicacion_usuario_modificacion" INTEGER,
    "estado_publicacion_fecha_modificacion" TIMESTAMP(3),
    "estado_publicacion_usuario_baja" INTEGER,
    "estado_publicacion_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "estado_publicacion_pkey" PRIMARY KEY ("estado_publicacion_id")
);

-- CreateTable
CREATE TABLE "publicacion_estado" (
    "publicacion_estado_id" SERIAL NOT NULL,
    "publicacion_id" INTEGER NOT NULL,
    "estado_publicacion_id" INTEGER NOT NULL,
    "publicacion_estado_usuario_alta" INTEGER NOT NULL,
    "publicacion_estado_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicacion_estado_usuario_baja" INTEGER,
    "publicacion_estado_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "publicacion_estado_pkey" PRIMARY KEY ("publicacion_estado_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estado_publicacion_estado_publicacion_nombre_key" ON "estado_publicacion"("estado_publicacion_nombre");

-- CreateIndex
CREATE INDEX "publicacion_estado_publicacion_id_idx" ON "publicacion_estado"("publicacion_id");

-- AddForeignKey
ALTER TABLE "publicacion_estado" ADD CONSTRAINT "publicacion_estado_publicacion_id_fkey" FOREIGN KEY ("publicacion_id") REFERENCES "publicacion"("publicacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publicacion_estado" ADD CONSTRAINT "publicacion_estado_estado_publicacion_id_fkey" FOREIGN KEY ("estado_publicacion_id") REFERENCES "estado_publicacion"("estado_publicacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola fila vigente por publicación (misma invariante que mascota_estado). Prisma no
-- sabe expresar índices parciales: vive sólo acá (ver el comentario de PublicacionEstado en
-- schema.prisma).
CREATE UNIQUE INDEX "publicacion_estado_activo_uq" ON "publicacion_estado"("publicacion_id")
    WHERE "publicacion_estado_fecha_baja" IS NULL;

-- Catálogo. El seed también lo siembra (upsert por nombre), pero tiene que existir acá para
-- poder completar el estado de las publicaciones que ya están cargadas. usuario_alta = 1 es
-- el usuario SISTEMA (src/shared/auditoria.ts USUARIO_SISTEMA_ID).
INSERT INTO "estado_publicacion" ("estado_publicacion_nombre", "estado_publicacion_usuario_alta")
VALUES ('Activa', 1), ('Pausada', 1), ('Finalizada', 1)
ON CONFLICT ("estado_publicacion_nombre") DO NOTHING;

-- Backfill: cada publicación existente nace con el estado que le corresponde según el estado
-- vigente de su mascota — la misma regla que aplica `estadoPublicacionSegunMascota` desde
-- ahora. Una mascota sin estado vigente (dato inconsistente) deja la publicación pausada:
-- fuera del feed, que es lo seguro.
INSERT INTO "publicacion_estado" (
    "publicacion_id",
    "estado_publicacion_id",
    "publicacion_estado_usuario_alta",
    "publicacion_estado_fecha_alta"
)
SELECT
    p."publicacion_id",
    ep."estado_publicacion_id",
    1,
    p."publicacion_fecha_alta"
FROM "publicacion" p
LEFT JOIN "mascota_estado" me
    ON me."mascota_id" = p."mascota_id" AND me."mascota_estado_fecha_baja" IS NULL
LEFT JOIN "estado_mascota" em
    ON em."estado_mascota_id" = me."estado_mascota_id"
JOIN "estado_publicacion" ep
    ON ep."estado_publicacion_nombre" = CASE
        WHEN em."estado_mascota_nombre" = 'Disponible' THEN 'Activa'
        WHEN em."estado_mascota_nombre" IN ('Adoptado', 'Fallecido') THEN 'Finalizada'
        ELSE 'Pausada'
    END
WHERE NOT EXISTS (
    SELECT 1 FROM "publicacion_estado" pe
    WHERE pe."publicacion_id" = p."publicacion_id" AND pe."publicacion_estado_fecha_baja" IS NULL
);
