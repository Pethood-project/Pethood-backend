import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/admin-catalogos/admin-catalogos.repository');
vi.mock('../../../../src/shared/logAuditoria', () => ({ registrarAuditoria: vi.fn() }));

import * as repo from '../../../../src/modules/admin-catalogos/admin-catalogos.repository';
import { darDeBaja } from '../../../../src/modules/admin-catalogos/admin-catalogos.service';

function fila(usos: number, fechaBaja: Date | null = null) {
  return { id: 1, nombre: 'X', fechaAlta: new Date(), fechaBaja, _count: { razas: usos } };
}

beforeEach(() => vi.clearAllMocks());

describe('admin-catalogos.darDeBaja', () => {
  it('rechaza con CATALOGO_EN_USO si el valor tiene registros activos', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(fila(3) as never);
    await expect(darDeBaja(9, 'especies', 1)).rejects.toMatchObject({
      codigo: 'CATALOGO_EN_USO',
      httpStatus: 409,
    });
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });

  it('rechaza con CATALOGO_SIN_BAJA en un catálogo de estados aunque no tenga usos', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(fila(0) as never);
    await expect(darDeBaja(9, 'estados-mascota', 1)).rejects.toMatchObject({
      codigo: 'CATALOGO_SIN_BAJA',
    });
  });

  it('da de baja un valor sin usos', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(fila(0) as never);
    vi.mocked(repo.darDeBaja).mockResolvedValue(fila(0, new Date()) as never);
    await darDeBaja(9, 'especies', 1);
    expect(repo.darDeBaja).toHaveBeenCalledWith('especies', 1, 9);
  });
});
