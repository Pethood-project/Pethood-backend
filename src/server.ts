import { app } from './app';
import { env } from './config/env';
import { detenerJobsProgramados, iniciarJobsProgramados } from './jobs/notificaciones.scheduler';
import { detenerWorkerNotificaciones, iniciarWorkerNotificaciones } from './modules/notificaciones/notificaciones.worker';
import { detenerWebsockets, iniciarWebsockets } from './websockets';

const server = app.listen(env.PORT, () => {
  console.info(`✅ PETHOOD API escuchando en http://localhost:${env.PORT}`);
});

// Chat en tiempo real (HU-5.2), sobre el mismo servidor HTTP: ver src/websockets/index.ts.
const io = iniciarWebsockets(server);

console.info(`🔌 Websockets de chat escuchando en ws://localhost:${env.PORT}/socket.io`);

// Notificaciones (spec 004): cola de push/mail + tareas programadas, mismo proceso que la
// API y los websockets (ver notas en notificaciones.worker.ts y notificaciones.scheduler.ts).
iniciarWorkerNotificaciones();
void iniciarJobsProgramados();

console.info('🔔 Worker y jobs programados de notificaciones arrancados.');

// SIGINT es el Ctrl+C local; SIGTERM es lo que mandan Render y Railway en cada deploy.
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    console.info('\nCerrando servidor...');
    // Primero los sockets: si no, `server.close()` espera a que se caigan las conexiones
    // abiertas y el proceso queda colgado.
    void Promise.all([
      detenerWebsockets(io),
      detenerWorkerNotificaciones(),
      detenerJobsProgramados(),
    ]).then(() => server.close(() => process.exit(0)));
  });
}
