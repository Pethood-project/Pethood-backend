import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/animales-perdidos/animales-perdidos.repository', () => ({
  buscarParaModeracion: vi.fn(),
  darDeBajaPorModeracion: vi.fn(),
}));
vi.mock('../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../src/modules/animales-perdidos/animales-perdidos.repository';
import { darDeBajaPorAdmin } from '../../../src/modules/animales-perdidos/animales-perdidos.service';

const mockedRepo = vi.mocked(repo);

beforeEach(() => vi.resetAllMocks());

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as { codigo: string }).codigo;
  }
  return 'SIN_ERROR';
}

describe('darDeBajaPorAdmin (aviso de mascota perdida)', () => {
  it('da de baja el aviso y avisa a quien lo publicó con el motivo', async () => {
    mockedRepo.buscarParaModeracion.mockResolvedValue({
      id: 4,
      nombre: 'Firu',
      descripcion: 'Perro',
      usuarioReportanteId: 3,
      fechaBaja: null,
    } as never);

    await darDeBajaPorAdmin(99, 4, 'Aviso falso');

    expect(mockedRepo.darDeBajaPorModeracion).toHaveBeenCalledWith({
      id: 4,
      adminId: 99,
      duenoId: 3,
      mensajeAviso: 'Un administrador dio de baja tu aviso «Firu». Motivo: Aviso falso',
    });
  });

  it('responde NO_ENCONTRADO si no existe', async () => {
    mockedRepo.buscarParaModeracion.mockResolvedValue(null);

    expect(await codigo(darDeBajaPorAdmin(99, 4, 'x'))).toBe('NO_ENCONTRADO');
  });

  it('no da de baja dos veces', async () => {
    mockedRepo.buscarParaModeracion.mockResolvedValue({
      id: 4,
      nombre: null,
      descripcion: 'Perro',
      usuarioReportanteId: 3,
      fechaBaja: new Date(),
    } as never);

    expect(await codigo(darDeBajaPorAdmin(99, 4, 'x'))).toBe('AVISO_DE_BAJA');
    expect(mockedRepo.darDeBajaPorModeracion).not.toHaveBeenCalled();
  });
});
