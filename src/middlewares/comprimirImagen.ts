import sharp from 'sharp';
import type { NextFunction, Request, Response } from 'express';

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

async function comprimir(archivo: Express.Multer.File): Promise<void> {
  const formato = FORMATO_POR_MIME[archivo.mimetype];

  // No es una imagen conocida (ej. el pdf de un comprobante de historia clínica): se deja
  // el buffer tal cual, sharp no sabe reformatear eso.
  if (!formato) return;

  const comprimida = await sharp(archivo.buffer)
    .resize({ width: ANCHO_MAXIMO_PX, withoutEnlargement: true })
    .toFormat(formato, { quality: CALIDAD })
    .toBuffer();

  archivo.buffer = comprimida;
  archivo.size = comprimida.length;
}

/**
 * Comprime asíncronamente las imágenes subidas, tanto la de `uploadImagen` como las de
 * `uploadImagenes`. No decide dónde ni cómo se persisten — eso es del módulo que lo use.
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

  if (archivos.length === 0) {
    next();
    return;
  }

  try {
    await Promise.all(archivos.map(comprimir));
    next();
  } catch (err) {
    next(err);
  }
}
