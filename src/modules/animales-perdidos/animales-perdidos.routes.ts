import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenes } from '../../middlewares/uploadImagen';
import { LIMITES } from '../../shared/validation/limits';
import * as controller from './animales-perdidos.controller';

export const animalesPerdidosRouter = Router();

// Cualquier usuario autenticado, desde cualquiera de sus dos perfiles: el aviso es siempre de
// la persona (ver animales-perdidos.service.ts). Por eso no hay `requiereAmbito`.
animalesPerdidosRouter.use(autenticar);

// HU-13.1: el portal (GUI-06), paginado por cursor y con filtros por query.
animalesPerdidosRouter.get('/', controller.listar);

// Opciones del filtro por ubicación, mientras la ubicación sea texto libre.
animalesPerdidosRouter.get('/ubicaciones', controller.listarUbicaciones);

// HU-13.1: alta del aviso (GUI-25). Misma cadena de imágenes que las publicaciones: de 1 a 5
// fotos en `fotos`, jpg/png/webp, ≤5 MB cada una, en el orden de la galería.
animalesPerdidosRouter.post(
  '/',
  uploadImagenes('fotos', LIMITES.animalPerdido.imagenes.max),
  comprimirImagen,
  controller.crear,
);
