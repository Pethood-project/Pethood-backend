import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/favoritos/favoritos.repository';
import * as service from '../../../src/modules/favoritos/favoritos.service';

vi.mock('../../../src/modules/favoritos/favoritos.repository');

const USUARIO = 7;
const DUENIO = 99;
const MASCOTA = 42;

const FECHA_AGREGADO = new Date('2026-08-19T15:00:00.000Z');

function mascotaActiva(usuarioId = DUENIO, refugioId: number | null = null) {
  return { id: MASCOTA, usuarioId, refugioId, fechaBaja: null };
}

function favorito(id = 1, fechaAlta = FECHA_AGREGADO) {
  return { id, usuarioId: USUARIO, mascotaId: MASCOTA, fechaAlta };
}

/**
 * Fila del listado tal como la devuelve el repository, con la mascota, su estado y la
 * publicación activa (`take: 1`, por eso el arreglo tiene a lo sumo un elemento).
 */
function favoritoConMascota(opciones: {
  id: number;
  mascotaId: number;
  fechaAlta: Date;
  estado?: { id: number; nombre: string };
  fechaNacimiento?: Date | null;
  /** Sin publicación viva la mascota ya no se puede solicitar. */
  publicacionId?: number | null;
  /** Solicitud viva del usuario sobre esa publicación, si la tiene. */
  solicitudId?: number | null;
}) {
  const {
    id,
    mascotaId,
    fechaAlta,
    estado,
    fechaNacimiento = new Date(2022, 2, 15),
    publicacionId = 5,
    solicitudId = null,
  } = opciones;

  return {
    id,
    usuarioId: USUARIO,
    mascotaId,
    fechaAlta,
    mascota: {
      id: mascotaId,
      nombre: 'Fido',
      fechaNacimiento,
      imagenUrl: '/api/v1/archivos/mascotas/x.jpg',
      raza: { id: 2, nombre: 'Labrador', especie: { id: 1, nombre: 'Perro' } },
      historicoEstados: estado ? [{ estadoMascota: estado }] : [],
      publicaciones:
        publicacionId === null
          ? []
          : [
              {
                id: publicacionId,
                solicitudes: solicitudId === null ? [] : [{ id: solicitudId }],
              },
            ],
    },
  };
}

function errorDuplicado() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(mascotaActiva() as never);
  vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);
  vi.mocked(repo.buscarPublicacionActiva).mockResolvedValue({ id: 5 } as never);
  vi.mocked(repo.buscarActivo).mockResolvedValue(null as never);
  vi.mocked(repo.crear).mockResolvedValue(favorito() as never);
});

