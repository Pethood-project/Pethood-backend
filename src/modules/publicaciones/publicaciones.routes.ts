import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenes } from '../../middlewares/uploadImagen';
import * as controller from './publicaciones.controller';
import { MAXIMO_IMAGENES } from './publicaciones.dto';

export const publicacionesRouter = Router();

// Feed de mascotas en adopción, con los filtros de búsqueda en la query string.
publicacionesRouter.get('/', autenticar, controller.listar);

// Ficha completa de una publicación.
publicacionesRouter.get('/:id', autenticar, controller.obtener);

publicacionesRouter.post(
  '/',
  autenticar,
  uploadImagenes('fotos', MAXIMO_IMAGENES),
  comprimirImagen,
  controller.crear,
);
