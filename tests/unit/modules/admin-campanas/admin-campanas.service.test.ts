import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/admin-campanas/admin-campanas.repository', () => ({
  listar: vi.fn(),
  buscar: vi.fn(),
  resumenDonaciones: vi.fn(),
}));

import * as repo from '../../../../src/modules/admin-campanas/admin-campanas.repository';
import * as service from '../../../../src/modules/admin-campanas/admin-campanas.service';

const mockedRepo = vi.mocked(repo);

const campana = {
  id: 7,
  titulo: 'Vacunas',
  descripcion: 'Para todos',
  objetivo: { toString: () => '5000.00' },
  fechaInicio: new Date('2026-01-01'),
  fechaFin: new Date('2026-02-01'),
  imagenUrl: null,
  fechaAlta: new Date('2025-12-01'),
  estadoCampania: { id: 2, nombre: 'Activa' },
  refugio: { id: 3, nombre: 'Patitas' },
};

beforeEach(() => vi.clearAllMocks());

describe('admin-campanas', () => {
  it('listar mapea items y pagina', async () => {
    mockedRepo.listar.mockResolvedValue({ items: [campana], total: 1 } as never);

    const r = await service.listar({ page: 1, limit: 10 });

    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ id: 7, objetivo: '5000.00', refugio: { id: 3 } });
  });

  it('obtener suma donaciones declaradas', async () => {
    mockedRepo.buscar.mockResolvedValue(campana as never);
    mockedRepo.resumenDonaciones.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { monto: { toString: () => '300.00' } },
    } as never);

    const r = await service.obtener(7);

    expect(r.donaciones).toEqual({ cantidad: 2, montoDeclarado: '300.00' });
    expect(r.descripcion).toBe('Para todos');
  });

  it('obtener sin donaciones devuelve monto 0', async () => {
    mockedRepo.buscar.mockResolvedValue(campana as never);
    mockedRepo.resumenDonaciones.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { monto: null },
    } as never);

    expect((await service.obtener(7)).donaciones).toEqual({ cantidad: 0, montoDeclarado: '0' });
  });

  it('obtener inexistente lanza 404', async () => {
    mockedRepo.buscar.mockResolvedValue(null);

    await expect(service.obtener(99)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
