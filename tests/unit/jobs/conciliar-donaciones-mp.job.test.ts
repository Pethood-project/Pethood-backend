import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conciliarDonacionesMp } from '../../../src/jobs/conciliar-donaciones-mp.job';
import * as campaniasRepo from '../../../src/modules/campanias/campanias.repository';
import * as campaniasService from '../../../src/modules/campanias/campanias.service';
import * as mpService from '../../../src/modules/mercadopago/mercadopago.service';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/modules/campanias/campanias.service');
vi.mock('../../../src/modules/mercadopago/mercadopago.service');
vi.mock('../../../src/shared/storage');

const AHORA = new Date('2026-09-30T15:00:00Z');
const HORAS_72 = 72 * 60 * 60 * 1000;

const GRUPO_A = { refugioId: 3, usuarioId: 7, monto: 5000 };
const GRUPO_B = { refugioId: 4, usuarioId: 8, monto: 1500 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mpService.disponible).mockReturnValue(true);
  vi.mocked(mpService.renovarTokensPorVencer).mockResolvedValue(1);
  vi.mocked(campaniasRepo.gruposConciliables).mockResolvedValue([GRUPO_A, GRUPO_B]);
});

describe('conciliarDonacionesMp', () => {
  it('sin Mercado Pago configurado no toca nada', async () => {
    vi.mocked(mpService.disponible).mockReturnValue(false);

    expect(await conciliarDonacionesMp(AHORA)).toEqual({ renovados: 0, confirmadas: 0 });
    expect(mpService.renovarTokensPorVencer).not.toHaveBeenCalled();
    expect(campaniasRepo.gruposConciliables).not.toHaveBeenCalled();
  });

  it('renueva tokens y concilia cada grupo de las últimas 72 h', async () => {
    vi.mocked(campaniasService.conciliarGrupo).mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    expect(await conciliarDonacionesMp(AHORA)).toEqual({ renovados: 1, confirmadas: 3 });
    expect(mpService.renovarTokensPorVencer).toHaveBeenCalledWith(AHORA);
    expect(campaniasRepo.gruposConciliables).toHaveBeenCalledWith(
      new Date(AHORA.getTime() - HORAS_72),
    );
    expect(campaniasService.conciliarGrupo).toHaveBeenCalledWith(GRUPO_A, AHORA, 15000);
    expect(campaniasService.conciliarGrupo).toHaveBeenCalledWith(GRUPO_B, AHORA, 15000);
  });

  it('un grupo que falla no frena a los demás', async () => {
    vi.mocked(campaniasService.conciliarGrupo)
      .mockRejectedValueOnce(new Error('algo raro'))
      .mockResolvedValueOnce(1);

    expect(await conciliarDonacionesMp(AHORA)).toEqual({ renovados: 1, confirmadas: 1 });
  });
});
