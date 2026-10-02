/**
 * La extensión que le corresponde a cada tipo de archivo que el proyecto acepta subir.
 *
 * **Vive en un solo lugar a propósito.** Antes había dos mapas: uno en `storage.ts` (disco
 * local) y otro en `r2.ts` (object storage), y divergieron — el de R2 nunca supo de video, así
 * que un `.mp4` se habría guardado como `.jpg` apenas se activara R2 para el chat. El bug era
 * silencioso: el archivo subía, la URL se persistía, y recién fallaba al reproducir.
 *
 * Con un mapa único no pueden volver a separarse.
 *
 * **La extensión no es cosmética.** Es lo que distingue un video de una foto en
 * `mensaje_imagenes`, que guarda las dos cosas en la misma columna y sin campo de tipo: es de
 * donde `shared/adjuntos.ts` deduce si un adjunto es `IMAGEN` o `VIDEO`.
 */

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  // Video: hoy sólo lo sube el chat (HU-5.2, adjuntos de mensaje).
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/**
 * Extensión sin punto. Cae a `jpg` ante un mimetype desconocido, que es el caso histórico:
 * antes de que existieran los adjuntos de chat, todo lo que se subía era una imagen.
 *
 * No debería pasar nunca — los middlewares de upload rechazan cualquier mimetype que no esté
 * en esta lista antes de llegar acá.
 */
export function extensionPara(mimetype: string): string {
  return EXTENSION_POR_MIME[mimetype.toLowerCase().trim()] ?? 'jpg';
}
