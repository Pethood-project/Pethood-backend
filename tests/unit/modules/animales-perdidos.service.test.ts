import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import type {
  CrearAvisoDto,
  FiltrosAvisosDto,
} from '../../../src/modules/animales-perdidos/animales-perdidos.dto';
import * as repo from '../../../src/modules/animales-perdidos/animales-perdidos.repository';
import * as service from '../../../src/modules/animales-perdidos/animales-perdidos.service';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../../src/shared/storage';

vi.mock('../../../src/modules/animales-perdidos/animales-perdidos.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');

const USUARIO = 7;
const OTRO = 99;

const ESTADOS = {
  Perdido: { id: 1, nombre: 'Perdido' },
  Encontrado: { id: 2, nombre: 'Encontrado' },
  Resuelto: { id: 3, nombre: 'Resuelto' },
} as const;

const ARCHIVO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };
const URL_FOTO = '/api/v1/archivos/perdidos/x.jpg';

const FECHA_SUCESO = new Date(2026, 8, 18);

const DATOS: CrearAvisoDto = {
  nombre: 'Thor',
  descripcion: 'Labrador dorado con collar azul.',
  ubicacion: 'Godoy Cruz',
  fechaSuceso: FECHA_SUCESO,
  estadoId: ESTADOS.Perdido.id,
  especieId: 1,
  latitud: -32.9264,
  longitud: -68.8447,
};

const FILTROS: FiltrosAvisosDto = {
  limite: 2,
  estados: [],
  especies: [],
  ubicaciones: [],
};

/** Fila tal como la devuelve el repository, con sus relaciones ya resueltas. */
function aviso(
  id: number,
  opciones: {
    reportanteId?: number;
    estado?: { id: number; nombre: string };
    nombre?: string | null;
    especie?: { id: number; nombre: string } | null;
    imagenes?: string[];
  } = {},
): repo.AvisoConRelaciones {
  const reportanteId = opciones.reportanteId ?? OTRO;

  return {
    id,
    nombre: opciones.nombre === undefined ? 'Thor' : opciones.nombre,
    descripcion: 'Labrador dorado con collar azul.',
    imagenUrl: URL_FOTO,
    imagenes: opciones.imagenes ?? [URL_FOTO],
    ubicacion: 'Godoy Cruz',
    fechaSuceso: FECHA_SUCESO,
    fechaAlta: new Date('2026-09-20T15:00:00.000Z'),
    fechaResuelto: null,
    usuarioReportanteId: reportanteId,
    estadoAnimalPerdido: opciones.estado ?? ESTADOS.Perdido,
    especie: opciones.especie === undefined ? { id: 1, nombre: 'Perro' } : opciones.especie,
    usuarioReportante: { id: reportanteId, nombre: 'Ana', apellido: 'Gómez', imagenUrl: null },
  };
}

async function codigoDeError(promesa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesa;
    return undefined;
  } catch (err) {
    return err instanceof AppError ? err.codigo : 'NO_ES_APP_ERROR';
  }
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO });
  vi.mocked(repo.buscarEstado).mockImplementation(
    async (id) => Object.values(ESTADOS).find((estado) => estado.id === id) ?? null,
  );
  vi.mocked(repo.buscarEspecie).mockResolvedValue({ id: 1 });
  vi.mocked(repo.crear).mockResolvedValue(aviso(10, { reportanteId: USUARIO }));
  vi.mocked(guardarImagenes).mockResolvedValue([URL_FOTO]);
});

