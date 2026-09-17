import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errorHandler';
import { LIMITES } from '../shared/validation/limits';

const MIME_PERMITIDOS = new Set(LIMITES.documento.formatos as readonly string[]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITES.documento.tamanioMaximoBytes },
  fileFilter: (_req, file, cb) => {
    if (!MIME_PERMITIDOS.has(file.mimetype)) {
      cb(
        new AppError(
          'ARCHIVO_INVALIDO',
          'No es posible subir ese documento, revise el formato o tamaño',
          400,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

/**
 * Upload de un único comprobante médico (imagen o pdf) para historia clínica. Queda en
 * memoria (`req.file.buffer`); `comprimirImagen` lo procesa si es imagen y lo deja pasar
 * tal cual si es pdf.
 */
export function uploadDocumento(campo: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(campo)(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            'ARCHIVO_DEMASIADO_GRANDE',
            'No es posible subir ese documento, revise el formato o tamaño',
            400,
          ),
        );
        return;
      }

      next(err);
    });
  };
}
