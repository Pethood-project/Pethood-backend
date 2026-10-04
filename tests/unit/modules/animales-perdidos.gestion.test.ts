/**
 * HU-13.3 — lo que gestiona quien publicó un aviso de mascota perdida: verlo, listarlo en Mis
 * publicaciones, editarlo y eliminarlo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/animales-perdidos/animales-perdidos.repository', () => ({
  buscarPorId: vi.fn(),
  listarDeReportante: vi.fn(),
  buscarEstado: vi.fn(),
  buscarEspecie: vi.fn(),
  actualizar: vi.fn(),
  darDeBajaPorReportante: vi.fn(),
}));
vi.mock('../../../src/modules/chats/chats.service', () => ({}));
vi.mock('../../../src/shared/storage', () => ({
  guardarImagenes: vi.fn(),
  borrarImagenes: vi.fn(),
}));
vi.mock('../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));
// Sólo el geocoder (red): los armadores de links de Maps se usan de verdad.
vi.mock('../../../src/shared/geocoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/shared/geocoding')>()),
  geocodificarLugar: vi.fn(),
}));

import type { EditarAvisoDto } from '../../../src/modules/animales-perdidos/animales-perdidos.dto';
import * as repo from '../../../src/modules/animales-perdidos/animales-perdidos.repository';
import {
  editarAviso,
  eliminarAviso,
  listarMisAvisos,
  obtenerAviso,
} from '../../../src/modules/animales-perdidos/animales-perdidos.service';
import { geocodificarLugar } from '../../../src/shared/geocoding';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../../src/shared/storage';

const mockedRepo = vi.mocked(repo);

const DUENO = 3;
const OTRO = 9;
const FOTO_1 = '/api/v1/archivos/perdidos/1.jpg';
const FOTO_2 = '/api/v1/archivos/perdidos/2.jpg';
const PLAZA = { latitud: -32.9264, longitud: -68.8447 };

const ESTADOS = {
  Perdido: { id: 1, nombre: 'Perdido' },
  Encontrado: { id: 2, nombre: 'Encontrado' },
  Resuelto: { id: 3, nombre: 'Resuelto' },
} as const;

/** El aviso como lo devuelve `buscarPorId`: de la persona 3, vivo y perdido. */
function aviso(extra: Record<string, unknown> = {}) {
  return {
    id: 7,
    nombre: 'Michi',
    descripcion: 'Gato gris.',
    imagenUrl: FOTO_1,
    imagenes: [FOTO_1, FOTO_2],
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    referencia: 'Plaza',
    lugarLatitud: PLAZA.latitud,
    lugarLongitud: PLAZA.longitud,
    fechaSuceso: new Date(2026, 8, 20),
    fechaAlta: new Date('2026-09-21T10:00:00.000Z'),
    fechaResuelto: null,
    fechaBaja: null,
    usuarioReportanteId: DUENO,
    estadoAnimalPerdido: ESTADOS.Perdido,
    especie: { id: 2, nombre: 'Gato' },
    usuarioReportante: { id: DUENO, nombre: 'Ana', apellido: 'Paz', imagenUrl: null },
    ...extra,
  } as never;
}

/** Lo que manda el formulario de edición sin tocar nada. */
const SIN_CAMBIOS: EditarAvisoDto = {
  nombre: 'Michi',
  descripcion: 'Gato gris.',
  provincia: 'Mendoza',
  localidad: 'Godoy Cruz',
  referencia: 'Plaza',
  fechaSuceso: new Date(2026, 8, 20),
  estadoId: ESTADOS.Perdido.id,
  especieId: 2,
  imagenes: [FOTO_1, FOTO_2],
};

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as { codigo: string }).codigo;
  }
  return 'SIN_ERROR';
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedRepo.buscarPorId.mockResolvedValue(aviso());
  mockedRepo.buscarEspecie.mockResolvedValue({ id: 2 });
  mockedRepo.buscarEstado.mockImplementation(
    async (id) => Object.values(ESTADOS).find((estado) => estado.id === id) ?? null,
  );
  mockedRepo.actualizar.mockImplementation(async (_id, datos) => aviso(datos));
});

