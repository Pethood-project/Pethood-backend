import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { idDeParametro, responder } from '../../shared/responder';
import {
  filtrosReportesSchema,
  type CrearReporteBody,
  type ResolverReporteBody,
} from './reportes.dto';
import * as service from './reportes.service';

/** HU-3.1 a 3.3. */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CrearReporteBody;
    res.status(201).json(await service.crearReporte(req.usuario!.usuarioId, body));
  } catch (err) {
    next(err);
  }
}

/** HU-3.6. */
export const listar = responder(async (req) => {
  const r = filtrosReportesSchema.safeParse(req.query);
  if (!r.success) {
    throw new AppError('VALIDACION', r.error.issues[0]?.message ?? 'Filtros inválidos', 400);
  }
  return service.listar(r.data);
});

export const obtener = responder((req) => service.obtener(idDeParametro(req)));

/** HU-3.7. */
export const resolver = responder((req) =>
  service.resolver(req.usuario!.usuarioId, idDeParametro(req), req.body as ResolverReporteBody),
);
