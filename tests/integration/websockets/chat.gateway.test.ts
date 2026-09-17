/**
 * Handshake y salas del socket de chat (HU-5.2), contra un servidor de verdad.
 *
 * Va como test de INTEGRACIÓN y no unitario porque lo que se quiere verificar es
 * justamente lo que un mock taparía: que socket.io rechace la conexión antes de
 * establecerla, que el ack lleve el error con la forma de la API, y que un usuario no
 * pueda unirse a una sala en la que no participa. Es la parte de la HU con implicancia
 * de seguridad.
 *
 * Se mockea sólo el repository: el resto —autenticación, gateway, presencia y emisor— es
 * el código real. Así no hace falta base de datos.
 */
import type { Server as ServidorHttp } from 'node:http';
import { createServer } from 'node:http';
import type { Socket as ClienteSocket } from 'socket.io-client';
import { io as conectar } from 'socket.io-client';
import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../../src/config/env';
import { firmarToken } from '../../../src/shared/jwt';
import * as repo from '../../../src/modules/chats/chats.repository';
import { iniciarWebsockets } from '../../../src/websockets';
import { limpiarPresencia } from '../../../src/websockets/presencia';

vi.mock('../../../src/modules/chats/chats.repository');

const USUARIO = 7;
const OTRO = 41;
const CHAT = 8;

let servidorHttp: ServidorHttp;
let io: Server;
let url: string;

/** Clientes abiertos en el test actual, para cerrarlos aunque el test falle. */
const abiertos: ClienteSocket[] = [];

function token(usuarioId: number): string {
  return firmarToken({ usuarioId, roles: ['Adoptante'] });
}

/**
 * Token con vencimiento a medida.
 *
 * Va con `jwt.sign` directo y no con `firmarToken` porque la expiración de ése sale de
 * `env.JWT_EXPIRES_IN`, que se parsea UNA vez al importar `config/env`: pisar
 * `process.env` en runtime no la cambia. Acá lo que se prueba es qué hace el gateway con
 * un token vencido, no cómo se firma uno.
 */
function tokenQueVenceEn(usuarioId: number, segundos: number): string {
  return jwt.sign({ usuarioId, roles: ['Adoptante'] }, env.JWT_SECRET, {
    expiresIn: segundos,
  });
}

function cliente(auth: Record<string, unknown>): ClienteSocket {
  const socket = conectar(url, { auth, transports: ['websocket'], reconnection: false });
  abiertos.push(socket);
  return socket;
}

/** Espera un evento del socket, o falla el test por timeout en vez de colgarse. */
function esperar<T = unknown>(socket: ClienteSocket, evento: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(`No llegó "${evento}" en ${ms}ms`)), ms);

    socket.once(evento, (dato: T) => {
      clearTimeout(temporizador);
      resolve(dato);
    });
  });
}

beforeAll(async () => {
  servidorHttp = createServer();
  io = iniciarWebsockets(servidorHttp);

  await new Promise<void>((resolve) => servidorHttp.listen(0, resolve));

  const direccion = servidorHttp.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('No se pudo levantar el servidor de prueba');
  }
  url = `http://localhost:${direccion.port}`;
});

afterEach(() => {
  for (const socket of abiertos.splice(0)) socket.disconnect();
  limpiarPresencia();
  vi.resetAllMocks();
});

afterAll(async () => {
  await io.close();
  await new Promise<void>((resolve) => servidorHttp.close(() => resolve()));
});

describe('handshake', () => {
  it('sin token la conexión ni siquiera se establece', async () => {
    const socket = cliente({});

    const error = await esperar<Error>(socket, 'connect_error');

    expect(error.message).toBe('NO_AUTENTICADO');
    expect(socket.connected).toBe(false);
  });

  it('con un token inválido tampoco', async () => {
    const socket = cliente({ token: 'esto-no-es-un-jwt' });

    const error = await esperar<Error>(socket, 'connect_error');

    expect(error.message).toBe('NO_AUTENTICADO');
  });

  it('con un token válido conecta', async () => {
    const socket = cliente({ token: token(USUARIO) });

    await esperar(socket, 'connect');

    expect(socket.connected).toBe(true);
  });

  it('acepta el token con el prefijo Bearer, que es el error de tipeo probable', async () => {
    const socket = cliente({ token: `Bearer ${token(USUARIO)}` });

    await esperar(socket, 'connect');

    expect(socket.connected).toBe(true);
  });

  it('un token que vence con el socket abierto lo desconecta avisando', async () => {
    const socket = cliente({ token: tokenQueVenceEn(USUARIO, 1) });
    await esperar(socket, 'connect');

    // Los dos listeners se registran ANTES de esperar: el server emite y corta seguido, así
    // que enganchar el segundo después del primer await llega tarde.
    const aviso = esperar<{ error: { codigo: string; mensaje: string } }>(socket, 'chat:error');
    const desconexion = esperar(socket, 'disconnect');

    // Mismo formato que un error de REST: el cliente reusa su parser.
    expect((await aviso).error).toEqual({
      codigo: 'NO_AUTENTICADO',
      mensaje: 'Tu sesión expiró, volvé a iniciar sesión',
    });

    // Avisar sin cortar dejaría el socket vivo con una credencial vencida.
    await desconexion;
    expect(socket.connected).toBe(false);
  });
});

