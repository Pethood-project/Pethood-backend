import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import * as controller from './usuarios.controller';
import { actualizarPerfilBodySchema, cambiarPasswordBodySchema } from './usuarios.dto';

export const usuariosRouter = Router();

usuariosRouter.get('/me', autenticar, controller.obtenerMe);
usuariosRouter.patch(
  '/me',
  autenticar,
  uploadImagenOpcional('imagen'),
  comprimirImagen,
  validar(actualizarPerfilBodySchema),
  controller.actualizarMe,
);
usuariosRouter.patch(
  '/me/password',
  autenticar,
  validar(cambiarPasswordBodySchema),
  controller.cambiarPassword,
);
usuariosRouter.delete('/me', autenticar, controller.darDeBajaMe);
