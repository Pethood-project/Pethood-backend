import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/publicaciones/publicaciones.repository';
import { MARCADOR_FOTO_NUEVA } from '../../../src/modules/publicaciones/publicaciones.dto';
import * as service from '../../../src/modules/publicaciones/publicaciones.service';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../../src/shared/storage';

vi.mock('../../../src/modules/publicaciones/publicaciones.repository');
vi.mock('../../../src/shared/logAuditoria');
vi.mock('../../../src/shared/storage');

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
    historiaClinica: [{ tipoVacuna: 'ANTIRRABICA', fechaVisita: new Date(2025, 4, 1) }],
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
    imagenes: [],
    fechaAlta: new Date('2026-08-19T15:00:00.000Z'),
    mascotaId: 8,
    usuarioId: duenio,
    usuario: { nombre: 'Ana', apellido: 'López' },
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

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('404 si el usuario que consulta no existe', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('esPropia en false sobre la mascota de otro adoptante', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      esPropia: false,
    });
  });

  it('esPropia en true sobre la propia mascota personal', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(USUARIO) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      esPropia: true,
    });
  });

  it('esPropia en true sobre una mascota del propio refugio, aunque la haya cargado otro miembro', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 1 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      esPropia: true,
    });
  });

  it('esPropia en false sobre una mascota de otro refugio', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 2 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      esPropia: false,
    });
  });

  it('publicadoPor trae a la persona cuando la publicación no es de un refugio', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      refugio: null,
      publicadoPor: { nombre: 'Ana', apellido: 'López' },
    });
  });

  it('publicadoPor en null en una publicación de refugio: no expone a su personal', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99, 1) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 2 } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      refugio: { nombre: 'Refugio Patitas' },
      publicadoPor: null,
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

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({
      estado: { id: 1, nombre: 'Activa' },
    });
  });

  it('la ficha muestra las vacunas de la historia clínica de la mascota (spec 019)', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(USUARIO) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    const ficha = await service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL');

    expect(ficha.vacunas).toEqual([
      expect.objectContaining({
        tipo: 'ANTIRRABICA',
        nombre: 'Antirrábica',
        fechaAplicacion: '2025-05-01',
      }),
    ]);
  });

  it('404 en la ficha si la publicación no tiene estado vigente (dato inconsistente)', async () => {
    const sinEstado = { ...publicacionActiva(USUARIO), historicoEstados: [] };
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(sinEstado as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({
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
  };
  const CONTEXTO = { usuarioId: USUARIO, ambito: 'PERSONAL' as const, archivos: [] };

  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({
      id: USUARIO,
      verificado: true,
      refugioId: null,
    } as never);
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(null as never);
    vi.mocked(repo.contarActivasPersonalesDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.crear).mockResolvedValue({
      publicacion: { id: PUBLICACION, imagenes: [] },
      retiradas: [],
    } as never);
    catalogoPorNombre();
  });

  it('si reemplaza avisos finalizados de la mascota, deja constancia de cada baja', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(mascotaEn('Disponible') as never);
    vi.mocked(repo.crear).mockResolvedValue({
      publicacion: { id: PUBLICACION, imagenes: [] },
      retiradas: [31],
    } as never);

    await service.crearPublicacion(DATOS, CONTEXTO);

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ELIMINAR', entidad: 'Publicacion', entidadId: 31 }),
    );
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

  it.each([
    ['Adoptado', 'Activa', 3],
    ['Fallecido', 'Pausada', 3],
    ['En_Transito', 'Activa', 2],
    ['En_Tratamiento', 'Activa', 2],
  ] as const)('mascota %s → la publicación %s cambia al estado %i', async (mascota, desde, id) => {
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(publicacionEn(desde) as never);

    await service.sincronizarConEstadoMascota(8, mascota, USUARIO);

    expect(repo.cambiarEstado).toHaveBeenCalledWith(PUBLICACION, id, USUARIO);
  });

  it('mascota que sale de tratamiento → la pausada NO se reactiva sola', async () => {
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(publicacionEn('Pausada') as never);

    await service.sincronizarConEstadoMascota(8, 'Disponible', USUARIO);

    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('una finalizada no se toca más', async () => {
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(publicacionEn('Finalizada') as never);

    await service.sincronizarConEstadoMascota(8, 'En_Tratamiento', USUARIO);

    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('no escribe nada si ya está en el estado que corresponde', async () => {
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(publicacionEn('Pausada') as never);

    await service.sincronizarConEstadoMascota(8, 'En_Tratamiento', USUARIO);

    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('no hace nada si la mascota no tiene publicación', async () => {
    vi.mocked(repo.buscarEnCursoDeMascota).mockResolvedValue(null as never);

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

describe('puedeEditarPublicacion — quién gestiona el aviso', () => {
  const personal = { usuarioId: USUARIO, mascota: { usuarioId: USUARIO, refugioId: null } };
  const delRefugio = { usuarioId: 99, mascota: { usuarioId: 99, refugioId: 3 } };

  it('desde el perfil personal, quien la publicó', () => {
    expect(
      service.puedeEditarPublicacion(personal, { id: USUARIO, refugioId: null }, 'PERSONAL'),
    ).toBe(true);
  });

  it('desde el perfil personal, nadie más', () => {
    expect(service.puedeEditarPublicacion(personal, { id: 5, refugioId: null }, 'PERSONAL')).toBe(
      false,
    );
  });

  it('desde el refugio, cualquier miembro, aunque la haya publicado otro', () => {
    expect(
      service.puedeEditarPublicacion(delRefugio, { id: USUARIO, refugioId: 3 }, 'REFUGIO'),
    ).toBe(true);
  });

  it('lo del refugio no se gestiona desde el perfil personal', () => {
    expect(service.puedeEditarPublicacion(delRefugio, { id: 99, refugioId: 3 }, 'PERSONAL')).toBe(
      false,
    );
  });

  it('un miembro de otro refugio no la gestiona', () => {
    expect(
      service.puedeEditarPublicacion(delRefugio, { id: USUARIO, refugioId: 4 }, 'REFUGIO'),
    ).toBe(false);
  });

  it('la ficha informa puedeEditar según el perfil activo', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(USUARIO) as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).resolves.toMatchObject({ puedeEditar: true });
  });
});

function publicacionEnEstado(estado: keyof typeof ESTADOS_PUBLICACION, extra: object = {}) {
  return {
    ...publicacionActiva(USUARIO),
    historicoEstados: [{ estadoPublicacion: ESTADOS_PUBLICACION[estado] }],
    ...extra,
  };
}

describe('editarPublicacion', () => {
  const FOTO_A = '/api/v1/archivos/publicaciones/a.jpg';
  const FOTO_B = '/api/v1/archivos/publicaciones/b.jpg';
  const FOTO_MASCOTA = '/api/v1/archivos/mascotas/toby.jpg';
  const NUEVA = '/api/v1/archivos/publicaciones/nueva.jpg';
  const ARCHIVO = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };

  const DATOS = {
    descripcion: 'Súper mimoso',
    ubicacion: 'Godoy Cruz',
    requisitos: ['Casa con patio'],
    personalidad: ['Tranquilo'],
    desparasitado: true,
    imagenes: [] as string[],
  };
  const CONTEXTO = { usuarioId: USUARIO, ambito: 'PERSONAL' as const, archivos: [] };

  beforeEach(() => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(
      publicacionEnEstado('Activa', { imagenes: [FOTO_A, FOTO_B] }) as never,
    );
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);
    vi.mocked(guardarImagenes).mockResolvedValue([NUEVA]);
  });

  it('403 si no la puede gestionar, sin tocar nada', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: 5, refugioId: null } as never);

    await expect(
      service.editarPublicacion(PUBLICACION, DATOS, { ...CONTEXTO, usuarioId: 5 }),
    ).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO', httpStatus: 403 });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it('409 si está finalizada', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionEnEstado('Finalizada') as never);

    await expect(service.editarPublicacion(PUBLICACION, DATOS, CONTEXTO)).rejects.toMatchObject({
      codigo: 'PUBLICACION_FINALIZADA',
      httpStatus: 409,
    });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it('una pausada se puede editar', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(
      publicacionEnEstado('Pausada', { imagenes: [FOTO_A] }) as never,
    );

    await service.editarPublicacion(PUBLICACION, { ...DATOS, imagenes: [FOTO_A] }, CONTEXTO);

    expect(repo.actualizar).toHaveBeenCalled();
  });

  it('reordena, ubica las nuevas en su marca y borra solo las quitadas', async () => {
    await service.editarPublicacion(
      PUBLICACION,
      { ...DATOS, imagenes: [MARCADOR_FOTO_NUEVA, FOTO_B] },
      { ...CONTEXTO, archivos: [ARCHIVO] },
    );

    expect(repo.actualizar).toHaveBeenCalledWith(
      PUBLICACION,
      expect.objectContaining({ imagenes: [NUEVA, FOTO_B], descripcion: 'Súper mimoso' }),
      USUARIO,
    );
    expect(borrarImagenes).toHaveBeenCalledWith([FOTO_A]);
  });

  it('sin fotos vuelve a heredar la de la mascota, que nunca se borra', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(
      publicacionEnEstado('Activa', { imagenes: [FOTO_MASCOTA, FOTO_A] }) as never,
    );

    await service.editarPublicacion(PUBLICACION, DATOS, CONTEXTO);

    expect(repo.actualizar).toHaveBeenCalledWith(
      PUBLICACION,
      expect.objectContaining({ imagenes: [FOTO_MASCOTA] }),
      USUARIO,
    );
    expect(borrarImagenes).toHaveBeenCalledWith([FOTO_A]);
  });

  it('400 si la galería apunta a una foto que no es de la publicación', async () => {
    await expect(
      service.editarPublicacion(
        PUBLICACION,
        { ...DATOS, imagenes: ['/api/v1/archivos/publicaciones/ajena.jpg'] },
        CONTEXTO,
      ),
    ).rejects.toMatchObject({ codigo: 'VALIDACION', httpStatus: 400 });
    expect(guardarImagenes).not.toHaveBeenCalled();
  });

  it('400 si las marcas no coinciden con las fotos subidas', async () => {
    await expect(
      service.editarPublicacion(
        PUBLICACION,
        { ...DATOS, imagenes: [FOTO_A] },
        { ...CONTEXTO, archivos: [ARCHIVO] },
      ),
    ).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('400 si repite una foto', async () => {
    await expect(
      service.editarPublicacion(PUBLICACION, { ...DATOS, imagenes: [FOTO_A, FOTO_A] }, CONTEXTO),
    ).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('si falla la base, borra las fotos nuevas y no las viejas', async () => {
    vi.mocked(repo.actualizar).mockRejectedValue(new Error('base caída'));

    await expect(
      service.editarPublicacion(
        PUBLICACION,
        { ...DATOS, imagenes: [FOTO_A, MARCADOR_FOTO_NUEVA] },
        { ...CONTEXTO, archivos: [ARCHIVO] },
      ),
    ).rejects.toThrow('base caída');
    expect(borrarImagenes).toHaveBeenCalledTimes(1);
    expect(borrarImagenes).toHaveBeenCalledWith([NUEVA]);
  });
});

describe('cambiarEstadoPublicacion — pausar, reactivar, finalizar', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: null } as never);
    vi.mocked(repo.contarActivasPersonalesDeUsuario).mockResolvedValue(0);
    catalogoPorNombre();
  });

  it.each([
    ['PAUSAR', 'Activa', 2],
    ['REACTIVAR', 'Pausada', 1],
    ['FINALIZAR', 'Activa', 3],
    ['FINALIZAR', 'Pausada', 3],
  ] as const)('%s desde %s', async (accion, desde, destino) => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionEnEstado(desde) as never);

    await service.cambiarEstadoPublicacion(PUBLICACION, accion, USUARIO, 'PERSONAL');

    expect(repo.cambiarEstado).toHaveBeenCalledWith(PUBLICACION, destino, USUARIO);
  });

  it.each([
    ['PAUSAR', 'Pausada'],
    ['PAUSAR', 'Finalizada'],
    ['REACTIVAR', 'Activa'],
    ['REACTIVAR', 'Finalizada'],
    ['FINALIZAR', 'Finalizada'],
  ] as const)('409 al %s desde %s', async (accion, desde) => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionEnEstado(desde) as never);

    await expect(
      service.cambiarEstadoPublicacion(PUBLICACION, accion, USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'TRANSICION_INVALIDA', httpStatus: 409 });
    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('no reactiva si la mascota sigue en tratamiento', async () => {
    const pausada = publicacionEnEstado('Pausada');
    pausada.mascota.historicoEstados = [{ estadoMascota: { id: 3, nombre: 'En_Tratamiento' } }];
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(pausada as never);

    await expect(
      service.cambiarEstadoPublicacion(PUBLICACION, 'REACTIVAR', USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'MASCOTA_NO_DISPONIBLE', httpStatus: 409 });
  });

  it('reactivar respeta la quota de publicaciones activas del adoptante', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionEnEstado('Pausada') as never);
    vi.mocked(repo.contarActivasPersonalesDeUsuario).mockResolvedValue(
      service.MAXIMO_ACTIVAS_POR_ADOPTANTE,
    );

    await expect(
      service.cambiarEstadoPublicacion(PUBLICACION, 'REACTIVAR', USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'LIMITE_DE_PUBLICACIONES' });
    expect(repo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('la quota no aplica a las del refugio', async () => {
    const delRefugio = {
      ...publicacionEnEstado('Pausada'),
      mascota: mascota(99, 3),
      usuarioId: 99,
    };
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(delRefugio as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO, refugioId: 3 } as never);
    vi.mocked(repo.contarActivasPersonalesDeUsuario).mockResolvedValue(99);

    await service.cambiarEstadoPublicacion(PUBLICACION, 'REACTIVAR', USUARIO, 'REFUGIO');

    expect(repo.cambiarEstado).toHaveBeenCalledWith(PUBLICACION, 1, USUARIO);
  });

  it('403 si no la puede gestionar', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(publicacionActiva(99) as never);

    await expect(
      service.cambiarEstadoPublicacion(PUBLICACION, 'PAUSAR', USUARIO, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO', httpStatus: 403 });
  });
});

describe('formato de error', () => {
  it('los errores son AppError, así el errorHandler los traduce al formato de la API', async () => {
    vi.mocked(repo.buscarActivaPorId).mockResolvedValue(null as never);

    await expect(
      service.obtenerPublicacion(PUBLICACION, USUARIO, 'PERSONAL'),
    ).rejects.toBeInstanceOf(AppError);
  });
});