describe('obtenerAviso', () => {
  it('devuelve el aviso, con la distancia si viene la ubicación de quien mira', async () => {
    const detalle = await obtenerAviso(7, OTRO, { latitud: -32.895, longitud: -68.8447 });

    expect(detalle).toMatchObject({ id: 7, esPropio: false, distanciaKm: 3.5, lugar: PLAZA });
  });

  it('un aviso eliminado dice que se eliminó, no que no existe', async () => {
    mockedRepo.buscarPorId.mockResolvedValue(aviso({ fechaBaja: new Date() }));

    expect(await codigo(obtenerAviso(7, OTRO, null))).toBe('AVISO_ELIMINADO');
  });

  it('un id que no existe es NO_ENCONTRADO', async () => {
    mockedRepo.buscarPorId.mockResolvedValue(null);

    expect(await codigo(obtenerAviso(7, OTRO, null))).toBe('NO_ENCONTRADO');
  });
});

describe('listarMisAvisos', () => {
  it('trae los avisos del usuario, marcados como propios', async () => {
    mockedRepo.listarDeReportante.mockResolvedValue([aviso()] as never);

    const avisos = await listarMisAvisos(DUENO);

    expect(mockedRepo.listarDeReportante).toHaveBeenCalledWith(DUENO);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ id: 7, esPropio: true });
  });
});

