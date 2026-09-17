import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from './errorHandler';

/**
 * Valida `req.body` contra un schema Zod del módulo (`<modulo>.dto.ts`) antes de llegar
 * al controller (CONSTITUTION.md §4: validación de entrada en TODOS los endpoints).
 *
 * Reemplaza el body por el resultado parseado, así el controller recibe los datos ya
 * coercionados y tipados (ej. el `peso` que llega como string en multipart ya es number).
 */
export function validarBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = schema.safeParse(req.body);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      const campo = primero?.path.join('.') ?? 'body';
      next(new AppError('VALIDACION', primero?.message ?? `Campo inválido: ${campo}`, 400));
      return;
    }

    req.body = resultado.data;
    next();
  };
}
