import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import { parsearFechaNacimiento } from '../../../src/shared/fechas';

describe('parsearFechaNacimiento', () => {
  it('acepta DD/MM/AAAA válido', () => {
    const fecha = parsearFechaNacimiento('20/05/1995');
    expect(fecha.getUTCFullYear()).toBe(1995);
    expect(fecha.getUTCMonth()).toBe(4);
    expect(fecha.getUTCDate()).toBe(20);
  });

  it('rechaza una fecha inexistente', () => {
    expect(() => parsearFechaNacimiento('31/02/2000')).toThrow(AppError);
  });

  it('rechaza una fecha futura', () => {
    expect(() => parsearFechaNacimiento('01/01/2999')).toThrow(AppError);
  });

  it('rechaza la fecha de hoy', () => {
    const hoy = new Date();
    const dd = String(hoy.getUTCDate()).padStart(2, '0');
    const mm = String(hoy.getUTCMonth() + 1).padStart(2, '0');
    const aaaa = String(hoy.getUTCFullYear());
    expect(() => parsearFechaNacimiento(`${dd}/${mm}/${aaaa}`)).toThrow(AppError);
  });

  it('acepta una fecha anterior a hoy', () => {
    const ayer = new Date();
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const dd = String(ayer.getUTCDate()).padStart(2, '0');
    const mm = String(ayer.getUTCMonth() + 1).padStart(2, '0');
    const aaaa = String(ayer.getUTCFullYear());
    expect(() => parsearFechaNacimiento(`${dd}/${mm}/${aaaa}`)).not.toThrow();
  });
});
