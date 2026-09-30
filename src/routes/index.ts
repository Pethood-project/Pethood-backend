import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { adminUsuariosRouter } from '../modules/admin-usuarios/admin-usuarios.routes';
import { adminCatalogosRouter } from '../modules/admin-catalogos/admin-catalogos.routes';
import { adminMascotasRouter } from '../modules/admin-mascotas/admin-mascotas.routes';
import { adminPublicacionesRouter } from '../modules/admin-publicaciones/admin-publicaciones.routes';
import { adminSolicitudesRouter } from '../modules/admin-solicitudes/admin-solicitudes.routes';
import { animalesPerdidosRouter } from '../modules/animales-perdidos/animales-perdidos.routes';
import { usuariosRouter } from '../modules/usuarios/usuarios.routes';
import { catalogosRouter } from '../modules/catalogos/catalogos.routes';
import { chatsRouter } from '../modules/chats/chats.routes';
import { dashboardAdminRouter } from '../modules/dashboard-admin/dashboard-admin.routes';
import { dashboardRefugioRouter } from '../modules/dashboard-refugio/dashboard-refugio.routes';
import { favoritosRouter } from '../modules/favoritos/favoritos.routes';
import { historiaClinicaRouter } from '../modules/historia-clinica/historia-clinica.routes';
import { mascotasRouter } from '../modules/mascotas/mascotas.routes';
import { perfilRefugioRouter } from '../modules/perfil-refugio/perfil-refugio.routes';
import { publicacionesRouter } from '../modules/publicaciones/publicaciones.routes';
import { solicitudesRouter } from '../modules/solicitudes/solicitudes.routes';
import { seguimientoRouter } from '../modules/seguimiento/seguimiento.routes';
import { soporteRouter } from '../modules/soporte/soporte.routes';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, servicio: 'pethood-api', fecha: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', dashboardAdminRouter);
apiRouter.use('/admin', adminUsuariosRouter);
apiRouter.use('/admin', adminPublicacionesRouter);
apiRouter.use('/admin', adminMascotasRouter);
apiRouter.use('/admin', adminSolicitudesRouter);
apiRouter.use('/admin', adminCatalogosRouter);
apiRouter.use('/refugio', dashboardRefugioRouter);
apiRouter.use('/refugio', perfilRefugioRouter); // spec 017
apiRouter.use('/usuarios', usuariosRouter);

// Módulos (descomentar a medida que se implementan las specs):
// apiRouter.use('/mascotas', mascotasRouter);    // spec 002
// apiRouter.use('/publicaciones', pubRouter);    // spec 002
apiRouter.use('/mascotas', mascotasRouter);
apiRouter.use('/publicaciones', publicacionesRouter);
apiRouter.use('/favoritos', favoritosRouter);
apiRouter.use('/solicitudes', solicitudesRouter); // spec 003 — HU-7.4/7.5
apiRouter.use('/chats', chatsRouter);
apiRouter.use('/animales-perdidos', animalesPerdidosRouter); // spec 020 — HU-13.1
apiRouter.use('/', catalogosRouter);
apiRouter.use('/', historiaClinicaRouter); // spec 005
apiRouter.use('/', seguimientoRouter); // spec 011
apiRouter.use('/', soporteRouter); // spec 015

// Módulos (descomentar a medida que se implementan las specs):
// apiRouter.use('/usuarios', usuariosRouter);    // spec 001
// apiRouter.use('/solicitudes', solicitudesRouter); // spec 003
