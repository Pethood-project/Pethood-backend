/**
 * Arranque del servidor de websockets (HU-5.2).
 *
 * Se cuelga del MISMO `http.Server` que Express. El diagrama de arquitectura (Etapa 6) lo
 * muestra como componente propio, pero eso es una caja lógica: está desplegado en el mismo
 * servicio de Render que la API REST. Un proceso aparte exigiría un segundo servicio y, sí
 * o sí, un adapter de Redis para propagar eventos entre las dos instancias — que es
 * exactamente el trabajo que hoy no hace falta hacer. Compartiendo proceso se reusan la
 * verificación de JWT y el pool de Prisma, y no hay nada que sincronizar.
 *
 * Socket.io se eligió en la Etapa 3 (factibilidad técnica) sobre websockets puros por la
 * reconexión automática, el fallback a long-polling y el manejo de salas.
 */
import type { Server as ServidorHttp } from 'node:http';
import { Server } from 'socket.io';
import { instalarAutenticacion } from './auth';
import { instalarGatewayDeChat } from './chat.gateway';
import { desregistrarServidorSocket, registrarServidorSocket } from './emisor';

export function iniciarWebsockets(servidorHttp: ServidorHttp): Server {
  const io = new Server(servidorHttp, {
    // Mismo criterio que el `cors()` de app.ts: la app mobile no manda Origin y el panel web
    // corre en otro puerto. La autorización real la hace el JWT del handshake, no el origen.
    cors: { origin: '*' },
    path: '/socket.io',
  });

  instalarAutenticacion(io);
  instalarGatewayDeChat(io);

  // Desde acá el service puede emitir sin importar socket.io.
  registrarServidorSocket(io);

  return io;
}

/** Cierra las conexiones abiertas en el apagado ordenado del proceso. */
export async function detenerWebsockets(io: Server): Promise<void> {
  desregistrarServidorSocket();
  await io.close();
}
