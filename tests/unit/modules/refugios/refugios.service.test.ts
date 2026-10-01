import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/refugios/refugios.repository', () => ({
  buscarRefugio: vi.fn(),
  contarPublicacionesActivas: vi.fn(),
  buscarUsuario: vi.fn(),
}));
vi.mock('../../../../src/modules/resenas/resenas.service', () => ({
  listarDeRefugio: vi.fn(),
}));

import * as repo from '../../../../src/modules/refugios/refugios.repository';
import { obtenerPerfilPublico } from '../../../../src/modules/refugios/refugios.service';
import * as resenas from '../../../../src/modules/resenas/resenas.service';

const mockedRepo = vi.mocked(repo);

function refugio(cambios: Record<string, unknown> = {}) {
  return {
    id: 1,
    nombre: 'Patitas',
    descripcion: 'Rescate de perros',
    imagenUrl: null,
    verificado: true,
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    calleAltura: 'San Martín 123',
    mapaUrl: 'https://maps.example/x',
    fechaAlta: new Date('2026-01-10T00:00:00Z'),
    estado: { nombre: 'Activo' },
    ...cambios,
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedRepo.contarPublicacionesActivas.mockResolvedValue(8);
  mockedRepo.buscarUsuario.mockResolvedValue({ id: 7, refugioId: null } as never);
  vi.mocked(resenas.listarDeRefugio).mockResolvedValue({
    promedio: 4.5,
    cantidad: 12,
    distribucion: [],
    resenas: [],
  });
});

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as { codigo: string }).codigo;
  }
  return 'SIN_ERROR';
}

describe('obtenerPerfilPublico (refugio)', () => {
  it('arma el perfil con el resumen de publicaciones y reputación, sin teléfono ni email', async () => {
    mockedRepo.buscarRefugio.mockResolvedValue(refugio());

    const perfil = await obtenerPerfilPublico(1, 7);

    expect(perfil).toMatchObject({
      id: 1,
      nombre: 'Patitas',
      resumen: { publicacionesActivas: 8, resenas: { promedio: 4.5, cantidad: 12 } },
      esMiembro: false,
    });
    expect(perfil).not.toHaveProperty('telefono');
    expect(perfil).not.toHaveProperty('email');
  });

  it('esMiembro es true para quien pertenece al refugio', async () => {
    mockedRepo.buscarRefugio.mockResolvedValue(refugio());
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 7, refugioId: 1 } as never);

    expect((await obtenerPerfilPublico(1, 7)).esMiembro).toBe(true);
  });

  it('responde NO_ENCONTRADO si el refugio no existe o está de baja', async () => {
    mockedRepo.buscarRefugio.mockResolvedValue(null);

    expect(await codigo(obtenerPerfilPublico(9, 7))).toBe('NO_ENCONTRADO');
  });

  it.each(['Pendiente_Verificacion', 'Suspendido', 'Inactivo'])(
    'no muestra un refugio %s',
    async (estado) => {
      mockedRepo.buscarRefugio.mockResolvedValue(refugio({ estado: { nombre: estado } }));

      expect(await codigo(obtenerPerfilPublico(1, 7))).toBe('NO_ENCONTRADO');
    },
  );
});
