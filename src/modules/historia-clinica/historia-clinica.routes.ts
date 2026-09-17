import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadDocumento } from '../../middlewares/uploadDocumento';
import * as controller from './historia-clinica.controller';

/**
 * Alta y listado cuelgan de la mascota (`/mascotas/:mascotaId/historias-clinicas`); el
 * detalle y la edición son recursos propios (`/historias-clinicas/:id`), igual que el
 * resto del modelo 1:N del backend. Se monta en la raíz de /api/v1 (ver catalogos.routes.ts).
 */
export const historiaClinicaRouter = Router();

historiaClinicaRouter.post(
  '/mascotas/:mascotaId/historias-clinicas',
  autenticar,
  uploadDocumento('documento'),
  comprimirImagen,
  controller.crear,
);

historiaClinicaRouter.get('/mascotas/:mascotaId/historias-clinicas', autenticar, controller.listar);

historiaClinicaRouter.get('/historias-clinicas/:id', autenticar, controller.obtener);

historiaClinicaRouter.patch(
  '/historias-clinicas/:id',
  autenticar,
  uploadDocumento('documento'),
  comprimirImagen,
  controller.editar,
);

// HU-8.4: baja lógica.
historiaClinicaRouter.delete('/historias-clinicas/:id', autenticar, controller.eliminar);