describe('crearAviso', () => {
  it('publica el aviso con el usuario autenticado como reportante', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(guardarImagenes).toHaveBeenCalledWith([ARCHIVO], 'perdidos');
    expect(repo.crear).toHaveBeenCalledWith(
      {
        nombre: 'Thor',
        descripcion: DATOS.descripcion,
        imagenes: [URL_FOTO],
        ubicacion: 'Godoy Cruz',
        fechaSuceso: FECHA_SUCESO,
        latitud: -32.9264,
        longitud: -68.8447,
        especieId: 1,
        estadoAnimalPerdidoId: ESTADOS.Perdido.id,
      },
      USUARIO,
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'AnimalPerdido', entidadId: 10 }),
    );
    expect(creado).toMatchObject({ id: 10, esPropio: true, estado: ESTADOS.Perdido });
  });

  it('guarda varias fotos en el orden recibido y devuelve la galería', async () => {
    const otro = { buffer: Buffer.from('otra'), mimetype: 'image/png' };
    const galeria = [URL_FOTO, '/api/v1/archivos/perdidos/y.png'];
    vi.mocked(guardarImagenes).mockResolvedValue(galeria);
    vi.mocked(repo.crear).mockResolvedValue(
      aviso(10, { reportanteId: USUARIO, imagenes: galeria }),
    );

    const creado = await service.crearAviso(DATOS, {
      usuarioId: USUARIO,
      archivos: [ARCHIVO, otro],
    });

    expect(guardarImagenes).toHaveBeenCalledWith([ARCHIVO, otro], 'perdidos');
    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject({ imagenes: galeria });
    expect(creado).toMatchObject({ imagenUrl: URL_FOTO, imagenes: galeria });
  });

  it('devuelve la fecha del suceso como día, sin hora', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado.fechaSuceso).toBe('2026-09-18');
  });

  it('no expone las coordenadas del reportante', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado).not.toHaveProperty('latitud');
    expect(creado).not.toHaveProperty('longitud');
  });

  it('exige la foto y no escribe nada sin ella', async () => {
    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [] })),
    ).toBe('FOTO_REQUERIDA');
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('rechaza un usuario que ya no existe', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null);

    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] })),
    ).toBe('NO_ENCONTRADO');
  });

  it('rechaza un estado que no existe', async () => {
    expect(
      await codigoDeError(
        service.crearAviso({ ...DATOS, estadoId: 999 }, { usuarioId: USUARIO, archivos: [ARCHIVO] }),
      ),
    ).toBe('NO_ENCONTRADO');
  });

  it('no deja nacer un aviso como Resuelto y no sube la foto', async () => {
    expect(
      await codigoDeError(
        service.crearAviso(
          { ...DATOS, estadoId: ESTADOS.Resuelto.id },
          { usuarioId: USUARIO, archivos: [ARCHIVO] },
        ),
      ),
    ).toBe('ESTADO_INVALIDO');
    expect(guardarImagenes).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('exige el nombre en un aviso Perdido', async () => {
    const promesa = service.crearAviso(
      { ...DATOS, nombre: null },
      { usuarioId: USUARIO, archivos: [ARCHIVO] },
    );

    await expect(promesa).rejects.toMatchObject({
      codigo: 'VALIDACION',
      message: 'El nombre es obligatorio',
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('acepta un aviso Encontrado sin nombre', async () => {
    vi.mocked(repo.crear).mockResolvedValue(
      aviso(11, { reportanteId: USUARIO, estado: ESTADOS.Encontrado, nombre: null }),
    );

    const creado = await service.crearAviso(
      { ...DATOS, nombre: null, estadoId: ESTADOS.Encontrado.id },
      { usuarioId: USUARIO, archivos: [ARCHIVO] },
    );

    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject({
      nombre: null,
      estadoAnimalPerdidoId: ESTADOS.Encontrado.id,
    });
    expect(creado.nombre).toBeNull();
  });

  it('rechaza una especie que no existe sin subir las fotos', async () => {
    vi.mocked(repo.buscarEspecie).mockResolvedValue(null);

    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] })),
    ).toBe('NO_ENCONTRADO');
    expect(guardarImagenes).not.toHaveBeenCalled();
  });

  it('borra las fotos si falla la escritura en base', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('se cayó la base'));

    await expect(
      service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] }),
    ).rejects.toThrow('se cayó la base');
    expect(borrarImagenes).toHaveBeenCalledWith([URL_FOTO]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('listarAvisos', () => {
  it('sin avisos devuelve una lista vacía, no un error', async () => {
    vi.mocked(repo.listar).mockResolvedValue([]);

    expect(await service.listarAvisos(FILTROS, USUARIO)).toEqual({
      avisos: [],
      hayMas: false,
      proximoCursor: null,
    });
  });

  it('con una fila de más corta la página y devuelve el cursor del último aviso', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(30), aviso(20), aviso(10)]);

    const pagina = await service.listarAvisos(FILTROS, USUARIO);

    expect(pagina.avisos.map((a) => a.id)).toEqual([30, 20]);
    expect(pagina.hayMas).toBe(true);
    expect(pagina.proximoCursor).toBe(20);
  });

  it('con exactamente el límite no hay más páginas', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(30), aviso(20)]);

    const pagina = await service.listarAvisos(FILTROS, USUARIO);

    expect(pagina.hayMas).toBe(false);
    expect(pagina.proximoCursor).toBeNull();
  });

  it('le pasa los filtros, el límite y el cursor al repository', async () => {
    vi.mocked(repo.existeAviso).mockResolvedValue({ id: 20 });
    vi.mocked(repo.listar).mockResolvedValue([]);
    const fechaDesde = new Date(2026, 8, 1);

    await service.listarAvisos(
      {
        ...FILTROS,
        cursor: 20,
        fechaDesde,
        estados: [1, 2],
        especies: [1],
        ubicaciones: ['Maipú'],
      },
      USUARIO,
    );

    expect(repo.listar).toHaveBeenCalledWith(
      { fechaDesde, fechaHasta: undefined, estados: [1, 2], especies: [1], ubicaciones: ['Maipú'] },
      2,
      20,
    );
  });

  it('rechaza un cursor que no existe', async () => {
    vi.mocked(repo.existeAviso).mockResolvedValue(null);

    expect(await codigoDeError(service.listarAvisos({ ...FILTROS, cursor: 404 }, USUARIO))).toBe(
      'CURSOR_INVALIDO',
    );
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('marca como propios sólo los avisos del usuario autenticado', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(2, { reportanteId: USUARIO }), aviso(1)]);

    const { avisos } = await service.listarAvisos(FILTROS, USUARIO);

    expect(avisos.map((a) => a.esPropio)).toEqual([true, false]);
  });

  it('pinta un aviso viejo sin especie en vez de romper el listado', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(1, { especie: null })]);

    const { avisos } = await service.listarAvisos(FILTROS, USUARIO);

    expect(avisos[0]!.especie).toBeNull();
  });
});

describe('listarUbicaciones', () => {
  it('une las variantes de mayúsculas, descarta vacíos y ordena alfabéticamente', async () => {
    vi.mocked(repo.listarUbicaciones).mockResolvedValue([
      { ubicacion: 'maipú' },
      { ubicacion: 'Godoy Cruz' },
      { ubicacion: 'Maipú' },
      { ubicacion: '   ' },
      { ubicacion: null },
      { ubicacion: 'Ciudad de Mendoza' },
    ]);

    expect(await service.listarUbicaciones()).toEqual(['Ciudad de Mendoza', 'Godoy Cruz', 'Maipú']);
  });
});
