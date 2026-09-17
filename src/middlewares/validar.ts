import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from './errorHandler';

/** Valida req.body con Zod y reemplaza el body por el dato parseado. */
export function validar(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = schema.safeParse(req.body);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      const mensaje = primero?.message ?? 'Los datos enviados no son válidos.';
      next(new AppError('VALIDACION', mensaje, 400));
      return;
    }

    req.body = resultado.data;
    next();
  };
}
