import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/usuarios/usuarios.repository', () => ({
  buscarPerfilPublico: vi.fn(),
}));
vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/shared/imagenPerfil', () => ({ persistirImagenPerfil: vi.fn() }));

import * as repo from '../../../../src/modules/usuarios/usuarios.repository';
import { obtenerPerfilPublico } from '../../../../src/modules/usuarios/usuarios.service';

const mockedRepo = vi.mocked(repo);

function fila(cambios: Record<string, unknown> = {}) {
  return {
    id: 3,
    nombre: 'Ana',
    apellido: 'Pérez',
    email: 'ana@pethood.test',
    imagenUrl: null,
    verificado: true,
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    fechaAlta: new Date('2026-03-02T00:00:00Z'),
    estado: { nombre: 'Activo' },
    ...cambios,
  } as never;
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as { codigo: string }).codigo;
  }
  return 'SIN_ERROR';
}

beforeEach(() => vi.resetAllMocks());

describe('obtenerPerfilPublico (persona)', () => {
  it('devuelve solo los datos públicos, sin email ni contacto', async () => {
    mockedRepo.buscarPerfilPublico.mockResolvedValue(fila());

    const perfil = await obtenerPerfilPublico(3, 7);

    expect(perfil).toEqual({
      id: 3,
      nombre: 'Ana',
      apellido: 'Pérez',
      imagenUrl: null,
      verificado: true,
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      fechaAlta: '2026-03-02T00:00:00.000Z',
      esPropio: false,
    });
    expect(perfil).not.toHaveProperty('email');
  });

  it('marca esPropio cuando quien consulta es la misma persona', async () => {
    mockedRepo.buscarPerfilPublico.mockResolvedValue(fila());

    expect((await obtenerPerfilPublico(3, 3)).esPropio).toBe(true);
  });

  it('responde NO_ENCONTRADO si no existe o está dado de baja', async () => {
    mockedRepo.buscarPerfilPublico.mockResolvedValue(null);

    expect(await codigo(obtenerPerfilPublico(99, 7))).toBe('NO_ENCONTRADO');
  });

  it.each(['Suspendido', 'Inactivo'])('responde NO_ENCONTRADO si está %s', async (estado) => {
    mockedRepo.buscarPerfilPublico.mockResolvedValue(fila({ estado: { nombre: estado } }));

    expect(await codigo(obtenerPerfilPublico(3, 7))).toBe('NO_ENCONTRADO');
  });

  it('no muestra al usuario SISTEMA', async () => {
    mockedRepo.buscarPerfilPublico.mockResolvedValue(fila({ email: 'sistema@pethood.internal' }));

    expect(await codigo(obtenerPerfilPublico(1, 7))).toBe('NO_ENCONTRADO');
  });
});