describe('editarAviso', () => {
  it('guarda los cambios y deja el pin que tenía si el lugar no cambió', async () => {
    await editarAviso(
      7,
      { ...SIN_CAMBIOS, descripcion: 'Gato gris con collar.' },
      {
        usuarioId: DUENO,
        archivos: [],
      },
    );

    expect(geocodificarLugar).not.toHaveBeenCalled();
    expect(mockedRepo.actualizar).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        descripcion: 'Gato gris con collar.',
        lugarLatitud: PLAZA.latitud,
        lugarLongitud: PLAZA.longitud,
        imagenes: [FOTO_1, FOTO_2],
      }),
      DUENO,
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'MODIFICAR', entidadId: 7 }),
    );
  });

  it('si el lugar cambió y no viene el pin, lo vuelve a geocodificar', async () => {
    vi.mocked(geocodificarLugar).mockResolvedValue({ latitud: -32.98, longitud: -68.78 });

    await editarAviso(
      7,
      { ...SIN_CAMBIOS, localidad: 'Maipú', referencia: null },
      {
        usuarioId: DUENO,
        archivos: [],
      },
    );

    expect(geocodificarLugar).toHaveBeenCalledWith({
      provincia: 'Mendoza',
      localidad: 'Maipú',
      referencia: null,
    });
    expect(mockedRepo.actualizar.mock.calls[0]![1]).toMatchObject({
      lugarLatitud: -32.98,
      lugarLongitud: -68.78,
    });
  });

  it('usa el pin que el usuario vio en el mapa', async () => {
    await editarAviso(
      7,
      { ...SIN_CAMBIOS, localidad: 'Maipú', lugarLatitud: -33, lugarLongitud: -68.7 },
      { usuarioId: DUENO, archivos: [] },
    );

    expect(geocodificarLugar).not.toHaveBeenCalled();
    expect(mockedRepo.actualizar.mock.calls[0]![1]).toMatchObject({
      lugarLatitud: -33,
      lugarLongitud: -68.7,
    });
  });

  it('ubica las fotos nuevas en su lugar y borra las que se sacaron', async () => {
    const nueva = '/api/v1/archivos/perdidos/3.jpg';
    vi.mocked(guardarImagenes).mockResolvedValue([nueva]);
    const archivo = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };

    await editarAviso(
      7,
      { ...SIN_CAMBIOS, imagenes: ['nueva', FOTO_1] },
      {
        usuarioId: DUENO,
        archivos: [archivo],
      },
    );

    expect(mockedRepo.actualizar.mock.calls[0]![1]).toMatchObject({ imagenes: [nueva, FOTO_1] });
    expect(borrarImagenes).toHaveBeenCalledWith([FOTO_2]);
  });

  it('no acepta una foto que no es del aviso', async () => {
    expect(
      await codigo(
        editarAviso(
          7,
          { ...SIN_CAMBIOS, imagenes: ['/api/v1/archivos/perdidos/ajena.jpg'] },
          {
            usuarioId: DUENO,
            archivos: [],
          },
        ),
      ),
    ).toBe('VALIDACION');
    expect(mockedRepo.actualizar).not.toHaveBeenCalled();
  });

  it('exige al menos una foto', async () => {
    expect(
      await codigo(
        editarAviso(7, { ...SIN_CAMBIOS, imagenes: [] }, { usuarioId: DUENO, archivos: [] }),
      ),
    ).toBe('FOTO_REQUERIDA');
  });

  it('deja pasar de Perdido a Encontrado, y ahí el nombre deja de ser obligatorio', async () => {
    await editarAviso(
      7,
      { ...SIN_CAMBIOS, estadoId: ESTADOS.Encontrado.id, nombre: null },
      { usuarioId: DUENO, archivos: [] },
    );

    expect(mockedRepo.actualizar.mock.calls[0]![1]).toMatchObject({
      estadoAnimalPerdidoId: ESTADOS.Encontrado.id,
      nombre: null,
    });
  });

  it('no deja pasar a Resuelto: tiene su propio botón', async () => {
    expect(
      await codigo(
        editarAviso(
          7,
          { ...SIN_CAMBIOS, estadoId: ESTADOS.Resuelto.id },
          {
            usuarioId: DUENO,
            archivos: [],
          },
        ),
      ),
    ).toBe('ESTADO_INVALIDO');
  });

  it('en un caso resuelto se puede editar el resto, pero no el estado', async () => {
    mockedRepo.buscarPorId.mockResolvedValue(aviso({ estadoAnimalPerdido: ESTADOS.Resuelto }));

    await editarAviso(
      7,
      { ...SIN_CAMBIOS, estadoId: ESTADOS.Resuelto.id },
      {
        usuarioId: DUENO,
        archivos: [],
      },
    );
    expect(mockedRepo.actualizar).toHaveBeenCalled();

    expect(
      await codigo(
        editarAviso(
          7,
          { ...SIN_CAMBIOS, estadoId: ESTADOS.Perdido.id },
          {
            usuarioId: DUENO,
            archivos: [],
          },
        ),
      ),
    ).toBe('AVISO_RESUELTO');
  });

  it('sólo lo edita quien lo publicó', async () => {
    expect(await codigo(editarAviso(7, SIN_CAMBIOS, { usuarioId: OTRO, archivos: [] }))).toBe(
      'SIN_PERMISO',
    );
  });

  it('un aviso eliminado no se edita', async () => {
    mockedRepo.buscarPorId.mockResolvedValue(aviso({ fechaBaja: new Date() }));

    expect(await codigo(editarAviso(7, SIN_CAMBIOS, { usuarioId: DUENO, archivos: [] }))).toBe(
      'NO_ENCONTRADO',
    );
  });

  it('si falla la escritura, borra las fotos nuevas', async () => {
    vi.mocked(guardarImagenes).mockResolvedValue(['/api/v1/archivos/perdidos/3.jpg']);
    mockedRepo.actualizar.mockRejectedValue(new Error('base caída'));

    await expect(
      editarAviso(
        7,
        { ...SIN_CAMBIOS, imagenes: ['nueva'] },
        {
          usuarioId: DUENO,
          archivos: [{ buffer: Buffer.from('x'), mimetype: 'image/jpeg' }],
        },
      ),
    ).rejects.toThrow('base caída');
    expect(borrarImagenes).toHaveBeenCalledWith(['/api/v1/archivos/perdidos/3.jpg']);
  });
});

describe('eliminarAviso', () => {
  it('lo da de baja y lo deja en la auditoría', async () => {
    await eliminarAviso(7, DUENO);

    expect(mockedRepo.darDeBajaPorReportante).toHaveBeenCalledWith(7, DUENO);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ELIMINAR', entidad: 'AnimalPerdido', entidadId: 7 }),
    );
  });

  it('no borra las fotos: la tarjeta del chat las sigue mostrando', async () => {
    await eliminarAviso(7, DUENO);

    expect(borrarImagenes).not.toHaveBeenCalled();
  });

  it('un caso resuelto no se elimina, y el mensaje explica por qué', async () => {
    mockedRepo.buscarPorId.mockResolvedValue(aviso({ estadoAnimalPerdido: ESTADOS.Resuelto }));

    await expect(eliminarAviso(7, DUENO)).rejects.toMatchObject({
      codigo: 'AVISO_RESUELTO',
      mensaje: expect.stringContaining('volvió con su dueño'),
    });
    expect(mockedRepo.darDeBajaPorReportante).not.toHaveBeenCalled();
  });

  it('sólo lo elimina quien lo publicó', async () => {
    expect(await codigo(eliminarAviso(7, OTRO))).toBe('SIN_PERMISO');
  });
});
