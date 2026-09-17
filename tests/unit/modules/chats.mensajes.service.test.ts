/**
 * HU-5.2 — sala de conversación. El listado (HU-5.1) se testea en `chats.service.test.ts`.
 *
 * Se mockean el repository (regla de capas del proyecto), el storage y el emisor de
 * websockets: el service tiene que poder testearse sin base, sin disco y sin levantar un
 * servidor de sockets. Que eso sea posible es justamente lo que valida el diseño del
 * `emisor` como capa fina.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/chats/chats.repository';
import * as service from '../../../src/modules/chats/chats.service';
import * as storage from '../../../src/shared/storage';
import * as emisor from '../../../src/websockets/emisor';
import * as presencia from '../../../src/websockets/presencia';

vi.mock('../../../src/modules/chats/chats.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/websockets/emisor');
vi.mock('../../../src/websockets/presencia');

const USUARIO = 7;
const OTRO = 41;
const REFUGIO = 3;
const CHAT = 8;

const FECHA = new Date('2026-09-01T14:05:00.000Z');
const FECHA_VIEJA = new Date('2026-08-20T09:00:00.000Z');

const ARCHIVO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };
const URL_FOTO = '/api/v1/archivos/chats/abc.jpg';

/** Fila de UsuarioChat con su chat, como sale de `buscarSalaConContacto`. */
function sala(
  opciones: {
    conRefugio?: boolean;
    contactoDeBaja?: boolean;
    sinContraparte?: boolean;
  } = {},
) {
  const { conRefugio = false, contactoDeBaja = false, sinContraparte = false } = opciones;

  return {
    id: 100,
    chatId: CHAT,
    usuarioId: USUARIO,
    chat: {
      id: CHAT,
      fechaAlta: FECHA_VIEJA,
      refugio: conRefugio
        ? {
            id: REFUGIO,
            nombre: 'Refugio Patitas',
            imagenUrl: null,
            fechaBaja: contactoDeBaja ? FECHA : null,
          }
        : null,
      participantes: sinContraparte
        ? []
        : [
            {
              usuarioId: OTRO,
              usuario: {
                id: OTRO,
                nombre: 'Ana',
                apellido: 'Pérez',
                imagenUrl: null,
                fechaBaja: contactoDeBaja ? FECHA : null,
              },
            },
          ],
    },
  };
}

function mensaje(opciones: { id: number; fechaAlta?: Date; contenido?: string } & object) {
  const { id, fechaAlta = FECHA, contenido = 'Hola' } = opciones;

  return {
    id,
    chatId: CHAT,
    contenido,
    imagenUrl: null,
    usuarioId: OTRO,
    leido: false,
    fechaAlta,
    usuarioAlta: OTRO,
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);
  vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala() as never);
  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null } as never);
  vi.mocked(repo.listarMensajes).mockResolvedValue([] as never);
  vi.mocked(repo.marcarMensajesLeidos).mockResolvedValue(0);
  vi.mocked(storage.guardarImagen).mockResolvedValue(URL_FOTO);
  vi.mocked(presencia.estaEnLinea).mockReturnValue(false);
});

describe('exigirParticipante — autorización', () => {
  it('sin fila activa en UsuarioChat corta con 403', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    await expect(service.exigirParticipante(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'SIN_ACCESO_AL_CHAT',
      httpStatus: 403,
    });
  });

  it('con fila activa deja pasar', async () => {
    await expect(service.exigirParticipante(USUARIO, CHAT)).resolves.toBeUndefined();
  });
});

