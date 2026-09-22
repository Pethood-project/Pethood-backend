import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/publicaciones/publicaciones.repository';
import * as service from '../../../src/modules/publicaciones/publicaciones.service';

vi.mock('../../../src/modules/publicaciones/publicaciones.repository');

const USUARIO = 7;
const PUBLICACION = 40;

function mascota(usuarioId: number, refugioId: number | null = null) {
  return {
    id: 8,
    nombre: 'Toby',
    fechaNacimiento: new Date(2022, 2, 15),
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 12.5,
    castrado: true,
    descripcion: null,
    imagenUrl: '/api/v1/archivos/mascotas/toby.jpg',
    usuarioId,
    refugioId,
    raza: { id: 2, nombre: 'Labrador', especie: { id: 1, nombre: 'Perro' } },
    refugio: refugioId ? { id: refugioId, nombre: 'Refugio Patitas', direccion: 'Calle 1' } : null,
    historicoEstados: [{ estadoMascota: { id: 1, nombre: 'Disponible' } }],
  };
}

function publicacionActiva(duenio: number, refugioId: number | null = null) {
  return {
    id: PUBLICACION,
    titulo: 'Toby busca hogar',
    descripcion: 'Muy cariñoso',
    ubicacion: 'CABA',
    requisitos: [],
    personalidad: [],
    desparasitado: true,
    vacunas: 'Al día',
    imagenes: [],
    fechaAlta: new Date('2026-08-19T15:00:00.000Z'),
    mascotaId: 8,
    mascota: mascota(duenio, refugioId),
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.filtrarFavoritas).mockResolvedValue(new Set());
});

describe('obtenerPublicacion — esPropia', () => {
  it('404 si la publicación no existe', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(null as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('404 si el usuario que consulta no existe', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('esPropia en false sobre la mascota de otro adoptante', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).resolves.toMatchObject({
      esPropia: false,
    });
  });

  it('esPropia en true sobre la propia mascota personal', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(USUARIO) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).resolves.toMatchObject({
      esPropia: true,
    });
  });

  it('en ámbito REFUGIO, esPropia en true sobre una mascota del propio refugio, aunque la haya cargado otro miembro', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'REFUGIO'),
    ).resolves.toMatchObject({ esPropia: true });
  });

  it('en ámbito PERSONAL, esPropia en false sobre una mascota del propio refugio: el switch hace de cuenta que es un adoptante más', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({ esPropia: false });
  });

  it('esPropia en false sobre una mascota de otro refugio', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 2 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'REFUGIO'),
    ).resolves.toMatchObject({ esPropia: false });
  });
});

describe('listarFeed', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);
  });

  it('el feed nunca marca esPropia, porque ya excluye las mascotas propias', async () => {
    vi.mocked(repo.listarFeed).mockResolvedValue([publicacionActiva(99)] as never);
    vi.mocked(repo.contarFeed).mockResolvedValue(1);

    const { publicaciones } = await service.listarFeed(USUARIO, {} as never);

    expect(publicaciones[0]!.esPropia).toBe(false);
  });

  it('404 si el usuario no existe', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null as never);

    await expect(service.listarFeed(USUARIO, {} as never)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
  });

  it('pasa el refugio del actor al repository, para que excluya sus publicaciones en ámbito REFUGIO', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 3 } as never);
    vi.mocked(repo.listarFeed).mockResolvedValue([] as never);
    vi.mocked(repo.contarFeed).mockResolvedValue(0);

    await service.listarFeed(USUARIO, { ambito: 'REFUGIO' } as never);

    expect(repo.listarFeed).toHaveBeenCalledWith(USUARIO, { ambito: 'REFUGIO' }, 3);
    expect(repo.contarFeed).toHaveBeenCalledWith(USUARIO, { ambito: 'REFUGIO' }, 3);
  });
});

describe('formato de error', () => {
  it('los errores son AppError, así el errorHandler los traduce al formato de la API', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(null as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).rejects.toBeInstanceOf(AppError);
  });
});