describe('chat:unirse', () => {
  it('un participante activo entra a la sala', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);

    const socket = cliente({ token: token(USUARIO) });
    await esperar(socket, 'connect');

    const respuesta = await socket.emitWithAck('chat:unirse', { chatId: CHAT });

    expect(respuesta).toEqual({ ok: true, datos: { chatId: CHAT } });
  });

  it('sin fila activa en UsuarioChat el ack trae el error, con la forma de la API', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    const socket = cliente({ token: token(USUARIO) });
    await esperar(socket, 'connect');

    const respuesta = await socket.emitWithAck('chat:unirse', { chatId: CHAT });

    expect(respuesta).toEqual({
      ok: false,
      error: { codigo: 'SIN_ACCESO_AL_CHAT', mensaje: 'No tenés acceso a esta conversación' },
    });
  });

  it('no se une a la sala cuando lo rechaza: no recibe los eventos', async () => {
    // El intruso es rechazado; el participante legítimo sí entra.
    vi.mocked(repo.buscarMembresiaActiva).mockImplementation((usuarioId: number) =>
      Promise.resolve(usuarioId === OTRO ? null : ({ id: 100 } as never)),
    );

    const intruso = cliente({ token: token(OTRO) });
    await esperar(intruso, 'connect');
    await intruso.emitWithAck('chat:unirse', { chatId: CHAT });

    const recibido = vi.fn();
    intruso.on('chat:presencia', recibido);

    // El participante entra y dispara un evento de presencia a la sala.
    const participante = cliente({ token: token(USUARIO) });
    await esperar(participante, 'connect');
    await participante.emitWithAck('chat:unirse', { chatId: CHAT });

    // Margen para que el evento hubiera llegado si el intruso estuviera en la sala.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(recibido).not.toHaveBeenCalled();
  });

  it('un chatId no numérico se rechaza sin consultar la base', async () => {
    const socket = cliente({ token: token(USUARIO) });
    await esperar(socket, 'connect');

    const respuesta = await socket.emitWithAck('chat:unirse', { chatId: 'hola' });

    expect(respuesta).toMatchObject({ ok: false, error: { codigo: 'VALIDACION' } });
    expect(repo.buscarMembresiaActiva).not.toHaveBeenCalled();
  });
});

describe('presencia', () => {
  it('quien ya está en la sala se entera de que el otro entró', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);

    const primero = cliente({ token: token(USUARIO) });
    await esperar(primero, 'connect');
    await primero.emitWithAck('chat:unirse', { chatId: CHAT });

    const aviso = esperar<{ chatId: number; usuarioId: number; enLinea: boolean }>(
      primero,
      'chat:presencia',
    );

    const segundo = cliente({ token: token(OTRO) });
    await esperar(segundo, 'connect');
    await segundo.emitWithAck('chat:unirse', { chatId: CHAT });

    expect(await aviso).toEqual({ chatId: CHAT, usuarioId: OTRO, enLinea: true });
  });

  it('al caer el último socket del contacto, la sala recibe enLinea false', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);

    const primero = cliente({ token: token(USUARIO) });
    await esperar(primero, 'connect');
    await primero.emitWithAck('chat:unirse', { chatId: CHAT });

    const segundo = cliente({ token: token(OTRO) });
    await esperar(segundo, 'connect');
    await segundo.emitWithAck('chat:unirse', { chatId: CHAT });

    const baja = esperar<{ usuarioId: number; enLinea: boolean }>(primero, 'chat:presencia');
    segundo.disconnect();

    expect(await baja).toEqual({ chatId: CHAT, usuarioId: OTRO, enLinea: false });
  });
});
