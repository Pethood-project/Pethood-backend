import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTANTES_REINTENTO_MS,
  programarReintentos,
} from '../../../src/modules/campanias/campanias.reintentos';

let clave = 0;
/** Una clave distinta por test: el registro de reintentos en curso es del módulo. */
const nuevaClave = (): string => `grupo-${++clave}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('programarReintentos (spec 027 §6.5)', () => {
  it('3 veces cada 30 s, y después al minuto, a los 2 y a los 5 (cada uno desde el anterior)', () => {
    expect(INSTANTES_REINTENTO_MS).toEqual([30_000, 60_000, 90_000, 150_000, 270_000, 570_000]);
  });

  it('si nunca aparece, intenta 6 veces en esos instantes y termina', async () => {
    const intentar = vi.fn().mockResolvedValue(0);
    programarReintentos(nuevaClave(), intentar);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(intentar).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1); // 30 s
    expect(intentar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000); // 1 min
    expect(intentar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000); // 1 min 30 s
    expect(intentar).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); // 2 min 30 s
    expect(intentar).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(120_000); // 4 min 30 s
    expect(intentar).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(300_000); // 9 min 30 s
    expect(intentar).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(intentar).toHaveBeenCalledTimes(6);
  });

  it('corta en cuanto confirma', async () => {
    const intentar = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    programarReintentos(nuevaClave(), intentar);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(intentar).toHaveBeenCalledTimes(2);
  });

  it('un intento que tira no frena los siguientes (el cron es el respaldo)', async () => {
    const intentar = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(1);
    programarReintentos(nuevaClave(), intentar);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(intentar).toHaveBeenCalledTimes(2);
  });

  it('no duplica: con reintentos en curso para la misma clave no programa otros', async () => {
    const clave = nuevaClave();
    const primero = vi.fn().mockResolvedValue(0);
    const segundo = vi.fn().mockResolvedValue(0);

    expect(programarReintentos(clave, primero)).toBe(true);
    expect(programarReintentos(clave, segundo)).toBe(false);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(primero).toHaveBeenCalledTimes(6);
    expect(segundo).not.toHaveBeenCalled();
  });

  it('terminados los reintentos, la misma clave se puede volver a programar', async () => {
    const clave = nuevaClave();
    programarReintentos(clave, vi.fn().mockResolvedValue(1));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(programarReintentos(clave, vi.fn().mockResolvedValue(0))).toBe(true);
  });
});
