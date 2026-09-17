import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/chats/chats.repository';
import * as service from '../../../src/modules/chats/chats.service';

vi.mock('../../../src/modules/chats/chats.repository');

const USUARIO = 7;
const OTRO = 41;
const REFUGIO = 3;

const RECIENTE = new Date('2026-09-01T14:05:00.000Z');
const VIEJA = new Date('2026-08-20T09:00:00.000Z');
const CREACION = new Date('2026-08-01T08:00:00.000Z');

/** Participante del otro lado, tal como lo devuelve el repository (ya filtrado). */
function participante(opciones: { id?: number; fechaBaja?: Date | null } = {}) {
  const { id = OTRO, fechaBaja = null } = opciones;

  return {
    usuario: {
      id,
      nombre: 'Ana',
      apellido: 'Pérez',
      imagenUrl: '/api/v1/archivos/usuarios/ana.jpg',
      fechaBaja,
    },
  };
}

function refugio(opciones: { id?: number; fechaBaja?: Date | null } = {}) {
  const { id = REFUGIO, fechaBaja = null } = opciones;

  return {
    id,
    nombre: 'Refugio Patitas',
    imagenUrl: '/api/v1/archivos/refugios/patitas.jpg',
    fechaBaja,
  };
}

/** Fila de UsuarioChat con su chat, como sale de `listarChatsActivosDeUsuario`. */
function membresia(opciones: {
  chatId: number;
  fechaAlta?: Date;
  refugio?: ReturnType<typeof refugio> | null;
  participantes?: ReturnType<typeof participante>[];
}) {
  const {
    chatId,
    fechaAlta = CREACION,
    refugio: refugioDelChat = null,
    participantes = [participante()],
  } = opciones;

  return {
    id: chatId * 100,
    chatId,
    usuarioId: USUARIO,
    chat: { id: chatId, fechaAlta, refugio: refugioDelChat, participantes },
  };
}

function ultimoMensaje(opciones: {
  chatId: number;
  fechaAlta: Date;
  usuarioId?: number;
  contenido?: string;
  imagenUrl?: string | null;
}) {
  const {
    chatId,
    fechaAlta,
    usuarioId = OTRO,
    contenido = 'Dale, te espero el sábado a las 10',
    imagenUrl = null,
  } = opciones;

  return { chatId, contenido, usuarioId, imagenUrl, fechaAlta };
}

function conteo(chatId: number, cantidad: number) {
  return { chatId, _count: { _all: cantidad } };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null } as never);
  vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([] as never);
  vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([] as never);
  vi.mocked(repo.contarNoLeidosPorChat).mockResolvedValue([] as never);
});

describe('listarConversaciones — lista vacía', () => {
  it('un usuario sin conversaciones recibe total 0, no un error', async () => {
    await expect(service.listarConversaciones(USUARIO)).resolves.toEqual({ total: 0, chats: [] });
  });

  it('sin chats no consulta mensajes: se ahorra las dos queries', async () => {
    await service.listarConversaciones(USUARIO);

    expect(repo.ultimoMensajePorChat).not.toHaveBeenCalled();
    expect(repo.contarNoLeidosPorChat).not.toHaveBeenCalled();
  });
});

describe('listarConversaciones — orden', () => {
  it('ordena por fecha del último mensaje descendente', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      membresia({ chatId: 2 }),
    ] as never);
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({ chatId: 1, fechaAlta: VIEJA }),
      ultimoMensaje({ chatId: 2, fechaAlta: RECIENTE }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats.map((chat) => chat.chatId)).toEqual([2, 1]);
  });

  it('una sala sin mensajes se ordena por su fecha de creación', async () => {
    const creacionNueva = new Date('2026-08-25T12:00:00.000Z');

    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      membresia({ chatId: 2, fechaAlta: creacionNueva }),
    ] as never);
    // Sólo el chat 1 tiene mensajes, y son más viejos que la creación del chat 2.
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({ chatId: 1, fechaAlta: VIEJA }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats.map((chat) => chat.chatId)).toEqual([2, 1]);
    expect(chats[0]!.fechaUltimaActividad).toBe(creacionNueva.toISOString());
  });

  it('no consulta la base una vez por chat', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      membresia({ chatId: 2 }),
      membresia({ chatId: 3 }),
    ] as never);

    await service.listarConversaciones(USUARIO);

    expect(repo.ultimoMensajePorChat).toHaveBeenCalledTimes(1);
    expect(repo.ultimoMensajePorChat).toHaveBeenCalledWith([1, 2, 3]);
    expect(repo.contarNoLeidosPorChat).toHaveBeenCalledTimes(1);
    expect(repo.contarNoLeidosPorChat).toHaveBeenCalledWith(USUARIO, [1, 2, 3]);
  });
});

describe('listarConversaciones — chats sin mensajes', () => {
  it('aparecen en el listado con ultimoMensaje en null', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
    ] as never);

    const { total, chats } = await service.listarConversaciones(USUARIO);

    expect(total).toBe(1);
    expect(chats[0]).toMatchObject({
      chatId: 1,
      ultimoMensaje: null,
      noLeidos: 0,
      fechaUltimaActividad: CREACION.toISOString(),
    });
  });
});

