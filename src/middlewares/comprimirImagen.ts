import sharp from 'sharp';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler';
import {
  parsearRecorte,
  parsearRotacion,
  type Recorte,
  type RotacionValida,
} from '../shared/validation/imagen';

// Sin spec que fije estos números todavía — son defaults razonables de downscale para
// fotos de celular (regla transversal 4 de CLAUDE.md: compresión async antes de persistir).
// Ajustar si alguna spec de módulo pide otra cosa.
const ANCHO_MAXIMO_PX = 1600;
const CALIDAD = 75;

const FORMATO_POR_MIME: Record<string, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Recorta (si vino `recorte`) y rota (si vino `rotacion`) antes de comprimir. El recorte se
 * aplica primero porque sus coordenadas son sobre la imagen ORIGINAL — si se rotara antes,
 * ya no coincidirían con lo que el cliente mostró al usuario para elegir el rectángulo.
 */
async function editarYComprimir(
  archivo: Express.Multer.File,
  rotacion: RotacionValida,
  recorte: Recorte | null,
): Promise<void> {
  const formato = FORMATO_POR_MIME[archivo.mimetype];

  // No es una imagen conocida: el pdf de un comprobante de historia clínica, o un video del
  // chat. Recortar, rotar y recomprimir no aplican, así que esos parámetros se ignoran y el
  // buffer queda tal cual.
  //
  // **El video se guarda sin transcodificar, a propósito.** Procesarlo necesitaría `ffmpeg`,
  // una dependencia nativa pesada que complicaría el deploy; en su lugar el tamaño se acota
  // en el origen (5 MB de tope duro en multer, y el cliente limita la duración).
  if (!formato) return;

  let pipeline = sharp(archivo.buffer);

  if (recorte) {
    const metadata = await sharp(archivo.buffer).metadata();
    const anchoOriginal = metadata.width ?? 0;
    const altoOriginal = metadata.height ?? 0;

    if (
      recorte.left + recorte.width > anchoOriginal ||
      recorte.top + recorte.height > altoOriginal
    ) {
      throw new AppError('RECORTE_INVALIDO', 'El recorte excede el tamaño de la imagen', 400);
    }

    pipeline = pipeline.extract(recorte);
  }

  if (rotacion !== 0) {
    pipeline = pipeline.rotate(rotacion);
  }

  const editada = await pipeline
    .resize({ width: ANCHO_MAXIMO_PX, withoutEnlargement: true })
    .toFormat(formato, { quality: CALIDAD })
    .toBuffer();

  archivo.buffer = editada;
  archivo.size = editada.length;
}

async function comprimir(archivo: Express.Multer.File): Promise<void> {
  await editarYComprimir(archivo, 0, null);
}

/**
 * Comprime asíncronamente las imágenes subidas, tanto la de `uploadImagen`/`uploadDocumento`
 * como las de `uploadImagenes`. Además, si el mensaje trae **una sola** imagen y el body
 * incluye `rotacion` y/o `cropX`/`cropY`/`cropWidth`/`cropHeight`, la recorta y rota antes de
 * comprimir (historia clínica, seguimiento, publicaciones y fotos de chat comparten este
 * pipeline).
 *
 * **El criterio es la cantidad de archivos, no por qué middleware entraron.** Antes se
 * miraba `req.file`, que sólo pobla `upload.single`: cuando el chat pasó a aceptar varias
 * fotos (`upload.array`) el recorte y la rotación dejaron de aplicarse ahí en silencio,
 * aunque el contrato los siguiera documentando. Con una sola imagen los parámetros valen
 * venga por donde venga; con dos o más se ignoran, porque un único rectángulo no puede
 * aplicarse a imágenes distintas.
 *
 * No decide dónde ni cómo se persisten las imágenes — eso es del módulo que lo use.
 */
export async function comprimirImagen(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const archivos = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : []),
  ];

  const unica = archivos.length === 1 ? archivos[0] : undefined;

  if (archivos.length === 0) {
    next();
    return;
  }

  try {
    if (unica) {
      const rotacion = parsearRotacion(req.body?.rotacion);
      if (!rotacion.valido) throw new AppError('VALIDACION', rotacion.error, 400);

      const recorte = parsearRecorte(req.body ?? {});
      if (!recorte.valido) throw new AppError('VALIDACION', recorte.error, 400);

      await editarYComprimir(unica, rotacion.valor, recorte.valor);
    } else {
      await Promise.all(archivos.map(comprimir));
    }

    next();
  } catch (err) {
    next(err);
  }
}
