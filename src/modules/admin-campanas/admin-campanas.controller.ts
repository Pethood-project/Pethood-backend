import { AppError } from '../../middlewares/errorHandler';
import { idDeParametro, responder } from '../../shared/responder';
import { filtrosCampanasSchema } from './admin-campanas.dto';
import * as service from './admin-campanas.service';

export const listar = responder(async (req) => {
  const r = filtrosCampanasSchema.safeParse(req.query);
  if (!r.success) {
    throw new AppError('VALIDACION', r.error.issues[0]?.message ?? 'Filtros inválidos', 400);
  }
  return service.listar(r.data);
});

export const obtener = responder((req) => service.obtener(idDeParametro(req)));