describe('listarHistorial', () => {
  it('exige ser participante antes de leer un solo mensaje', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    await expect(service.listarHistorial(USUARIO, CHAT, { limite: 30 })).rejects.toBeInstanceOf(
      AppError,
    );

    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  it('devuelve los mensajes del más reciente al más viejo, con la fecha en ISO crudo', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([
      mensaje({ id: 3, fechaAlta: FECHA }),
      mensaje({ id: 2, fechaAlta: FECHA_VIEJA }),
    ] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes.map((m) => m.id)).toEqual([3, 2]);
    expect(mensajes[0]?.fechaAlta).toBe('2026-09-01T14:05:00.000Z');
  });

  it('no devuelve esMio: manda usuarioId y el cliente compara', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([mensaje({ id: 3 })] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]).not.toHaveProperty('esMio');
    expect(mensajes[0]?.usuarioId).toBe(OTRO);
  });

  it('con menos filas que el límite no hay página siguiente', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([mensaje({ id: 3 })] as never);

    const resultado = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(resultado.hayMas).toBe(false);
    expect(resultado.proximoCursor).toBeNull();
  });

  it('la fila extra del límite+1 marca que hay más, pero no se devuelve', async () => {
    // El repository trae limite + 1 = 3 filas para un límite de 2.
    vi.mocked(repo.listarMensajes).mockResolvedValue([
      mensaje({ id: 5 }),
      mensaje({ id: 4 }),
      mensaje({ id: 3 }),
    ] as never);

    const resultado = await service.listarHistorial(USUARIO, CHAT, { limite: 2 });

    expect(resultado.mensajes.map((m) => m.id)).toEqual([5, 4]);
    expect(resultado.hayMas).toBe(true);
    // El cursor es el último DEVUELTO, no la fila sobrante.
    expect(resultado.proximoCursor).toBe(4);
  });

  it('rechaza un cursor que no pertenece a la sala', async () => {
    vi.mocked(repo.buscarMensajeDeChat).mockResolvedValue(null);

    await expect(
      service.listarHistorial(USUARIO, CHAT, { limite: 30, antesDe: 999 }),
    ).rejects.toMatchObject({ codigo: 'CURSOR_INVALIDO', httpStatus: 400 });

    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  it('sin cursor no verifica nada y pide la primera página', async () => {
    await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(repo.buscarMensajeDeChat).not.toHaveBeenCalled();
    expect(repo.listarMensajes).toHaveBeenCalledWith(CHAT, 30, undefined);
  });
});

describe('enviarMensaje', () => {
  const enviado = {
    id: 55,
    chatId: CHAT,
    contenido: 'Hola',
    imagenUrl: null,
    usuarioId: USUARIO,
    leido: false,
    fechaAlta: FECHA,
  };

  beforeEach(() => {
    vi.mocked(repo.crearMensaje).mockResolvedValue(enviado as never);
  });

  it('un mensaje sin texto ni foto se rechaza', async () => {
    await expect(
      service.enviarMensaje({ contenido: '' }, { usuarioId: USUARIO, chatId: CHAT }),
    ).rejects.toMatchObject({ codigo: 'MENSAJE_VACIO', httpStatus: 400 });

    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('sólo foto, sin texto, es un mensaje válido', async () => {
    await service.enviarMensaje(
      { contenido: '' },
      { usuarioId: USUARIO, chatId: CHAT, archivo: ARCHIVO },
    );

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ contenido: '', imagenUrl: URL_FOTO }),
    );
  });

  it('texto y foto juntos también: el modelo los admite', async () => {
    await service.enviarMensaje(
      { contenido: 'Mirá' },
      { usuarioId: USUARIO, chatId: CHAT, archivo: ARCHIVO },
    );

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ contenido: 'Mirá', imagenUrl: URL_FOTO }),
    );
  });

  it('no se le puede escribir a un contacto dado de baja', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(
      sala({ contactoDeBaja: true }) as never,
    );

    await expect(
      service.enviarMensaje({ contenido: 'Hola' }, { usuarioId: USUARIO, chatId: CHAT }),
    ).rejects.toMatchObject({ codigo: 'CONTACTO_INACTIVO', httpStatus: 409 });

    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('valida antes de tocar el storage: un rechazo no deja la foto guardada', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(
      sala({ contactoDeBaja: true }) as never,
    );

    await expect(
      service.enviarMensaje(
        { contenido: 'Hola' },
        { usuarioId: USUARIO, chatId: CHAT, archivo: ARCHIVO },
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(storage.guardarImagen).not.toHaveBeenCalled();
  });

  it('si falla la escritura en base, borra la foto que ya había guardado', async () => {
    vi.mocked(repo.crearMensaje).mockRejectedValue(new Error('caída de base'));

    await expect(
      service.enviarMensaje(
        { contenido: '' },
        { usuarioId: USUARIO, chatId: CHAT, archivo: ARCHIVO },
      ),
    ).rejects.toThrow('caída de base');

    expect(storage.borrarImagen).toHaveBeenCalledWith(URL_FOTO);
  });

  it('emite a TODOS los participantes, incluido el emisor', async () => {
    await service.enviarMensaje({ contenido: 'Hola' }, { usuarioId: USUARIO, chatId: CHAT });

    expect(emisor.emitirMensajeNuevo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 55, chatId: CHAT }),
      // El emisor va incluido a propósito: sincroniza sus otros dispositivos.
      expect.arrayContaining([USUARIO, OTRO]),
    );
  });

  it('el mensaje emitido tiene la misma forma que el del historial', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([enviado] as never);

    await service.enviarMensaje({ contenido: 'Hola' }, { usuarioId: USUARIO, chatId: CHAT });
    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    const emitido = vi.mocked(emisor.emitirMensajeNuevo).mock.calls[0]?.[0];

    expect(Object.keys(emitido ?? {}).sort()).toEqual(Object.keys(mensajes[0] ?? {}).sort());
  });

  it('persiste antes de emitir: el evento nunca sale de un mensaje que no está en base', async () => {
    vi.mocked(repo.crearMensaje).mockRejectedValue(new Error('caída de base'));

    await expect(
      service.enviarMensaje({ contenido: 'Hola' }, { usuarioId: USUARIO, chatId: CHAT }),
    ).rejects.toThrow();

    expect(emisor.emitirMensajeNuevo).not.toHaveBeenCalled();
  });
});

