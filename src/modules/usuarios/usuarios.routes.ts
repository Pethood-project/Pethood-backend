import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import * as controller from './usuarios.controller';
import {
  actualizarPerfilBodySchema,
  cargarDniBodySchema,
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
// Carga única del DNI (spec 027): con DNI ya cargado responde DNI_YA_CARGADO.
usuariosRouter.patch('/me/dni', autenticar, validar(cargarDniBodySchema), controller.cargarDni);
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

// Perfil público de otra persona (spec 023). Va al final: `/me/...` ya capturó lo suyo.
usuariosRouter.get('/:id/perfil', autenticar, controller.obtenerPerfilPublico);
