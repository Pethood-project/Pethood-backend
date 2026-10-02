/**
 * Dónde viven los archivos que suben los usuarios.
 *
 * Es la **única puerta** de persistencia de archivos del proyecto: la usan mascotas,
 * publicaciones, historia clínica, seguimiento y chat. Por dentro elige el destino; por fuera
 * los módulos siguen viendo las mismas cuatro funciones de siempre y no saben ni les importa
 * dónde terminó el archivo.
 *
 * ## Los dos destinos
 *
 * - **Cloudflare R2** (object storage) cuando `R2_ENABLED=true`. Es el destino correcto.
 * - **Disco local** (`uploads/`, servido desde `/api/v1/archivos`) cuando no.
 *
 * ## Por qué importa
 *
 * En Render el disco del contenedor es **efímero**: se recrea en cada deploy y en cada
 * reinicio. Todo lo que hay en `uploads/` desaparece, y las filas de la base quedan apuntando
 * a archivos que ya no existen — una conversación entera con las fotos rotas, sin forma de
 * recuperarlas. Con R2 los archivos viven fuera del servidor, que pasa a ser descartable: se
 * puede redeployar y hasta correr en varias instancias, cosa que hoy rompe solo (dos
 * instancias = dos discos distintos, y el que sube no es el que sirve).
 *
 * ## Por qué la ramificación va acá adentro y no en cada módulo
 *
 * Los cinco módulos llaman exactamente a estas cuatro funciones. Poniendo la decisión acá,
 * **migran todos a la vez sin cambiar una sola línea** en sus services. La alternativa —un
 * envoltorio por módulo, como `imagenPerfil.ts`— habría dejado unos módulos en R2 y otros en
 * disco, que es justo lo que `api-chat-sala.md` había descartado: dos backends de
 * almacenamiento conviviendo es peor que cualquiera de los dos solo.
 *
 * ## Borrar mira la URL, no el flag
 *
 * Después de activar R2 la base tiene URLs de las dos épocas conviviendo: relativas
 * (`/api/v1/archivos/…`) las viejas y absolutas (`https://…r2.dev/…`) las nuevas. Por eso
 * `borrarImagen` decide por la **forma de la URL** y no por `R2_ENABLED`: así sigue borrando
 * bien lo que se guardó antes de la migración, y también si algún día R2 se apaga.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { extensionPara } from './extensiones';
import { borrarArchivo, esUrlDeR2, r2Habilitado, subirArchivo } from './r2';

export const DIRECTORIO_UPLOADS = join(__dirname, '..', '..', 'uploads');
export const RUTA_PUBLICA_ARCHIVOS = '/api/v1/archivos';

interface ArchivoEnMemoria {
  buffer: Buffer;
  mimetype: string;
}

/** Escribe en `uploads/<subcarpeta>/` y devuelve la ruta pública relativa. */
async function guardarEnDisco(archivo: ArchivoEnMemoria, subcarpeta: string): Promise<string> {
  const nombre = `${randomUUID()}.${extensionPara(archivo.mimetype)}`;
  const destino = join(DIRECTORIO_UPLOADS, subcarpeta);

  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, nombre), archivo.buffer);

  return `${RUTA_PUBLICA_ARCHIVOS}/${subcarpeta}/${nombre}`;
}

/** Borra del disco local. No lanza: se usa para compensar, y el error que importa es el otro. */
async function borrarDelDisco(urlPublica: string): Promise<void> {
  const relativa = urlPublica.replace(`${RUTA_PUBLICA_ARCHIVOS}/`, '');
  if (relativa.includes('..')) return;

  try {
    await unlink(join(DIRECTORIO_UPLOADS, relativa));
  } catch {
    // Ya no existe: nada que compensar.
  }
}

/**
 * Guarda el archivo (ya comprimido, si es imagen) y devuelve la URL que se persiste en base.
 *
 * `subcarpeta` agrupa por origen (`chats`, `mascotas`, `perfiles`…) y vale para los dos
 * destinos: es la carpeta en disco y el prefijo de la key en el bucket.
 */
export function guardarImagen(archivo: ArchivoEnMemoria, subcarpeta: string): Promise<string> {
  return r2Habilitado() ? subirArchivo(archivo, subcarpeta) : guardarEnDisco(archivo, subcarpeta);
}

/**
 * Guarda varios **conservando el orden recibido**, que es el que después ve el usuario en la
 * grilla de un mensaje o en la galería de una publicación.
 */
export function guardarImagenes(
  archivos: ArchivoEnMemoria[],
  subcarpeta: string,
): Promise<string[]> {
  return Promise.all(archivos.map((archivo) => guardarImagen(archivo, subcarpeta)));
}

/**
 * Borra un archivo ya guardado. Se usa para compensar cuando la escritura en base falla
 * después de haberlo subido, y al reemplazar la foto de algo.
 *
 * Decide por la forma de la URL, no por `R2_ENABLED` — ver la cabecera del archivo.
 */
export async function borrarImagen(urlPublica: string): Promise<void> {
  if (esUrlDeR2(urlPublica)) {
    await borrarArchivo(urlPublica);
    return;
  }

  await borrarDelDisco(urlPublica);
}

export async function borrarImagenes(urlsPublicas: string[]): Promise<void> {
  await Promise.all(urlsPublicas.map(borrarImagen));
}
