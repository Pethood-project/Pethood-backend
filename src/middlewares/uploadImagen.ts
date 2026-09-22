import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errorHandler';
import { LIMITES } from '../shared/validation/limits';

// Formatos y tamaño máximo según la tabla de validez de campos de REQUISITOS.md /
// regla transversal 5 de CLAUDE.md (imágenes/documentos ≤5MB, jpg/png/webp/jpeg).
const MIME_PERMITIDOS = new Set(LIMITES.imagen.formatos);
const TAMANO_MAXIMO_BYTES = LIMITES.imagen.tamanioMaximoBytes;

/**
 * Los adjuntos de un mensaje de chat: imagen **o** video. Es el único punto del proyecto que
 * acepta video, así que va como un multer aparte en vez de ensanchar el de imagen — si los
 * formatos de video entraran en `MIME_PERMITIDOS`, el alta de mascota, las publicaciones y
 * la foto de perfil empezarían a aceptar `.mp4` sin que nadie lo haya pedido.
 */
const MIME_ADJUNTO_CHAT = new Set<string>([...LIMITES.imagen.formatos, ...LIMITES.video.formatos]);

/** Un multer con su propio juego de formatos permitidos, su techo y su mensaje de rechazo. */
function crearUpload(
  mimesPermitidos: ReadonlySet<string>,
  mensajeFormato: string,
  tamanioMaximo: number = TAMANO_MAXIMO_BYTES,
) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: tamanioMaximo },
    fileFilter: (_req, file, cb) => {
      if (!mimesPermitidos.has(file.mimetype)) {
        cb(new AppError('ARCHIVO_INVALIDO', mensajeFormato, 400));
        return;
      }
      cb(null, true);
    },
  });
}

const upload = crearUpload(MIME_PERMITIDOS, 'La imagen debe ser jpg, png o webp');

/**
 * El techo del chat es el del video, que es el archivo más grande que admite. **No relaja el
 * límite de las imágenes**: `validarTamanioAdjuntos` le aplica a cada archivo el tope de su
 * tipo apenas multer termina. Multer no puede hacerlo solo — su `fileSize` es uno por
 * instancia y no sabe el mimetype hasta que el archivo ya entró.
 */
const uploadAdjuntoChat = crearUpload(
  MIME_ADJUNTO_CHAT,
  'Adjuntá una imagen (jpg, png o webp) o un video (mp4, mov o webm)',
  LIMITES.video.tamanioMaximoBytes,
);

/** Los megas de un tope, para los mensajes al usuario. */
function enMegas(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Cómo se nombra lo subido en los mensajes de error al usuario. Los módulos que sólo
 * aceptan fotos hablan de "la imagen"; el chat, que también acepta video, de "el archivo".
 */
interface TextosUpload {
  /** Con artículo y en singular: "La imagen", "El archivo". */
  sujeto: string;
  /** Lo que se cuenta, para "Podés subir hasta N ...". */
  contable: { uno: string; varios: string };
}

const TEXTOS_IMAGEN: TextosUpload = {
  sujeto: 'La imagen',
  contable: { uno: 'foto', varios: 'fotos' },
};

const TEXTOS_ADJUNTO_CHAT: TextosUpload = {
  sujeto: 'El archivo',
  contable: { uno: 'archivo', varios: 'archivos' },
};

/** Traduce los errores de multer al formato de error de la API. */
function manejarError(
  middleware: RequestHandler,
  maximo?: number,
  textos: TextosUpload = TEXTOS_IMAGEN,
  tamanioMaximo: number = TAMANO_MAXIMO_BYTES,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(
            new AppError(
              'ARCHIVO_DEMASIADO_GRANDE',
              `${textos.sujeto} supera el máximo de ${enMegas(tamanioMaximo)}MB`,
              400,
            ),
          );
          return;
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE' && maximo) {
          next(
            new AppError(
              'DEMASIADOS_ARCHIVOS',
              `Podés subir hasta ${maximo} ${maximo === 1 ? textos.contable.uno : textos.contable.varios}`,
              400,
            ),
          );
          return;
        }
      }

      next(err);
    });
  };
}

