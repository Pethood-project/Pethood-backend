import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenes } from '../../middlewares/uploadImagen';
import * as controller from './publicaciones.controller';
import { MAXIMO_IMAGENES } from './publicaciones.dto';

export const publicacionesRouter = Router();

// Feed de mascotas en adopción, con los filtros de búsqueda en la query string. Es para
// adoptar, así que solo desde el perfil personal: el refugio no adopta.
publicacionesRouter.get('/', autenticar, requiereAmbito('PERSONAL'), controller.listar);

// "Mis publicaciones": existe en los dos perfiles y devuelve solo lo del activo. Va antes de
// /:id para que ese literal no caiga ahí.
publicacionesRouter.get('/mias', autenticar, controller.listarMias);

// Ficha completa de una publicación. Abierta desde los dos perfiles: el refugio también
// necesita ver cómo quedó publicada una mascota suya ("Ver publicación asociada").
publicacionesRouter.get('/:id', autenticar, controller.obtener);

publicacionesRouter.post(
  '/',
  autenticar,
  uploadImagenes('fotos', MAXIMO_IMAGENES),
  comprimirImagen,
  controller.crear,
);
