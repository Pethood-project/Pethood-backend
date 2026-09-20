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
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import * as storage from '../../../src/shared/storage';
import { LIMITES } from '../../../src/shared/validation/limits';
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
      solicitudId: null,
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
    imagenes: [],
    tipo: 'TEXTO' as const,
    solicitudId: null,
    usuarioId: OTRO,
    leido: false,
    fechaAlta,
    usuarioAlta: OTRO,
  };
}

/** Marca de lectura/entrega de un participante, como sale de `marcasDeParticipantes`. */
function marca(usuarioId: number, lectura: Date | null, entrega: Date | null = lectura) {
  return { usuarioId, ultimaLectura: lectura, ultimaEntrega: entrega };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);
  vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala() as never);
  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null } as never);
  vi.mocked(repo.listarMensajes).mockResolvedValue([] as never);
  vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([] as never);
  vi.mocked(repo.ultimoMensajeAjeno).mockResolvedValue({ fechaAlta: FECHA } as never);
  vi.mocked(repo.acusarHasta).mockResolvedValue(0);
  vi.mocked(repo.ultimosMensajesParaRespuesta).mockResolvedValue([] as never);
  vi.mocked(repo.buscarUltimaSolicitudDelChat).mockResolvedValue(null);
  vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(null as never);
  vi.mocked(storage.guardarImagenes).mockResolvedValue([URL_FOTO]);
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
    imagenes: [],
    tipo: 'TEXTO' as const,
    solicitudId: null,
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
      { usuarioId: USUARIO, chatId: CHAT, archivos: [ARCHIVO] },
    );

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ contenido: '', imagenes: [URL_FOTO] }),
    );
  });

  it('texto y foto juntos también: el modelo los admite', async () => {
    await service.enviarMensaje(
      { contenido: 'Mirá' },
      { usuarioId: USUARIO, chatId: CHAT, archivos: [ARCHIVO] },
    );

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ contenido: 'Mirá', imagenes: [URL_FOTO] }),
    );
  });

  it('varias fotos viajan en un solo mensaje, en orden', async () => {
    const urls = [URL_FOTO, '/api/v1/archivos/chats/def.jpg'];
    vi.mocked(storage.guardarImagenes).mockResolvedValue(urls);

    await service.enviarMensaje(
      { contenido: '' },
      { usuarioId: USUARIO, chatId: CHAT, archivos: [ARCHIVO, ARCHIVO] },
    );

    expect(repo.crearMensaje).toHaveBeenCalledWith(expect.objectContaining({ imagenes: urls }));
  });

  it('más fotos que el máximo se rechazan sin tocar el storage', async () => {
    const demasiadas = Array.from({ length: LIMITES.mensaje.fotos.maximo + 1 }, () => ARCHIVO);

    await expect(
      service.enviarMensaje(
        { contenido: '' },
        { usuarioId: USUARIO, chatId: CHAT, archivos: demasiadas },
      ),
    ).rejects.toMatchObject({ codigo: 'DEMASIADOS_ARCHIVOS', httpStatus: 400 });

    expect(storage.guardarImagenes).not.toHaveBeenCalled();
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
        { usuarioId: USUARIO, chatId: CHAT, archivos: [ARCHIVO] },
      ),
    ).rejects.toBeInstanceOf(AppError);

    expect(storage.guardarImagenes).not.toHaveBeenCalled();
  });

  it('si falla la escritura en base, borra la foto que ya había guardado', async () => {
    vi.mocked(repo.crearMensaje).mockRejectedValue(new Error('caída de base'));

    await expect(
      service.enviarMensaje(
        { contenido: '' },
        { usuarioId: USUARIO, chatId: CHAT, archivos: [ARCHIVO] },
      ),
    ).rejects.toThrow('caída de base');

    expect(storage.borrarImagenes).toHaveBeenCalledWith([URL_FOTO]);
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
    vi.mocked(repo.acusarHasta).mockResolvedValue(3);

    await expect(service.marcarLeidos(USUARIO, CHAT)).resolves.toEqual({
      chatId: CHAT,
      noLeidos: 0,
      marcados: 3,
    });
  });

  it('marca hasta el último mensaje ajeno, no hasta el reloj del servidor', async () => {
    await service.marcarLeidos(USUARIO, CHAT);

    expect(repo.acusarHasta).toHaveBeenCalledWith(CHAT, USUARIO, 'lectura', FECHA);
  });

  it('avisa a la sala y a los otros dispositivos de quien leyó', async () => {
    vi.mocked(repo.acusarHasta).mockResolvedValue(3);

    await service.marcarLeidos(USUARIO, CHAT);

    expect(emisor.emitirLeido).toHaveBeenCalledWith(CHAT, USUARIO, FECHA.toISOString());
    expect(emisor.emitirNoLeidos).toHaveBeenCalledWith(USUARIO, CHAT, 0);
  });

  it('reabrir una sala ya leída no despierta a nadie', async () => {
    vi.mocked(repo.acusarHasta).mockResolvedValue(0);

    const resultado = await service.marcarLeidos(USUARIO, CHAT);

    expect(resultado.marcados).toBe(0);
    expect(emisor.emitirLeido).not.toHaveBeenCalled();
    expect(emisor.emitirNoLeidos).not.toHaveBeenCalled();
  });

  it('una sala sin mensajes del otro no escribe nada', async () => {
    vi.mocked(repo.ultimoMensajeAjeno).mockResolvedValue(null);

    await expect(service.marcarLeidos(USUARIO, CHAT)).resolves.toEqual({
      chatId: CHAT,
      noLeidos: 0,
      marcados: 0,
    });

    expect(repo.acusarHasta).not.toHaveBeenCalled();
  });

  it('exige ser participante antes de escribir', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    await expect(service.marcarLeidos(USUARIO, CHAT)).rejects.toBeInstanceOf(AppError);

    expect(repo.acusarHasta).not.toHaveBeenCalled();
  });
});