/**
 * Acepta multipart/form-data (con o sin archivo) y deja pasar JSON para no romper
 * clientes que siguen registrándose sin foto.
 */
export function uploadImagenOpcional(campo: string): RequestHandler {
  const middleware = uploadImagen(campo);

  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.toLowerCase().includes('multipart/form-data')) {
      middleware(req, res, next);
      return;
    }
    next();
  };
}

/**
 * Igual que `uploadImagenOpcional` pero para varias imágenes bajo el mismo campo: deja pasar
 * el JSON sin tocar y sólo activa multer cuando el cuerpo es multipart.
 *
 * Lo usa el envío de mensajes (HU-5.2), donde un mensaje puede no llevar ninguna foto,
 * llevar una o llevar hasta el máximo.
 */
export function uploadImagenesOpcional(campo: string, maximo: number): RequestHandler {
  const middleware = uploadImagenes(campo, maximo);

  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.toLowerCase().includes('multipart/form-data')) {
      middleware(req, res, next);
      return;
    }
    next();
  };
}

/**
 * Upload de una única imagen. La deja en memoria (`req.file.buffer`) para que
 * comprimirImagen la procese antes de que el controller la persista.
 */
export function uploadImagen(campo: string): RequestHandler {
  return manejarError(upload.single(campo));
}

/** Upload de varias imágenes bajo el mismo campo. Quedan en `req.files`, en orden. */
export function uploadImagenes(campo: string, maximo: number): RequestHandler {
  return manejarError(upload.array(campo, maximo), maximo);
}

/**
 * Adjuntos de un mensaje de chat bajo el mismo campo: imagen o video, hasta `maximo`.
 * Deja pasar el JSON (mensaje de solo texto) sin tocarlo, igual que `uploadImagenesOpcional`.
 *
 * Es el único upload del proyecto que acepta video. Los demás módulos siguen usando
 * `uploadImagen*`, que no lo admite.
 */
export function uploadAdjuntosChatOpcional(campo: string, maximo: number): RequestHandler {
  const middleware = manejarError(
    uploadAdjuntoChat.array(campo, maximo),
    maximo,
    TEXTOS_ADJUNTO_CHAT,
    LIMITES.video.tamanioMaximoBytes,
  );

  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.toLowerCase().includes('multipart/form-data')) {
      middleware(req, res, next);
      return;
    }
    next();
  };
}

/**
 * Le aplica a cada archivo subido el tope de **su** tipo: 5 MB una imagen, 30 MB un video.
 *
 * Existe porque el `fileSize` de multer es uno solo por instancia y no puede depender del
 * mimetype: para que un video de 15 s entre, el techo del request tiene que ser el del video,
 * y sin este chequeo una imagen de 20 MB pasaría de largo.
 *
 * Va **antes** de `comprimirImagen` a propósito: después de que `sharp` la achica, el peso
 * que mide ya no es el que subió el usuario y el límite de REQUISITOS.md §4 dejaría de
 * significar algo.
 */
export function validarTamanioAdjuntos(req: Request, _res: Response, next: NextFunction): void {
  const archivos = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : []),
  ];

  for (const archivo of archivos) {
    const esVideo = (LIMITES.video.formatos as readonly string[]).includes(archivo.mimetype);
    const tope = esVideo ? LIMITES.video.tamanioMaximoBytes : LIMITES.imagen.tamanioMaximoBytes;

    if (archivo.size > tope) {
      next(
        new AppError(
          'ARCHIVO_DEMASIADO_GRANDE',
          `${esVideo ? 'El video' : 'La imagen'} supera el máximo de ${enMegas(tope)}MB`,
          400,
        ),
      );
      return;
    }
  }

  next();
}
