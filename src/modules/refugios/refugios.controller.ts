import { idDeParametro, responder } from '../../shared/responder';
import * as service from './refugios.service';

/** Perfil público de un refugio (spec 023, GUI-26). */
export const obtenerPerfilPublico = responder((req) =>
  service.obtenerPerfilPublico(idDeParametro(req), req.usuario!.usuarioId),
);
