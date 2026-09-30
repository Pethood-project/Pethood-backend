import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { requiereRol } from '../../middlewares/roles';
import { uploadImagen } from '../../middlewares/uploadImagen';
import { ROL_API } from '../../shared/roles';
import * as controller from './campanias.controller';

/**
 * Lado del adoptante (spec 021). Portal y donar exigen el perfil Personal: desde el perfil
 * Refugio no se dona. El detalle lo ve cualquiera (lo abre también el refugio).
 */
export const campaniasRouter = Router();

campaniasRouter.use(autenticar);

// HU-12.2: portal de campañas Activa, paginado por cursor.
campaniasRouter.get('/', requiereAmbito('PERSONAL'), controller.listarPortal);

// HU-12.2: detalle con alias y CBU.
campaniasRouter.get('/:id', controller.obtener);

// HU-12.3: «Terminar donación».
campaniasRouter.post('/:id/donaciones', requiereAmbito('PERSONAL'), controller.donar);

/**
 * Lado del refugio. Se monta en `/refugio`, que comparten otros routers: por eso los
 * middlewares van por ruta y no con `use`.
 */
export const campaniasRefugioRouter = Router();

const soloRefugio = [autenticar, requiereRol(ROL_API.MIEMBRO_REFUGIO), requiereAmbito('REFUGIO')];

// HU-12.1: «Mis Campañas» y alta (imagen jpg/png/webp ≤5 MB en `imagen`).
campaniasRefugioRouter.get('/campanias', ...soloRefugio, controller.listarDelRefugio);
campaniasRefugioRouter.post(
  '/campanias',
  ...soloRefugio,
  uploadImagen('imagen'),
  comprimirImagen,
  controller.crear,
);

// HU-12.5 / HU-12.6: finalizar o cancelar.
campaniasRefugioRouter.patch('/campanias/:id/estado', ...soloRefugio, controller.cambiarEstado);

// HU-12.3: bandeja de revisión y aplicar/rechazar.
campaniasRefugioRouter.get(
  '/campanias/:id/donaciones',
  ...soloRefugio,
  controller.listarDonaciones,
);
campaniasRefugioRouter.patch('/donaciones/:id/estado', ...soloRefugio, controller.resolverDonacion);
