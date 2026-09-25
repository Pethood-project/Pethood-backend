import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/publicaciones/publicaciones.repository';
import * as service from '../../../src/modules/publicaciones/publicaciones.service';

vi.mock('../../../src/modules/publicaciones/publicaciones.repository');
vi.mock('../../../src/shared/logAuditoria');

const USUARIO = 7;
const PUBLICACION = 40;

const ESTADOS_PUBLICACION = {
  Activa: { id: 1, nombre: 'Activa' },
  Pausada: { id: 2, nombre: 'Pausada' },
  Finalizada: { id: 3, nombre: 'Finalizada' },
} as const;

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
    historicoEstados: [{ estadoPublicacion: ESTADOS_PUBLICACION.Activa }],
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

  it('esPropia en true sobre una mascota del propio refugio, aunque la haya cargado otro miembro', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).resolves.toMatchObject({
      esPropia: true,
    });
  });

  it('esPropia en false sobre una mascota de otro refugio', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 2 } as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).resolves.toMatchObject({
      esPropia: false,
    });
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

  it('pasa el refugio del actor al repository, para que excluya sus publicaciones del feed', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 3 } as never);
    vi.mocked(repo.listarFeed).mockResolvedValue([] as never);
    vi.mocked(repo.contarFeed).mockResolvedValue(0);

    await service.listarFeed(USUARIO, {} as never);

    expect(repo.listarFeed).toHaveBeenCalledWith(USUARIO, {}, 3);
    expect(repo.contarFeed).toHaveBeenCalledWith(USUARIO, {}, 3);
  });
});

describe('estadoPublicacionSegunMascota — transición automática', () => {
  it.each([
    ['Disponible', 'Activa'],
    ['En_Transito', 'Pausada'],
    ['En_Tratamiento', 'Pausada'],
    ['Adoptado', 'Finalizada'],
    ['Fallecido', 'Finalizada'],
  ])('mascota %s → publicación %s', (estadoMascota, esperado) => {
    expect(service.estadoPublicacionSegunMascota(estadoMascota)).toBe(esperado);
  });

  it('la ficha informa el estado vigente de la publicación', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(USUARIO) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).resolves.toMatchObject({
      estado: { id: 1, nombre: 'Activa' },
    });
  });

  it('404 en la ficha si la publicación no tiene estado vigente (dato inconsistente)', async () => {
    const sinEstado = { ...publicacionActiva(USUARIO), historicoEstados: [] };
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(sinEstado as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
  });
});

/** Resuelve el catálogo por nombre, como el repository real. */
function catalogoPorNombre() {
  vi.mocked(repo.buscarEstadoPublicacionPorNombre).mockImplementation(
    async (nombre) => ESTADOS_PUBLICACION[nombre as keyof typeof ESTADOS_PUBLICACION] as never,
  );
}

describe('crearPublicacion — estado inicial', () => {
  function mascotaEn(estado: string) {
    return {
      ...mascota(USUARIO),
      historicoEstados: [{ estadoMascota: { id: 9, nombre: estado } }],
    };
  }

  const DATOS = {
    mascotaId: 8,
    descripcion: 'Muy cariñoso',
    ubicacion: 'CABA',
    requisitos: [],
    personalidad: [],
    desparasitado: false,
    vacunas: null,
  };
  const CONTEXTO = { usuarioId: USUARIO, ambito: 'PERSONAL' as const, archivos: [] };

  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({
      id: USUARIO,
      verificado: true,
      refugioId: null,
    } as never);
    vi.mocked(repo.buscarActivaDeMascota).mockResolvedValue(null as never);
    vi.mocked(repo.contarActivasPersonalesDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.crear).mockResolvedValue({ id: PUBLICACION, imagenes: [] } as never);
    catalogoPorNombre();
  });

  it.each([
    ['Disponible', 'Activa', 1],
    ['En_Transito', 'Pausada', 2],
  ])('mascota %s → nace %s', async (estadoMascota, nombre, estadoId) => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(mascotaEn(estadoMascota) as never);

    await service.crearPublicacion(DATOS, CONTEXTO);

    expect(repo.buscarEstadoPublicacionPorNombre).toHaveBeenCalledWith(nombre);
    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ estadoPublicacionId: estadoId }),
      USUARIO,
    );
  });

  it('500 si falta el valor en el catálogo, sin crear nada', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(mascotaEn('Disponible') as never);
    vi.mocked(repo.buscarEstadoPublicacionPorNombre).mockResolvedValue(null as never);

    await expect(service.crearPublicacion(DATOS, CONTEXTO)).rejects.toMatchObject({
      httpStatus: 500,
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });
});

