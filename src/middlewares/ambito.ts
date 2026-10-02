import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler';
import type { Ambito } from '../shared/ambito';

/** Lo que se le dice a quien pega a una ruta desde el perfil equivocado. */
const MENSAJE_POR_AMBITO: Record<Ambito, string> = {
  PERSONAL: 'Esto es de tu perfil personal. Cambiá a la vista de adoptante para usarlo',
  REFUGIO: 'Esto es del refugio. Cambiá a la vista de refugio para usarlo',
};

/**
 * Corta la ruta si el pedido no viene del perfil indicado (ver `shared/ambito.ts`). Requiere
 * que `autenticar` haya corrido antes en la cadena.
 */
export function requiereAmbito(ambito: Ambito) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.ambito !== ambito) {
      next(new AppError('AMBITO_NO_PERMITIDO', MENSAJE_POR_AMBITO[ambito], 403));
      return;
    }

    next();
  };
}
