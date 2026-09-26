import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { requiereRol } from '../../middlewares/roles';
import { uploadImagenOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import * as controller from './perfil-refugio.controller';
import { actualizarPerfilRefugioBodySchema } from './perfil-refugio.dto';

export const perfilRefugioRouter = Router();

// Es del refugio: desde el perfil personal no se ve (spec 016, regla 3).
perfilRefugioRouter.get(
  '/perfil',
  autenticar,
  requiereRol(ROL_API.MIEMBRO_REFUGIO),
  requiereAmbito('REFUGIO'),
  controller.obtener,
);

perfilRefugioRouter.patch(
  '/perfil',
  autenticar,
  requiereRol(ROL_API.MIEMBRO_REFUGIO),
  requiereAmbito('REFUGIO'),
  uploadImagenOpcional('imagen'),
  comprimirImagen,
  validar(actualizarPerfilRefugioBodySchema),
  controller.actualizar,
);
