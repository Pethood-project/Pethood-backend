import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { autenticar } from '../../middlewares/auth';
import { AppError } from '../../middlewares/errorHandler';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import * as controller from './soporte.controller';
import {
  categoriaBodySchema,
  categoriaPatchSchema,
  consultaBodySchema,
  faqBodySchema,
  faqPatchSchema,
} from './soporte.dto';

export const soporteRouter = Router();

/**
 * El formulario es público (HU-15.2), así que no hay usuario al que aplicarle una quota:
 * se limita por IP. ponytail: contador en memoria del proceso; con varias instancias hace
 * falta un store compartido (Redis).
 */
const limitarConsultas = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(
      new AppError(
        'DEMASIADAS_CONSULTAS',
        'Enviaste demasiadas consultas. Probá de nuevo más tarde.',
        429,
      ),
    ),
});

const admin = [autenticar, requiereRol(ROL_API.ADMIN)];

// Públicas
soporteRouter.get('/faqs', controller.listarFaqs);
soporteRouter.post(
  '/soporte/consultas',
  limitarConsultas,
  validar(consultaBodySchema),
  controller.enviarConsulta,
);

// Admin: consultas
soporteRouter.get('/admin/soporte/consultas', ...admin, controller.listarConsultas);
soporteRouter.patch('/admin/soporte/consultas/:id/resolver', ...admin, controller.resolverConsulta);
soporteRouter.delete('/admin/soporte/consultas/:id', ...admin, controller.bajaConsulta);

// Admin: categorías
soporteRouter.get('/admin/faq-categorias', ...admin, controller.listarCategorias);
soporteRouter.post(
  '/admin/faq-categorias',
  ...admin,
  validar(categoriaBodySchema),
  controller.crearCategoria,
);
soporteRouter.patch(
  '/admin/faq-categorias/:id',
  ...admin,
  validar(categoriaPatchSchema),
  controller.editarCategoria,
);
soporteRouter.delete('/admin/faq-categorias/:id', ...admin, controller.bajaCategoria);

// Admin: FAQs
soporteRouter.post('/admin/faqs', ...admin, validar(faqBodySchema), controller.crearFaq);
soporteRouter.patch('/admin/faqs/:id', ...admin, validar(faqPatchSchema), controller.editarFaq);
soporteRouter.delete('/admin/faqs/:id', ...admin, controller.bajaFaq);
