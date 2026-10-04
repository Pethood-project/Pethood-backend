/**
 * Seguridad (spec 004, regla 8): un usuario no puede ver ni modificar las notificaciones de
 * otro. Contra un servidor real (`notificacionesRouter` + `autenticar` real), con solo el
 * repository mockeado — mismo criterio que `tests/integration/middlewares/authYRoles.test.ts`.
 */
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { notificacionesRouter } from '../../../src/modules/notificaciones/notificaciones.routes';
import * as repo from '../../../src/modules/notificaciones/notificaciones.repository';
import { firmarToken } from '../../../src/shared/jwt';

vi.mock('../../../src/modules/notificaciones/notificaciones.repository');
vi.mock('../../../src/shared/colaNotificaciones');
vi.mock('../../../src/websockets/emisor');
vi.mock('../../../src/websockets/presencia');

const DUENIO = 7;
const OTRO_USUARIO = 99;
const NOTIFICACION_ID = 42;

let server: Server;
let baseUrl: string;

function token(usuarioId: number): string {
  return firmarToken({ usuarioId, roles: ['Adoptante'] });
}

function headers(usuarioId: number) {
  return { Authorization: `Bearer ${token(usuarioId)}`, 'X-Ambito': 'PERSONAL' };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/notificaciones', notificacionesRouter);
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo levantar el servidor de prueba');
  }
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('la notificación es del DUEÑO — nadie más la ve ni la toca', () => {
  it('marcarLeida de una notificación ajena responde 404, no 403 (no confirma que existe)', async () => {
    // El repository, filtrado por usuarioId, no encuentra nada para OTRO_USUARIO.
    vi.mocked(repo.buscarPropia).mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/notificaciones/${NOTIFICACION_ID}/leida`, {
      method: 'POST',
      headers: headers(OTRO_USUARIO),
    });
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(404);
    expect(body.error.codigo).toBe('NO_ENCONTRADA');
    expect(repo.buscarPropia).toHaveBeenCalledWith(OTRO_USUARIO, NOTIFICACION_ID);
    expect(repo.marcarLeida).not.toHaveBeenCalled();
  });

  it('el dueño sí puede marcarla como leída', async () => {
    vi.mocked(repo.buscarPropia).mockResolvedValue({ id: NOTIFICACION_ID } as never);
    vi.mocked(repo.contarNoLeidas).mockResolvedValue(0);

    const res = await fetch(`${baseUrl}/notificaciones/${NOTIFICACION_ID}/leida`, {
      method: 'POST',
      headers: headers(DUENIO),
    });

    expect(res.status).toBe(204);
    expect(repo.marcarLeida).toHaveBeenCalledWith(NOTIFICACION_ID, DUENIO);
  });

  it('eliminar (baja lógica) una notificación ajena responde 404', async () => {
    vi.mocked(repo.buscarPropia).mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/notificaciones/${NOTIFICACION_ID}`, {
      method: 'DELETE',
      headers: headers(OTRO_USUARIO),
    });
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(404);
    expect(body.error.codigo).toBe('NO_ENCONTRADA');
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });

  it('el listado siempre pide las filas filtradas por el usuario autenticado, nunca por uno de la URL/body', async () => {
    vi.mocked(repo.listarDeUsuario).mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/notificaciones`, { headers: headers(OTRO_USUARIO) });
    expect(res.status).toBe(200);

    expect(repo.listarDeUsuario).toHaveBeenCalledWith(OTRO_USUARIO, expect.any(Number), undefined);
  });

  it('sin token, cualquier ruta de la bandeja responde 401', async () => {
    const res = await fetch(`${baseUrl}/notificaciones`);
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(401);
    expect(body.error.codigo).toBe('NO_AUTENTICADO');
  });
});