describe('marcarLeidos', () => {
  it('devuelve el contador en cero para que HU-5.1 actualice el badge sin refetch', async () => {
    vi.mocked(repo.marcarMensajesLeidos).mockResolvedValue(3);

    await expect(service.marcarLeidos(USUARIO, CHAT)).resolves.toEqual({
      chatId: CHAT,
      noLeidos: 0,
      marcados: 3,
    });
  });

  it('avisa a la sala y a los otros dispositivos de quien leyó', async () => {
    vi.mocked(repo.marcarMensajesLeidos).mockResolvedValue(3);

    await service.marcarLeidos(USUARIO, CHAT);

    expect(emisor.emitirLeido).toHaveBeenCalledWith(CHAT, USUARIO);
    expect(emisor.emitirNoLeidos).toHaveBeenCalledWith(USUARIO, CHAT, 0);
  });

  it('reabrir una sala ya leída no despierta a nadie', async () => {
    vi.mocked(repo.marcarMensajesLeidos).mockResolvedValue(0);

    const resultado = await service.marcarLeidos(USUARIO, CHAT);

    expect(resultado.marcados).toBe(0);
    expect(emisor.emitirLeido).not.toHaveBeenCalled();
    expect(emisor.emitirNoLeidos).not.toHaveBeenCalled();
  });

  it('exige ser participante antes de escribir', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    await expect(service.marcarLeidos(USUARIO, CHAT)).rejects.toBeInstanceOf(AppError);

    expect(repo.marcarMensajesLeidos).not.toHaveBeenCalled();
  });
});

describe('obtenerCabecera', () => {
  it('resuelve el contacto igual que el listado', async () => {
    const { contacto } = await service.obtenerCabecera(USUARIO, CHAT);

    expect(contacto).toEqual({
      tipo: 'USUARIO',
      id: OTRO,
      nombre: 'Ana Pérez',
      imagenUrl: null,
      activo: true,
    });
  });

  it('toma la presencia del registro en memoria', async () => {
    vi.mocked(presencia.estaEnLinea).mockReturnValue(true);

    const cabecera = await service.obtenerCabecera(USUARIO, CHAT);

    expect(cabecera.enLinea).toBe(true);
    expect(presencia.estaEnLinea).toHaveBeenCalledWith(OTRO);
  });

  it('un refugio nunca figura en línea: es una institución, no una sesión', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala({ conRefugio: true }) as never);
    vi.mocked(presencia.estaEnLinea).mockReturnValue(true);

    const cabecera = await service.obtenerCabecera(USUARIO, CHAT);

    expect(cabecera.contacto.tipo).toBe('REFUGIO');
    expect(cabecera.enLinea).toBe(false);
  });

  it('una sala sin contraparte activa no se puede pintar: 404', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(
      sala({ sinContraparte: true }) as never,
    );

    await expect(service.obtenerCabecera(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'CHAT_SIN_CONTACTO',
      httpStatus: 404,
    });
  });

  it('un chat ajeno da 403, no la cabecera', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(null);

    await expect(service.obtenerCabecera(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'SIN_ACCESO_AL_CHAT',
      httpStatus: 403,
    });
  });
});