describe('marcarEntregados — el segundo tilde', () => {
  it('acusa la entrega hasta el último mensaje ajeno y avisa a la sala', async () => {
    vi.mocked(repo.acusarHasta).mockResolvedValue(2);

    await expect(service.marcarEntregados(USUARIO, CHAT)).resolves.toEqual({
      chatId: CHAT,
      marcados: 2,
      hasta: FECHA.toISOString(),
    });

    expect(repo.acusarHasta).toHaveBeenCalledWith(CHAT, USUARIO, 'entrega', FECHA);
    expect(emisor.emitirEntregado).toHaveBeenCalledWith(CHAT, USUARIO, FECHA.toISOString());
  });

  it('reacusar lo ya entregado no despierta a nadie', async () => {
    vi.mocked(repo.acusarHasta).mockResolvedValue(0);

    await service.marcarEntregados(USUARIO, CHAT);

    expect(emisor.emitirEntregado).not.toHaveBeenCalled();
  });

  it('exige ser participante', async () => {
    vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue(null);

    await expect(service.marcarEntregados(USUARIO, CHAT)).rejects.toBeInstanceOf(AppError);

    expect(repo.acusarHasta).not.toHaveBeenCalled();
  });
});

describe('acuse de los mensajes del historial', () => {
  const ANTES = new Date('2026-09-01T14:00:00.000Z');
  const DESPUES = new Date('2026-09-01T14:10:00.000Z');

  beforeEach(() => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([
      { ...mensaje({ id: 1 }), usuarioId: USUARIO, fechaAlta: ANTES },
    ] as never);
  });

  it('sin marcas del otro, el mensaje no está ni entregado ni leído', async () => {
    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]).toMatchObject({ entregado: false, leido: false, fechaLectura: null });
  });

  it('entregado pero no leído: un solo tilde extra, sin hora de lectura', async () => {
    vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([
      marca(USUARIO, null, null),
      marca(OTRO, null, DESPUES),
    ] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]).toMatchObject({ entregado: true, leido: false, fechaLectura: null });
  });

  it('leído: doble tilde y la hora en que el otro leyó', async () => {
    vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([
      marca(USUARIO, null, null),
      marca(OTRO, DESPUES),
    ] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]).toMatchObject({
      entregado: true,
      leido: true,
      fechaLectura: DESPUES.toISOString(),
    });
  });

  it('una marca anterior al mensaje no lo alcanza', async () => {
    vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([
      marca(OTRO, new Date('2026-08-31T00:00:00.000Z')),
    ] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]!.leido).toBe(false);
  });

  it('la marca del propio autor no cuenta: leer lo que uno escribió no es acuse', async () => {
    vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([marca(USUARIO, DESPUES)] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]!.leido).toBe(false);
  });
});

