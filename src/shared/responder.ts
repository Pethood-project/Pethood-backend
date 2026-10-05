import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middlewares/errorHandler';
import { parsearId } from './validation/numbers';

/** `:id` de la ruta como entero, o 400. */
export function idDeParametro(req: Request): number {
  const id = parsearId(req.params.id);
  if (id === null) throw new AppError('VALIDACION', 'El id no es válido', 400);
  return id;
}

/** Envuelve el try/catch repetido de los controllers: el handler solo devuelve el JSON. */
export const responder =
  (handler: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      next(err);
    }
  };
