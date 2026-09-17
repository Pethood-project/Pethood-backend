/**
 * Persistencia de archivos subidos: disco local en `uploads/`, servido desde
 * `/api/v1/archivos`. Deuda consciente — en producción va a object storage, pero el
 * cambio queda contenido acá porque el resto solo usa la URL que devuelve guardarImagen.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DIRECTORIO_UPLOADS = join(__dirname, '..', '..', 'uploads');
export const RUTA_PUBLICA_ARCHIVOS = '/api/v1/archivos';

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Guarda la imagen (ya comprimida) y devuelve la URL pública que se persiste en base. */
export async function guardarImagen(
  archivo: { buffer: Buffer; mimetype: string },
  subcarpeta: string,
): Promise<string> {
  const extension = EXTENSION_POR_MIME[archivo.mimetype] ?? 'jpg';
  const nombre = `${randomUUID()}.${extension}`;
  const destino = join(DIRECTORIO_UPLOADS, subcarpeta);

  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, nombre), archivo.buffer);

  return `${RUTA_PUBLICA_ARCHIVOS}/${subcarpeta}/${nombre}`;
}

/** Guarda varias imágenes conservando el orden recibido. */
export function guardarImagenes(
  archivos: { buffer: Buffer; mimetype: string }[],
  subcarpeta: string,
): Promise<string[]> {
  return Promise.all(archivos.map((archivo) => guardarImagen(archivo, subcarpeta)));
}

/** Compensa una imagen ya guardada cuando falla la escritura en base. No lanza. */
export async function borrarImagen(urlPublica: string): Promise<void> {
  const relativa = urlPublica.replace(`${RUTA_PUBLICA_ARCHIVOS}/`, '');
  if (relativa.includes('..')) return;

  try {
    await unlink(join(DIRECTORIO_UPLOADS, relativa));
  } catch {
    // Ya no existe: nada que compensar.
  }
}

export async function borrarImagenes(urlsPublicas: string[]): Promise<void> {
  await Promise.all(urlsPublicas.map(borrarImagen));
}
