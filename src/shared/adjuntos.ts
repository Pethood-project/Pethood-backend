/**
 * Qué es cada adjunto de un mensaje de chat: una imagen o un video.
 *
 * **Por qué se deduce y no se guarda.** `mensaje_imagenes` es un `String[]` de URLs y no
 * tiene columna de tipo. Agregarla significaría una migración y tocar `MODELO_DATOS.md`,
 * que es la fuente de verdad del diagrama de clases de la entrega, por un dato que ya está
 * contenido en la URL: la extensión la pone `storage.ts` a partir del mimetype real que
 * validó multer, no el cliente, así que es confiable.
 *
 * El día que un mensaje necesite guardar algo más por adjunto (duración, miniatura,
 * tamaño), esto deja de alcanzar y corresponde una tabla `MensajeAdjunto` propia. Hasta
 * entonces, una función pura evita una migración.
 *
 * **El cliente no deduce nada:** el backend expone `adjuntos` ya clasificados, igual que
 * resuelve el contacto del listado en vez de hacer que el cliente compare ids.
 */
import { LIMITES } from './validation/limits';

export type TipoAdjunto = 'IMAGEN' | 'VIDEO';

/** Extensiones que `storage.ts` le pone a cada formato de video aceptado. */
const EXTENSIONES_VIDEO = new Set(['mp4', 'mov', 'webm']);

const MIMES_VIDEO = new Set<string>(LIMITES.video.formatos);

/** `true` si el archivo que llegó por multipart es un video. Se mira el mimetype validado. */
export function esMimeDeVideo(mimetype: string): boolean {
  return MIMES_VIDEO.has(mimetype.toLowerCase().trim());
}

/**
 * Qué es la URL guardada. Ante cualquier duda devuelve `IMAGEN`: es lo que era todo antes de
 * que existiera el video, así que un dato viejo o raro se sigue comportando como siempre.
 */
export function tipoDeUrl(url: string): TipoAdjunto {
  const extension = url.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONES_VIDEO.has(extension) ? 'VIDEO' : 'IMAGEN';
}

export interface AdjuntoMensaje {
  url: string;
  tipo: TipoAdjunto;
}

/** Clasifica las URLs guardadas, conservando el orden en que se enviaron. */
export function clasificarAdjuntos(urls: string[]): AdjuntoMensaje[] {
  return urls.map((url) => ({ url, tipo: tipoDeUrl(url) }));
}
