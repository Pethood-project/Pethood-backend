import { AppError } from '../../middlewares/errorHandler';
import { idDeParametro, responder } from '../../shared/responder';
import type { MotivoBody } from '../admin-usuarios/admin-usuarios.dto';
import { filtrosMascotasSchema } from './admin-mascotas.dto';
import * as service from './admin-mascotas.service';

export const listar = responder(async (req) => {
  const r = filtrosMascotasSchema.safeParse(req.query);
  if (!r.success) {
    throw new AppError('VALIDACION', r.error.issues[0]?.message ?? 'Filtros inválidos', 400);
  }
  return service.listar(r.data);
});

export const obtener = responder((req) => service.obtener(idDeParametro(req)));

export const darDeBaja = responder((req) =>
  service.darDeBaja(req.usuario!.usuarioId, idDeParametro(req), (req.body as MotivoBody).motivo),
);

export const reactivar = responder((req) =>
  service.reactivar(req.usuario!.usuarioId, idDeParametro(req), (req.body as MotivoBody).motivo),
);
