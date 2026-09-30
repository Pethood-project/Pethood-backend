import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transicionarEstadosCampanias } from '../../../src/jobs/transicion-estados-campana.job';
import * as repo from '../../../src/modules/campanias/campanias.repository';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/shared/logAuditoria');
// El job importa `idsEstadosCampania` del servicio, que importa storage: sin mock, cargaría
// la configuración de R2/disco en el test.
vi.mock('../../../src/shared/storage');

const AHORA = new Date(2026, 8, 30, 3, 0, 0);
const ESTADOS = [
  { id: 1, nombre: 'Inactiva' },
  { id: 2, nombre: 'Activa' },
  { id: 3, nombre: 'Finalizada' },
  { id: 4, nombre: 'Cancelada' },
];

function dia(offset: number): Date {
  return new Date(2026, 8, 30 + offset);
}

function fila(id: number, estado: string, fechaInicio: Date, fechaFin: Date, objetivo = 100000) {
  return {
    id,
    objetivo: new Prisma.Decimal(objetivo),
    fechaInicio,
    fechaFin,
    estadoCampania: { nombre: estado },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS);
  vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(true);
  vi.mocked(repo.resumirDonaciones).mockImplementation(
    async (ids) => new Map(ids.map((id) => [id, { recaudado: 0, donantes: 0, pendientes: 0 }])),
  );
});

it('tira si falta un estado en el catálogo', async () => {
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS.slice(0, 3));
  vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([]);

  await expect(transicionarEstadosCampanias(AHORA)).rejects.toThrow(
    'Falta el estado "Cancelada" en el catálogo EstadoCampania',
  );
});

describe('transiciones', () => {
  it('activa las que empiezan hoy y finaliza las vencidas, como SISTEMA', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([
      fila(1, 'Inactiva', dia(0), dia(30)),
      fila(2, 'Activa', dia(-30), dia(-1)),
      fila(3, 'Inactiva', dia(1), dia(30)),
    ]);

    const resultado = await transicionarEstadosCampanias(AHORA);

    expect(resultado).toEqual({ activadas: 1, finalizadas: 1 });
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(1, 1, 2, USUARIO_SISTEMA_ID);
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(2, 2, 3, USUARIO_SISTEMA_ID);
    expect(repo.cambiarEstadoSi).toHaveBeenCalledTimes(2);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: USUARIO_SISTEMA_ID, entidad: 'Campania', entidadId: 2 }),
    );
  });

  it('finaliza la que alcanzó el objetivo', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([fila(5, 'Activa', dia(-3), dia(30))]);
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(
      new Map([[5, { recaudado: 100000, donantes: 4, pendientes: 0 }]]),
    );

    expect(await transicionarEstadosCampanias(AHORA)).toEqual({ activadas: 0, finalizadas: 1 });
  });

  it('carrera con el refugio: si ya cambió, la saltea sin error ni auditoría', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([
      fila(2, 'Activa', dia(-30), dia(-1)),
    ]);
    vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(false);

    expect(await transicionarEstadosCampanias(AHORA)).toEqual({ activadas: 0, finalizadas: 0 });
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
