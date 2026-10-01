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

// Opciones del filtro por lugar: provincias con avisos y sus localidades con avisos.
animalesPerdidosRouter.get('/ubicaciones', controller.listarUbicaciones);

// Ubicar el lugar en el mapa antes de publicar (GUI-25), como la dirección del perfil: el
// preview geocodifica provincia, localidad y referencia, y `link` lee el punto de un link de
// Google Maps pegado a mano. Ninguno guarda nada.
animalesPerdidosRouter.post('/lugar/preview', controller.ubicarLugar);
animalesPerdidosRouter.post('/lugar/link', controller.leerLinkMapa);

// HU-13.1: alta del aviso (GUI-25). Misma cadena de imágenes que las publicaciones: de 1 a 5
// fotos en `fotos`, jpg/png/webp, ≤5 MB cada una, en el orden de la galería.
animalesPerdidosRouter.post(
  '/',
  uploadImagenes('fotos', LIMITES.animalPerdido.imagenes.max),
  comprimirImagen,
  controller.crear,
);

// HU-13.2: reclamar el aviso abre (o reencuentra) la sala de reencuentro con quien lo
// publicó. Es POST y no PATCH por lo mismo que `/chats/:id/leidos`: no se edita un recurso
// identificado, se ejecuta la acción "reclamo este aviso".
//
// Sin `validar(...)`: no recibe body. Quién puede reclamar y en qué estado lo valida el
// service, que es el que conoce el aviso.
animalesPerdidosRouter.post('/:id/reclamo', controller.reclamar);

// HU-13.2: el reportante cierra el caso. Mismo criterio de verbo que el reclamo.
animalesPerdidosRouter.post('/:id/resuelto', controller.resolver);
