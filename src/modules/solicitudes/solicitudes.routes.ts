import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import * as controller from './solicitudes.controller';

export const solicitudesRouter = Router();

// Lado solicitante (HU-7.1 crear, HU-7.3 historial propio).
solicitudesRouter.post('/', autenticar, controller.crear);

solicitudesRouter.get('/mias', autenticar, controller.listarMias);

// Chequeo previo de las precondiciones, para el cartel de GUI-7.1 en vez del formulario.
solicitudesRouter.get('/elegibilidad', autenticar, controller.elegibilidad);

// Lado de quien PUBLICÓ la mascota (HU-7.4/7.5) — refugio o adoptante particular, no un
// rol fijo (ver solicitudes.service.ts).
solicitudesRouter.get('/recibidas', autenticar, controller.listarRecibidas);

// Va al final: `/mias` y `/recibidas` son rutas fijas y este `:id` las capturaría.
// El detalle lo ven las dos puntas, el solicitante incluido (GUI "Mi Solicitud").
solicitudesRouter.get('/:id', autenticar, controller.obtenerDetalle);

solicitudesRouter.patch('/:id/estado', autenticar, controller.resolver);