describe('sincronizarConEstadoMascota — la publicación sigue a la mascota', () => {
  function publicacionEn(estado: keyof typeof ESTADOS_PUBLICACION) {
    return {
      id: PUBLICACION,
      historicoEstados: [{ estadoPublicacion: ESTADOS_PUBLICACION[estado] }],
    };
  }

  beforeEach(catalogoPorNombre);

  it('mascota adoptada → la publicación activa pasa a Finalizada', async () => {
    vi.mocked(repo.buscarActivaDeMascota).mockResolvedValue(publicacionEn('Activa') as never);

    await service.sincronizarConEstadoMascota(8, 'Adoptado', USUARIO);

    expect(repo.cambiarEstado).toHaveBeenCalledWith(PUBLICACION, 3, USUARIO);
  });

  it('mascota que vuelve a estar disponible → la pausada se reactiva', async () => {
    vi.mocked(repo.buscarActivaDeMascota).mockResolvedValue(publicacionEn('Pausada') as never);

    await service.sincronizarConEstadoMascota(8, 'Disponible', USUARIO);

    expect(repo.cambiarEstado).toHaveBeenCalledWith(PUBLICACION, 1, USUARIO);
  });

  it('no escribe nada si ya está en el estado que corresponde', async () => {
    vi.mocked(repo.buscarActivaDeMascota).mockResolvedValue(publicacionEn('Pausada') as never);

    await service.sincronizarConEstadoMascota(8, 'En_Tratamiento', USUARIO);

    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('no hace nada si la mascota no tiene publicación', async () => {
    vi.mocked(repo.buscarActivaDeMascota).mockResolvedValue(null as never);

    await service.sincronizarConEstadoMascota(8, 'Adoptado', USUARIO);

    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });
});

describe('listarMisPublicaciones — cada perfil ve solo las suyas', () => {
  it('desde el perfil personal filtra por el usuario, sin mirar su refugio', async () => {
    vi.mocked(repo.listarDeAmbito).mockResolvedValue([] as never);

    await service.listarMisPublicaciones(USUARIO, 'PERSONAL');

    expect(repo.listarDeAmbito).toHaveBeenCalledWith({ usuarioId: USUARIO }, []);
    expect(repo.buscarUsuario).not.toHaveBeenCalled();
  });

  it('desde la vista de refugio filtra por el refugio del usuario', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 3 } as never);
    vi.mocked(repo.listarDeAmbito).mockResolvedValue([] as never);

    await service.listarMisPublicaciones(USUARIO, 'REFUGIO');

    expect(repo.listarDeAmbito).toHaveBeenCalledWith({ refugioId: 3 }, []);
  });

  it('pasa los estados elegidos al repository (varios a la vez)', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 3 } as never);
    vi.mocked(repo.listarDeAmbito).mockResolvedValue([] as never);

    await service.listarMisPublicaciones(USUARIO, 'REFUGIO', { estados: [1, 2] });

    expect(repo.listarDeAmbito).toHaveBeenCalledWith({ refugioId: 3 }, [1, 2]);
  });

  it('403 SIN_REFUGIO si pide la vista de refugio sin pertenecer a uno', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(service.listarMisPublicaciones(USUARIO, 'REFUGIO')).rejects.toMatchObject({
      codigo: 'SIN_REFUGIO',
      httpStatus: 403,
    });
    expect(repo.listarDeAmbito).not.toHaveBeenCalled();
  });

  it('arma la tarjeta con la portada heredada de la mascota y el estado del aviso', async () => {
    const pausada = {
      ...publicacionActiva(USUARIO),
      historicoEstados: [{ estadoPublicacion: ESTADOS_PUBLICACION.Pausada }],
    };
    vi.mocked(repo.listarDeAmbito).mockResolvedValue([pausada] as never);

    await expect(service.listarMisPublicaciones(USUARIO, 'PERSONAL')).resolves.toEqual([
      {
        id: PUBLICACION,
        imagenUrl: '/api/v1/archivos/mascotas/toby.jpg',
        fechaPublicacion: '2026-08-19T15:00:00.000Z',
        estado: { id: 2, nombre: 'Pausada' },
        mascota: {
          id: 8,
          nombre: 'Toby',
          fechaNacimiento: '2022-03-15',
          especie: { id: 1, nombre: 'Perro' },
        },
      },
    ]);
  });

  it('descarta las publicaciones sin estado vigente', async () => {
    const inconsistente = { ...publicacionActiva(USUARIO), historicoEstados: [] };
    vi.mocked(repo.listarDeAmbito).mockResolvedValue([inconsistente] as never);

    await expect(service.listarMisPublicaciones(USUARIO, 'PERSONAL')).resolves.toEqual([]);
  });
});

describe('formato de error', () => {
  it('los errores son AppError, así el errorHandler los traduce al formato de la API', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(null as never);

    await expect(service.obtenerPublicacion(PUBLICACION, USUARIO)).rejects.toBeInstanceOf(AppError);
  });
});