describe('listarConversaciones — vista previa del último mensaje', () => {
  it('devuelve el contenido sin truncar y la fecha en ISO crudo', async () => {
    const largo = 'a'.repeat(300);

    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
    ] as never);
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({ chatId: 1, fechaAlta: RECIENTE, contenido: largo }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.ultimoMensaje).toEqual({
      contenido: largo,
      fecha: '2026-09-01T14:05:00.000Z',
      esMio: false,
      tieneImagen: false,
    });
  });

  it('marca esMio cuando el último mensaje lo mandó el usuario autenticado', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
    ] as never);
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({ chatId: 1, fechaAlta: RECIENTE, usuarioId: USUARIO }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.ultimoMensaje!.esMio).toBe(true);
  });

  it('avisa que el mensaje trae imagen, para que el preview no quede vacío', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
    ] as never);
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({
        chatId: 1,
        fechaAlta: RECIENTE,
        contenido: '',
        imagenUrl: '/api/v1/archivos/mensajes/foto.jpg',
      }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.ultimoMensaje).toMatchObject({ contenido: '', tieneImagen: true });
  });
});

describe('listarConversaciones — no leídos', () => {
  it('toma el conteo del repository y completa con 0 los chats que no vienen', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      membresia({ chatId: 2 }),
    ] as never);
    vi.mocked(repo.ultimoMensajePorChat).mockResolvedValue([
      ultimoMensaje({ chatId: 1, fechaAlta: RECIENTE }),
      ultimoMensaje({ chatId: 2, fechaAlta: VIEJA }),
    ] as never);
    vi.mocked(repo.contarNoLeidosPorChat).mockResolvedValue([conteo(1, 3)] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.noLeidos).toBe(3);
    expect(chats[1]!.noLeidos).toBe(0);
  });
});

describe('listarConversaciones — resolución del contacto', () => {
  it('un adoptante ve al REFUGIO, con su nombre e imagen', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, refugio: refugio() }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.contacto).toEqual({
      tipo: 'REFUGIO',
      id: REFUGIO,
      nombre: 'Refugio Patitas',
      imagenUrl: '/api/v1/archivos/refugios/patitas.jpg',
      activo: true,
    });
  });

  it('un miembro del refugio ve al ADOPTANTE, no a su propio refugio', async () => {
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: REFUGIO } as never);
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, refugio: refugio() }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.contacto).toMatchObject({ tipo: 'USUARIO', id: OTRO, nombre: 'Ana Pérez' });
  });

  it('un miembro de OTRO refugio sí ve al refugio de la sala', async () => {
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: 99 } as never);
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, refugio: refugio() }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.contacto.tipo).toBe('REFUGIO');
  });

  it('un chat sin refugio (mascota perdida) resuelve al otro adoptante', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, refugio: null }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.contacto).toEqual({
      tipo: 'USUARIO',
      id: OTRO,
      nombre: 'Ana Pérez',
      imagenUrl: '/api/v1/archivos/usuarios/ana.jpg',
      activo: true,
    });
  });
});

describe('listarConversaciones — contraparte dada de baja', () => {
  it('el chat se sigue mostrando, con el contacto marcado como inactivo', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, participantes: [participante({ fechaBaja: VIEJA })] }),
    ] as never);

    const { total, chats } = await service.listarConversaciones(USUARIO);

    expect(total).toBe(1);
    // Se conserva el nombre real: el backend manda el hecho, el placeholder lo pone la UI.
    expect(chats[0]!.contacto).toMatchObject({ nombre: 'Ana Pérez', activo: false });
  });

  it('lo mismo para un refugio dado de baja', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1, refugio: refugio({ fechaBaja: VIEJA }) }),
    ] as never);

    const { chats } = await service.listarConversaciones(USUARIO);

    expect(chats[0]!.contacto).toMatchObject({ tipo: 'REFUGIO', activo: false });
  });

  it('un chat sin ningún participante activo se omite y el total lo descuenta', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      // Sacaron al otro de la sala: el repository no devuelve participantes y la fila no se
      // puede pintar.
      membresia({ chatId: 2, participantes: [] }),
    ] as never);

    const { total, chats } = await service.listarConversaciones(USUARIO);

    expect(chats).toHaveLength(1);
    expect(chats[0]!.chatId).toBe(1);
    expect(total).toBe(1);
  });
});

describe('listarConversaciones — total', () => {
  it('el total nunca discrepa del listado', async () => {
    vi.mocked(repo.listarChatsActivosDeUsuario).mockResolvedValue([
      membresia({ chatId: 1 }),
      membresia({ chatId: 2 }),
      membresia({ chatId: 3, participantes: [] }),
    ] as never);

    const { total, chats } = await service.listarConversaciones(USUARIO);

    expect(total).toBe(chats.length);
    expect(total).toBe(2);
  });
});
