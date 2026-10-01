/**
 * HU-13.2 — la tarjeta de un aviso de mascota perdida en la conversación.
 *
 * Mismos mocks que `chats.mensajes.service.test.ts`: el repository, el storage y el emisor de
 * websockets, para que el service se pueda testear sin base, sin disco y sin sockets.
 *
 * Lo que se verifica acá es lo que define el diseño: que el reclamo **reuse** la conversación
 * que ya exista con esa persona en vez de abrir una segunda, que la tarjeta no se duplique, que
 * la emita SISTEMA, y que una sala con una solicitud y un aviso nombre el más reciente de los
 * dos en la cabecera.
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
const FECHA_VIEJA = new Date('2026-08-20T09:00:00.000Z');

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

/** Lo que devuelve `buscarSolicitudParaChat`, para la sala que tiene las dos tarjetas. */
function solicitud() {
  return {
    id: 90,
    fechaAlta: FECHA_VIEJA,
    usuarioId: RECLAMANTE,
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
        refugioId: null,
        usuarioId: REPORTANTE,
        raza: { especie: { nombre: 'Perro' } },
      },
    },
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
  vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue(null);
  // Por defecto, sin conversación previa entre las dos personas.
  vi.mocked(repo.buscarChatEntre).mockResolvedValue(null);
  vi.mocked(repo.buscarMensajeDeReclamo).mockResolvedValue(null);
  vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso() as never);
  vi.mocked(repo.crearChatDeReclamo).mockResolvedValue({ id: CHAT_NUEVO } as never);
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
  it('sin conversación previa, la abre entre las dos personas y sin refugio', async () => {
    const resultado = await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(resultado).toEqual({ chatId: CHAT_NUEVO, nueva: true });
    expect(repo.crearChatDeReclamo).toHaveBeenCalledWith({
      animalPerdidoId: AVISO,
      participantesIds: [RECLAMANTE, REPORTANTE],
      creadoPor: RECLAMANTE,
    });
  });

  it('con una conversación ya abierta con esa persona, deja la tarjeta ahí y no crea otra', async () => {
    // El caso que motivó el diseño: ya se escribían por una adopción.
    vi.mocked(repo.buscarChatEntre).mockResolvedValue({ id: CHAT } as never);

    const resultado = await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(resultado).toEqual({ chatId: CHAT, nueva: false });
    expect(repo.crearChatDeReclamo).not.toHaveBeenCalled();
    // La tarjeta sí: es lo que dice de qué aviso se está hablando.
    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT, tipo: 'ANIMAL_PERDIDO', animalPerdidoId: AVISO }),
    );
  });

  it('busca la conversación entre las partes, igual que una segunda solicitud', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(repo.buscarChatEntre).toHaveBeenCalledWith(RECLAMANTE, { usuarioId: REPORTANTE });
  });

  it('deja la tarjeta emitida por SISTEMA, no por el reclamante', async () => {
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

  it('el segundo reclamo del mismo aviso no repite la tarjeta', async () => {
    vi.mocked(repo.buscarChatEntre).mockResolvedValue({ id: CHAT } as never);
    vi.mocked(repo.buscarMensajeDeReclamo).mockResolvedValue({ chatId: CHAT } as never);

    const resultado = await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(resultado).toEqual({ chatId: CHAT, nueva: false });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
    expect(emisor.emitirMensajeNuevo).not.toHaveBeenCalled();
  });

  it('la idempotencia es por aviso Y por sala: otro reclamante deja su propia tarjeta', async () => {
    await service.asegurarChatDeReclamo(AVISO, RECLAMANTE, REPORTANTE);

    expect(repo.buscarMensajeDeReclamo).toHaveBeenCalledWith(AVISO, CHAT_NUEVO);
  });
});

describe('la cabecera de una sala con aviso', () => {
  it('trae el aviso de la última tarjeta y lo nombra como contexto', async () => {
    vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue({
      animalPerdidoId: AVISO,
      fechaAlta: FECHA,
    } as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.aviso).toMatchObject({ id: AVISO, estado: 'Perdido' });
    expect(cabecera.contexto).toBe('ANIMAL_PERDIDO');
  });

  it('una sala sin tarjetas no tiene contexto', async () => {
    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.aviso).toBeNull();
    expect(cabecera.solicitud).toBeNull();
    expect(cabecera.contexto).toBeNull();
  });

  it('con una solicitud y un aviso, gana el más reciente', async () => {
    // El caso que aparece al reusar la conversación: primero pidió adoptar, después reclamó.
    vi.mocked(repo.buscarUltimaSolicitudDelChat).mockResolvedValue({
      solicitudId: 90,
      fechaAlta: FECHA_VIEJA,
    } as never);
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(solicitud() as never);
    vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue({
      animalPerdidoId: AVISO,
      fechaAlta: FECHA,
    } as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    // Las dos viajan: el cliente las tiene si las necesita.
    expect(cabecera.solicitud).toMatchObject({ id: 90 });
    expect(cabecera.aviso).toMatchObject({ id: AVISO });
    expect(cabecera.contexto).toBe('ANIMAL_PERDIDO');
  });

  it('si la solicitud es la más reciente, el contexto es la solicitud', async () => {
    vi.mocked(repo.buscarUltimaSolicitudDelChat).mockResolvedValue({
      solicitudId: 90,
      fechaAlta: FECHA,
    } as never);
    vi.mocked(repo.buscarSolicitudParaChat).mockResolvedValue(solicitud() as never);
    vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue({
      animalPerdidoId: AVISO,
      fechaAlta: FECHA_VIEJA,
    } as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    expect(cabecera.contexto).toBe('SOLICITUD');
  });
});

describe('resolver un aviso no toca la conversación', () => {
  it('se puede seguir escribiendo en la sala de un aviso resuelto', async () => {
    // Decisión del equipo del 2026-10-01: "cierra el caso y el chat asociado" quedó en cerrar
    // sólo el caso. Con la sala compartida, cerrarla cortaría charlas ajenas al aviso.
    vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso({ estado: 'Resuelto' }) as never);
    vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue({
      animalPerdidoId: AVISO,
      fechaAlta: FECHA,
    } as never);
    vi.mocked(repo.crearMensaje).mockResolvedValue({
      id: 501,
      chatId: CHAT,
      contenido: 'Gracias por todo',
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
      { contenido: 'Gracias por todo' },
      { usuarioId: RECLAMANTE, chatId: CHAT },
    );

    expect(enviado.contenido).toBe('Gracias por todo');
    expect(enviado.aviso).toBeNull();
  });

  it('la cabecera de una sala con el aviso resuelto no la marca de ninguna forma especial', async () => {
    vi.mocked(repo.buscarAvisoParaChat).mockResolvedValue(aviso({ estado: 'Resuelto' }) as never);
    vi.mocked(repo.buscarUltimoAvisoDelChat).mockResolvedValue({
      animalPerdidoId: AVISO,
      fechaAlta: FECHA,
    } as never);

    const cabecera = await service.obtenerCabecera(RECLAMANTE, CHAT);

    // El estado del aviso se informa en la tarjeta; la conversación sigue siendo normal.
    expect(cabecera.aviso).toMatchObject({ estado: 'Resuelto' });
    expect(cabecera).not.toHaveProperty('soloLectura');
  });
});
