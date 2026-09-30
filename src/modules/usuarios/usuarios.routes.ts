import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import * as controller from './usuarios.controller';
import {
  actualizarPerfilBodySchema,
  actualizarUbicacionBodySchema,
  cambiarPasswordBodySchema,
  previewUbicacionBodySchema,
} from './usuarios.dto';

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
// Edición manual del link del mapa (lápiz de "Ubicación" en Mi Perfil).
usuariosRouter.patch(
  '/me/ubicacion',
  autenticar,
  validar(actualizarUbicacionBodySchema),
  controller.actualizarUbicacion,
);
// Preview del link generado por geocodificación, sin guardar (Datos personales).
usuariosRouter.post(
  '/me/ubicacion/preview',
  autenticar,
  validar(previewUbicacionBodySchema),
  controller.previewUbicacion,
);
usuariosRouter.delete('/me', autenticar, controller.darDeBajaMe);