describe('agregarFavorito', () => {
  it('guarda la mascota y avisa que es nueva', async () => {
    const resultado = await service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL');

    expect(resultado.yaEstaba).toBe(false);
    expect(resultado.favorito).toEqual({
      id: 1,
      mascotaId: MASCOTA,
      fechaAgregado: FECHA_AGREGADO.toISOString(),
    });
    expect(repo.crear).toHaveBeenCalledWith(USUARIO, MASCOTA);
  });

  it('rechaza una mascota que no existe', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(null as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('rechaza guardar una mascota propia', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(mascotaActiva(USUARIO) as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toMatchObject({
      codigo: 'MASCOTA_PROPIA',
      httpStatus: 403,
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('en ámbito REFUGIO rechaza guardar una mascota del propio refugio, aunque la haya cargado otro miembro', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(mascotaActiva(DUENIO, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'REFUGIO')).rejects.toMatchObject({
      codigo: 'MASCOTA_PROPIA',
      httpStatus: 403,
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('en ámbito PERSONAL sí puede guardar una mascota de su propio refugio: el switch hace de cuenta que es un adoptante más', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(mascotaActiva(DUENIO, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).resolves.toMatchObject({
      yaEstaba: false,
    });
  });

  it('permite guardar una mascota de refugio si el usuario pertenece a otro refugio', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(mascotaActiva(DUENIO, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 2 } as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'REFUGIO')).resolves.toMatchObject({
      yaEstaba: false,
    });
  });

  it('rechaza si el usuario no existe', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('rechaza una mascota sin publicación activa', async () => {
    vi.mocked(repo.buscarPublicacionActiva).mockResolvedValue(null as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toMatchObject({
      codigo: 'SIN_PUBLICACION',
      httpStatus: 409,
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('es idempotente: si ya estaba guardada no inserta de nuevo', async () => {
    vi.mocked(repo.buscarActivo).mockResolvedValue(favorito(3) as never);

    const resultado = await service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL');

    expect(resultado.yaEstaba).toBe(true);
    expect(resultado.favorito.id).toBe(3);
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('resuelve la carrera de dos swipes simultáneos sin propagar el error', async () => {
    // El findFirst inicial no ve nada, pero otro request inserta antes que este.
    vi.mocked(repo.buscarActivo)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(favorito(8) as never);
    vi.mocked(repo.crear).mockRejectedValue(errorDuplicado());

    const resultado = await service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL');

    expect(resultado.yaEstaba).toBe(true);
    expect(resultado.favorito.id).toBe(8);
  });

  it('propaga un error de base que no sea el de duplicado', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('se cayó la base'));

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toThrow(
      'se cayó la base',
    );
  });
});

describe('quitarFavorito', () => {
  it('da de baja el favorito del usuario', async () => {
    vi.mocked(repo.buscarActivo).mockResolvedValue(favorito(4) as never);

    await service.quitarFavorito(MASCOTA, USUARIO);

    expect(repo.darDeBaja).toHaveBeenCalledWith(4, USUARIO);
  });

  it('es idempotente: quitar algo que no está guardado no rompe ni escribe', async () => {
    vi.mocked(repo.buscarActivo).mockResolvedValue(null as never);

    await expect(service.quitarFavorito(MASCOTA, USUARIO)).resolves.toBeUndefined();
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });
});

describe('listarFavoritos', () => {
  it('arma las tarjetas respetando el orden que da el repository', async () => {
    const reciente = new Date('2026-08-19T15:00:00.000Z');
    const vieja = new Date('2026-08-01T09:00:00.000Z');

    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: reciente,
        estado: { id: 1, nombre: 'Disponible' },
      }),
      favoritoConMascota({
        id: 2,
        mascotaId: 43,
        fechaAlta: vieja,
        estado: { id: 5, nombre: 'En_Transito' },
      }),
    ] as never);

    const { total, favoritos } = await service.listarFavoritos(USUARIO);

    expect(total).toBe(2);
    expect(favoritos.map((f) => f.id)).toEqual([42, 43]);
    expect(favoritos[0]).toMatchObject({
      nombre: 'Fido',
      fechaNacimiento: '2022-03-15',
      estado: { id: 1, nombre: 'Disponible' },
      fechaAgregado: reciente.toISOString(),
    });
  });

  // Lo que decide el botón "Solicitar" de la tarjeta de GUI-12 (HU-7.1).
  it('expone la publicación activa y la solicitud viva propia', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: FECHA_AGREGADO,
        estado: { id: 1, nombre: 'Disponible' },
        publicacionId: 88,
        solicitudId: 1042,
      }),
    ] as never);

    const { favoritos } = await service.listarFavoritos(USUARIO);

    expect(favoritos[0]).toMatchObject({ publicacionId: 88, solicitudAbiertaId: 1042 });
  });

  it('sin publicación viva no hay nada que solicitar', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: FECHA_AGREGADO,
        estado: { id: 3, nombre: 'Adoptado' },
        publicacionId: null,
      }),
    ] as never);

    const { favoritos } = await service.listarFavoritos(USUARIO);

    // La mascota sigue en la lista (HU-6.6), pero sin publicación ni solicitud posible.
    expect(favoritos).toHaveLength(1);
    expect(favoritos[0]).toMatchObject({ publicacionId: null, solicitudAbiertaId: null });
  });

  it('incluye mascotas en cualquier estado, no sólo Disponible', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: FECHA_AGREGADO,
        estado: { id: 3, nombre: 'Adoptado' },
      }),
    ] as never);

    const { favoritos } = await service.listarFavoritos(USUARIO);

    expect(favoritos[0]!.estado.nombre).toBe('Adoptado');
  });

  it('tolera una fecha de nacimiento vacía', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: FECHA_AGREGADO,
        estado: { id: 1, nombre: 'Disponible' },
        fechaNacimiento: null,
      }),
    ] as never);

    const { favoritos } = await service.listarFavoritos(USUARIO);

    expect(favoritos[0]!.fechaNacimiento).toBeNull();
  });

  it('el contador nunca discrepa de la grilla: omite lo que no se puede pintar', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([
      favoritoConMascota({
        id: 1,
        mascotaId: 42,
        fechaAlta: FECHA_AGREGADO,
        estado: { id: 1, nombre: 'Disponible' },
      }),
      // Sin estado vigente: no se puede renderizar el badge.
      favoritoConMascota({ id: 2, mascotaId: 43, fechaAlta: FECHA_AGREGADO }),
    ] as never);

    const { total, favoritos } = await service.listarFavoritos(USUARIO);

    expect(favoritos).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('devuelve la lista vacía con total cero', async () => {
    vi.mocked(repo.listarVisiblesDeUsuario).mockResolvedValue([] as never);

    await expect(service.listarFavoritos(USUARIO)).resolves.toEqual({ total: 0, favoritos: [] });
  });
});

describe('formato de error', () => {
  it('los errores son AppError, así el errorHandler los traduce al formato de la API', async () => {
    vi.mocked(repo.buscarMascotaActiva).mockResolvedValue(null as never);

    await expect(service.agregarFavorito(MASCOTA, USUARIO, 'PERSONAL')).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
