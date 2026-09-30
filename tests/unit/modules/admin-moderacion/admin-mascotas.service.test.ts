import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/modules/admin-mascotas/admin-mascotas.repository');
vi.mock('../../../../src/shared/logAuditoria', () => ({ registrarAuditoria: vi.fn() }));

import * as repo from '../../../../src/modules/admin-mascotas/admin-mascotas.repository';
import { darDeBaja } from '../../../../src/modules/admin-mascotas/admin-mascotas.service';

beforeEach(() => vi.clearAllMocks());

describe('admin-mascotas.darDeBaja', () => {
  it('rechaza la baja si hay una solicitud abierta', async () => {
    vi.mocked(repo.buscar).mockResolvedValue({ id: 1, fechaBaja: null } as never);
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([
      { historicoEstados: [{ estadoSolicitud: { nombre: 'Pendiente' } }] },
    ] as never);

    await expect(darDeBaja(9, 1, 'falsa')).rejects.toMatchObject({ codigo: 'ADOPCION_EN_CURSO' });
    expect(repo.darDeBajaConPublicaciones).not.toHaveBeenCalled();
  });
});
