import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagen } from '../../middlewares/uploadImagen';
import * as controller from './seguimiento.controller';

/**
 * Spec 011 (HU-9.1/HU-9.2). El listado de una solicitud cuelga de ella
 * (`/solicitudes/:solicitudId/seguimientos`) y el pedido puntual es recurso propio
 * (`/seguimientos/:id`), igual que historia clínica. Por eso se monta en la raíz de /api/v1.
 *
 * No lleva `requiereRol`: quién puede ver o responder no depende del rol global sino del
 * vínculo con esa solicitud (adoptante vs. publicador), y eso lo resuelve el service.
 */
export const seguimientoRouter = Router();

seguimientoRouter.get('/seguimientos', autenticar, controller.listarMios);

seguimientoRouter.get(
  '/solicitudes/:solicitudId/seguimientos',
  autenticar,
  controller.listarDeSolicitud,
);

// HU-9.3: una actualización suelta. Se declara ANTES del POST anidado por prolijidad, pero
// no compiten: Express distingue por método y por la profundidad de la ruta.
seguimientoRouter.get('/seguimientos/:id', autenticar, controller.obtenerActualizacion);

// La foto de evidencia se comprime antes de que el controller la persista (regla
// transversal 4). El front debe forzar cámara nativa y bloquear galería (regla 9).
seguimientoRouter.post(
  '/seguimientos/:id/actualizacion',
  autenticar,
  uploadImagen('foto'),
  comprimirImagen,
  controller.subirActualizacion,
);
