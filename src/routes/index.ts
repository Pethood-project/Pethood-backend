import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { adminUsuariosRouter } from '../modules/admin-usuarios/admin-usuarios.routes';
import { usuariosRouter } from '../modules/usuarios/usuarios.routes';
import { catalogosRouter } from '../modules/catalogos/catalogos.routes';
import { chatsRouter } from '../modules/chats/chats.routes';
import { dashboardAdminRouter } from '../modules/dashboard-admin/dashboard-admin.routes';
import { dashboardRefugioRouter } from '../modules/dashboard-refugio/dashboard-refugio.routes';
import { favoritosRouter } from '../modules/favoritos/favoritos.routes';
import { historiaClinicaRouter } from '../modules/historia-clinica/historia-clinica.routes';
import { mascotasRouter } from '../modules/mascotas/mascotas.routes';
import { publicacionesRouter } from '../modules/publicaciones/publicaciones.routes';
import { solicitudesRouter } from '../modules/solicitudes/solicitudes.routes';
import { seguimientoRouter } from '../modules/seguimiento/seguimiento.routes';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, servicio: 'pethood-api', fecha: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', dashboardAdminRouter);
apiRouter.use('/admin', adminUsuariosRouter);
apiRouter.use('/refugio', dashboardRefugioRouter);
apiRouter.use('/usuarios', usuariosRouter);

// Módulos (descomentar a medida que se implementan las specs):
// apiRouter.use('/mascotas', mascotasRouter);    // spec 002
// apiRouter.use('/publicaciones', pubRouter);    // spec 002
apiRouter.use('/mascotas', mascotasRouter);
apiRouter.use('/publicaciones', publicacionesRouter);
apiRouter.use('/favoritos', favoritosRouter);
apiRouter.use('/solicitudes', solicitudesRouter); // spec 003 — HU-7.4/7.5
apiRouter.use('/chats', chatsRouter);
apiRouter.use('/', catalogosRouter);
apiRouter.use('/', historiaClinicaRouter); // spec 005
apiRouter.use('/', seguimientoRouter); // spec 011

// Módulos (descomentar a medida que se implementan las specs):
// apiRouter.use('/usuarios', usuariosRouter);    // spec 001
// apiRouter.use('/solicitudes', solicitudesRouter); // spec 003
