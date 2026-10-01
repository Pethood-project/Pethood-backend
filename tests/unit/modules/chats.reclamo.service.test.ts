/**
 * HU-13.2 — la sala de reencuentro de un aviso de animal perdido/encontrado.
 *
 * Mismos mocks que `chats.mensajes.service.test.ts`: el repository, el storage y el emisor de
 * websockets, para que el service se pueda testear sin base, sin disco y sin sockets.
 *
 * Lo que se verifica acá es lo que distingue esta sala de la de una solicitud: que sea por
 * aviso y por reclamante (y no entre las partes), que no se duplique, que la tarjeta la emita
 * SISTEMA, y que un aviso resuelto deje la conversación legible pero cerrada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/chats/chats.repository';
import * as service from '../../../src/modules/chats/chats.service';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import * as storage from '../../../src/shared/storage';
import * as emisor from '../../../src/websockets/emisor';
import * as presencia from '../../../src/websockets/presencia';

vi.mock('../../../src/modules/chats/chats.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/websockets/emisor');
vi.mock('../../../src/websockets/presencia');

const RECLAMANTE = 7;
const REPORTANTE = 41;
const AVISO = 12;
const CHAT = 8;
const CHAT_NUEVO = 300;

const FECHA = new Date('2026-09-01T14:05:00.000Z');

/** Lo que devuelve `buscarAvisoParaChat`. */
function aviso(opciones: { estado?: string; nombre?: string | null } = {}) {
  const { estado = 'Perdido', nombre = 'Michi' } = opciones;

  return {
    id: AVISO,
    nombre,
    descripcion: 'Gato gris, muy asustadizo',
    imagenUrl: '/api/v1/archivos/perdidos/michi.jpg',
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    referencia: 'Plaza departamental',
    fechaSuceso: new Date('2026-08-28T00:00:00.000Z'),
    fechaAlta: FECHA,
    fechaBaja: null,
    usuarioReportanteId: REPORTANTE,
    estadoAnimalPerdido: { id: 1, nombre: estado },
    especie: { nombre: 'Gato' },
  };
}

/** Fila de UsuarioChat con su chat, como sale de `buscarSalaConContacto`. */
function sala() {
  return {
    id: 100,
    chatId: CHAT,
    usuarioId: RECLAMANTE,
    chat: {
      id: CHAT,
      fechaAlta: FECHA,
      solicitudId: null,
      animalPerdidoId: AVISO,
      refugio: null,
      participantes: [
        {
          usuarioId: REPORTANTE,
          usuario: {
            id: REPORTANTE,
            nombre: 'Ana',
            apellido: 'Paz',
            imagenUrl: null,
            fechaBaja: null,
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);
  vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala() as never);
  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null } as never);
  vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([] as never);
  vi.mocked(repo.listarMensajes).mockResolvedValue([] as never);
  vi.mocked(repo.ultimosMensajesParaRespuesta).mockResolvedValue([] as never);
  vi.mocked(repo.buscarUltimaSolicitudDelChat).mockResolvedValue(null);
  vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(null as never);
  vi.mocked(repo.buscarChatDeReclamo).mockResolvedValue(null);
  vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso() as never);
  vi.mocked(repo.buscarAvisoDelChat).mockResolvedValue({ animalPerdidoId: AVISO } as never);
  vi.mocked(repo.crearChatDeReclamo).mockResolvedValue({ id: CHAT_NUEVO } as never);
  vi.mocked(repo.listarChatsDeAviso).mockResolvedValue([] as never);
  vi.mocked(repo.crearMensaje).mockResolvedValue({
    id: 500,
    chatId: CHAT_NUEVO,
    contenido: '',
    imagenUrl: null,
    imagenes: [],
    tipo: 'ANIMAL_PERDIDO' as const,
    solicitudId: null,
    animalPerdidoId: AVISO,
    usuarioId: USUARIO_SISTEMA_ID,
    leido: false,
    fechaAlta: FECHA,
    usuarioAlta: USUARIO_SISTEMA_ID,
  } as never);
  vi.mocked(storage.guardarImagenes).mockResolvedValue([]);
  vi.mocked(presencia.estaEnLinea).mockReturnValue(false);
});