describe('minutosRespuesta de la cabecera', () => {
  /** Mensajes en el orden en que los devuelve el repository: del más nuevo al más viejo. */
  function conversacion(...pares: [number, string][]) {
    return pares
      .map(([minuto, quien]) => ({
        usuarioId: quien === 'yo' ? USUARIO : OTRO,
        fechaAlta: new Date(FECHA.getTime() + minuto * 60_000),
      }))
      .reverse();
  }

  it('con una sola respuesta no se arriesga a estimar', async () => {
    vi.mocked(repo.ultimosMensajesParaRespuesta).mockResolvedValue(
      conversacion([0, 'yo'], [30, 'otro']) as never,
    );

    const cabecera = await service.obtenerCabecera(USUARIO, CHAT);

    expect(cabecera.minutosRespuesta).toBeNull();
  });

  it('toma la mediana de las demoras, así una respuesta al otro día no la corre', async () => {
    vi.mocked(repo.ultimosMensajesParaRespuesta).mockResolvedValue(
      conversacion(
        [0, 'yo'],
        [10, 'otro'],
        [100, 'yo'],
        [120, 'otro'],
        [200, 'yo'],
        [1_640, 'otro'],
      ) as never,
    );

    // Demoras de 10, 20 y 1440 minutos: la mediana es 20, el promedio sería 490.
    const cabecera = await service.obtenerCabecera(USUARIO, CHAT);

    expect(cabecera.minutosRespuesta).toBe(20);
  });

  it('varios mensajes seguidos míos cuentan como una sola espera', async () => {
    vi.mocked(repo.ultimosMensajesParaRespuesta).mockResolvedValue(
      conversacion([0, 'yo'], [5, 'yo'], [30, 'otro'], [60, 'yo'], [90, 'otro']) as never,
    );

    // La primera espera arranca en el minuto 0 y no en el 5: 30 y 30 → mediana 30.
    const cabecera = await service.obtenerCabecera(USUARIO, CHAT);

    expect(cabecera.minutosRespuesta).toBe(30);
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

describe('asegurarChatDeSolicitud — la sala que nace de una solicitud', () => {
  const SOLICITUD = 90;
  const SOLICITANTE = 41;
  const MIEMBRO_REFUGIO = 7;
  const CHAT_NUEVO = 300;

  /** Lo que devuelve `buscarSolicitudParaChat`. */
  function solicitud(opciones: { deRefugio?: boolean; duenio?: number } = {}) {
    const { deRefugio = true, duenio = 99 } = opciones;

    return {
      id: SOLICITUD,
      fechaAlta: FECHA,
      usuarioId: SOLICITANTE,
      tipoSolicitud: { nombre: 'Adopcion' },
      historicoEstados: [{ estadoSolicitud: { nombre: 'Pendiente' } }],
      publicacion: {
        id: 12,
        imagenUrl: '/api/v1/archivos/publicaciones/max.jpg',
        mascota: {
          id: 5,
          nombre: 'Max',
          fechaNacimiento: FECHA_VIEJA,
          imagenUrl: null,
          refugioId: deRefugio ? REFUGIO : null,
          usuarioId: duenio,
          raza: { especie: { nombre: 'Perro' } },
        },
      },
    };
  }

  beforeEach(() => {
    vi.mocked(repo.buscarMensajeDeSolicitud).mockResolvedValue(null);
    vi.mocked(repo.buscarChatEntre).mockResolvedValue(null);
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(solicitud() as never);
    vi.mocked(repo.listarMiembrosDeRefugio).mockResolvedValue([{ id: MIEMBRO_REFUGIO }] as never);
    vi.mocked(repo.crearChatDeSolicitud).mockResolvedValue({ id: CHAT_NUEVO } as never);
    vi.mocked(repo.crearMensaje).mockResolvedValue({
      ...mensaje({ id: 500, contenido: '' }),
      chatId: CHAT_NUEVO,
      usuarioId: USUARIO_SISTEMA_ID,
      tipo: 'SOLICITUD' as const,
      solicitudId: SOLICITUD,
    } as never);
  });

  it('crea la sala con el solicitante y los miembros del refugio', async () => {
    await expect(service.asegurarChatDeSolicitud(SOLICITUD)).resolves.toBe(CHAT_NUEVO);

    expect(repo.crearChatDeSolicitud).toHaveBeenCalledWith({
      solicitudId: SOLICITUD,
      refugioId: REFUGIO,
      participantesIds: [SOLICITANTE, MIEMBRO_REFUGIO],
      creadoPor: SOLICITANTE,
    });
  });

  it('si la mascota no es de un refugio, la contraparte es su dueño', async () => {
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(
      solicitud({ deRefugio: false, duenio: MIEMBRO_REFUGIO }) as never,
    );

    await service.asegurarChatDeSolicitud(SOLICITUD);

    expect(repo.listarMiembrosDeRefugio).not.toHaveBeenCalled();
    expect(repo.crearChatDeSolicitud).toHaveBeenCalledWith(
      expect.objectContaining({
        refugioId: null,
        participantesIds: [SOLICITANTE, MIEMBRO_REFUGIO],
      }),
    );
  });

  it('deja la tarjeta de la solicitud, emitida por SISTEMA', async () => {
    await service.asegurarChatDeSolicitud(SOLICITUD);

    expect(repo.crearMensaje).toHaveBeenCalledWith({
      chatId: CHAT_NUEVO,
      usuarioId: USUARIO_SISTEMA_ID,
      contenido: '',
      imagenes: [],
      tipo: 'SOLICITUD',
      solicitudId: SOLICITUD,
    });
  });

  it('el evento del mensaje nuevo lleva la tarjeta ya resuelta', async () => {
    await service.asegurarChatDeSolicitud(SOLICITUD);

    expect(emisor.emitirMensajeNuevo).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'SOLICITUD',
        solicitud: expect.objectContaining({
          id: SOLICITUD,
          tipo: 'Adopcion',
          estado: 'Pendiente',
          mascota: expect.objectContaining({ nombre: 'Max', especie: 'Perro' }),
        }),
      }),
      [SOLICITANTE, MIEMBRO_REFUGIO],
    );
  });

  it('una segunda solicitud al mismo refugio cae en la conversación que ya existía', async () => {
    vi.mocked(repo.buscarChatEntre).mockResolvedValue({ id: CHAT } as never);

    await expect(service.asegurarChatDeSolicitud(SOLICITUD)).resolves.toBe(CHAT);

    expect(repo.buscarChatEntre).toHaveBeenCalledWith(SOLICITANTE, { refugioId: REFUGIO });
    expect(repo.crearChatDeSolicitud).not.toHaveBeenCalled();
    // La tarjeta sí se deja, en la sala existente.
    expect(repo.crearMensaje).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT }));
  });

  it('con una persona del otro lado, la sala se reencuentra por los dos participantes', async () => {
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(
      solicitud({ deRefugio: false, duenio: MIEMBRO_REFUGIO }) as never,
    );

    await service.asegurarChatDeSolicitud(SOLICITUD);

    expect(repo.buscarChatEntre).toHaveBeenCalledWith(SOLICITANTE, { usuarioId: MIEMBRO_REFUGIO });
  });

  it('un reintento de la misma solicitud no deja dos tarjetas', async () => {
    vi.mocked(repo.buscarMensajeDeSolicitud).mockResolvedValue({ chatId: CHAT } as never);

    await expect(service.asegurarChatDeSolicitud(SOLICITUD)).resolves.toBe(CHAT);

    expect(repo.crearChatDeSolicitud).not.toHaveBeenCalled();
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('sin contraparte activa no hay conversación posible', async () => {
    vi.mocked(repo.listarMiembrosDeRefugio).mockResolvedValue([] as never);

    await expect(service.asegurarChatDeSolicitud(SOLICITUD)).resolves.toBeNull();

    expect(repo.crearChatDeSolicitud).not.toHaveBeenCalled();
  });

  it('una solicitud inexistente no rompe: devuelve null', async () => {
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(null as never);

    await expect(service.asegurarChatDeSolicitud(SOLICITUD)).resolves.toBeNull();
  });
});