describe('asegurarChatDeReclamo', () => {
  it('crea la sala entre el reclamante y el reportante, sin refugio', async () => {
    const resultado = await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(resultado).toEqual({ chatId: CHAT_NUEVO, nueva: true });
    expect(repo.crearChatDeReclamo).toHaveBeenCalledWith({
      animalPerdidoId: AVISO,
      participantesIds: [RECLAMANTE, REPORTANTE],
      creadoPor: RECLAMANTE,
    });
  });

  it('deja la tarjeta del aviso emitida por SISTEMA, no por el reclamante', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(repo.crearMensaje).toHaveBeenCalledWith({
      chatId: CHAT_NUEVO,
      usuarioId: USUARIO_SISTEMA_ID,
      contenido: '',
      imagenes: [],
      tipo: 'ANIMAL_PERDIDO',
      animalPerdidoId: AVISO,
    });
  });

  it('la tarjeta viaja por socket a los dos participantes, con el aviso resuelto adentro', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    const [mensaje, participantes] = vi.mocked(emisor.emitirMensajeNuevo).mock.calls[0]!;

    expect(participantes).toEqual([RECLAMANTE, REPORTANTE]);
    expect(mensaje.tipo).toBe('ANIMAL_PERDIDO');
    expect(mensaje.aviso).toMatchObject({
      id: AVISO,
      nombre: 'Michi',
      especie: 'Gato',
      estado: 'Perdido',
      // Mismo formato que el portal: «referencia, localidad - provincia».
      ubicacion: 'Plaza departamental, Godoy Cruz - Mendoza',
    });
  });

  it('la tarjeta no lleva coordenadas ni distancia', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    const [mensaje] = vi.mocked(emisor.emitirMensajeNuevo).mock.calls[0]!;

    expect(mensaje.aviso).not.toHaveProperty('latitud');
    expect(mensaje.aviso).not.toHaveProperty('longitud');
    expect(mensaje.aviso).not.toHaveProperty('distanciaKm');
  });

  it('el segundo reclamo reusa la sala y no duplica la tarjeta', async () => {
    vi.mocked(repo.buscarChatDeReclamo).mockResolvedValue({ id: CHAT } as never);

    const resultado = await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(resultado).toEqual({ chatId: CHAT, nueva: false });
    expect(repo.crearChatDeReclamo).not.toHaveBeenCalled();
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('busca la sala por aviso y reclamante, no la que ya exista entre las dos personas', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(repo.buscarChatDeReclamo).toHaveBeenCalledWith(AVISO, RECLAMANTE);
    // `buscarChatEntre` es la regla de las solicitudes ("la sala es entre las partes") y acá
    // no corresponde: cerrar una sala compartida cortaría una conversación ajena al aviso.
    expect(repo.buscarChatEntre).not.toHaveBeenCalled();
  });
});

describe('cerrarSalasDeAviso', () => {
  it('deja «Volvió con su dueño» en cada sala del aviso y no da de baja ninguna', async () => {
    vi.mocked(repo.listarChatsDeAviso).mockResolvedValue([
      { id: 11, participantes: [{ usuarioId: RECLAMANTE }, { usuarioId: REPORTANTE }] },
      { id: 22, participantes: [{ usuarioId: 99 }, { usuarioId: REPORTANTE }] },
    ] as never);

    expect(await service.cerrarSalasDeAviso(AVISO)).toBe(2);

    expect(repo.crearMensaje).toHaveBeenNthCalledWith(1, {
      chatId: 11,
      usuarioId: USUARIO_SISTEMA_ID,
      contenido: 'Volvió con su dueño',
      imagenes: [],
    });
    expect(repo.crearMensaje).toHaveBeenNthCalledWith(2, {
      chatId: 22,
      usuarioId: USUARIO_SISTEMA_ID,
      contenido: 'Volvió con su dueño',
      imagenes: [],
    });
    expect(emisor.emitirMensajeNuevo).toHaveBeenCalledTimes(2);
  });

  it('un aviso sin salas no es un error: nadie lo reclamó', async () => {
    expect(await service.cerrarSalasDeAviso(AVISO)).toBe(0);
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });
});

describe('la sala de un aviso resuelto queda en sólo lectura', () => {
  it('la cabecera lo dice y trae el aviso', async () => {
    vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso({ estado: 'Resuelto' }) as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.soloLectura).toBe(true);
    expect(cabecera.aviso).toMatchObject({ id: AVISO, estado: 'Resuelto' });
  });

  it('con el aviso abierto se puede escribir', async () => {
    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.soloLectura).toBe(false);
    expect(cabecera.aviso).toMatchObject({ id: AVISO, estado: 'Perdido' });
  });

  it('una sala que no es de reclamo nunca está en sólo lectura', async () => {
    vi.mocked(repo.buscarAvisoDelChat).mockResolvedValue({ animalPerdidoId: null } as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.soloLectura).toBe(false);
    expect(cabecera.aviso).toBeNull();
  });

  it('enviar un mensaje a una sala cerrada responde CHAT_CERRADO', async () => {
    vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso({ estado: 'Resuelto' }) as never);

    await expect(
      service.enviarMensaje({ contenido: 'Hola' }, { usuarioId: RECLAMANTE, chatId: CHAT }),
    ).rejects.toMatchObject({ codigo: 'CHAT_CERRADO', httpStatus: 409 });

    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('la sala cerrada se rechaza antes de tocar el storage', async () => {
    vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso({ estado: 'Resuelto' }) as never);

    await expect(
      service.enviarMensaje(
        { contenido: undefined },
        {
          usuarioId: RECLAMANTE,
          chatId: CHAT,
          archivos: [{ buffer: Buffer.from('foto'), mimetype: 'image/jpeg' }],
        },
      ),
    ).rejects.toMatchObject({ codigo: 'CHAT_CERRADO' });

    // Si se guardara primero, cada envío rechazado dejaría un archivo huérfano.
    expect(storage.guardarImagenes).not.toHaveBeenCalled();
  });

  it('con el aviso abierto el mensaje se envía', async () => {
    vi.mocked(repo.crearMensaje).mockResolvedValue({
      id: 501,
      chatId: CHAT,
      contenido: 'Hola',
      imagenUrl: null,
      imagenes: [],
      tipo: 'TEXTO' as const,
      solicitudId: null,
      animalPerdidoId: null,
      usuarioId: RECLAMANTE,
      leido: false,
      fechaAlta: FECHA,
      usuarioAlta: RECLAMANTE,
    } as never);

    const enviado = await service.enviarMensaje(
      { contenido: 'Hola' },
      { usuarioId: RECLAMANTE, chatId: CHAT },
    );

    expect(enviado.contenido).toBe('Hola');
    expect(enviado.aviso).toBeNull();
  });
});
