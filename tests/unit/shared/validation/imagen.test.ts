import { describe, expect, it } from 'vitest';
import { parsearRecorte, parsearRotacion } from '../../../../src/shared/validation/imagen';

describe('parsearRotacion', () => {
  it('sin valor, devuelve 0 (sin rotación)', () => {
    expect(parsearRotacion(undefined)).toEqual({ valido: true, valor: 0 });
    expect(parsearRotacion('')).toEqual({ valido: true, valor: 0 });
  });

  it('acepta 90, 180 y 270 grados, como string o number', () => {
    expect(parsearRotacion('90')).toEqual({ valido: true, valor: 90 });
    expect(parsearRotacion(180)).toEqual({ valido: true, valor: 180 });
    expect(parsearRotacion('270')).toEqual({ valido: true, valor: 270 });
  });

  it('rechaza ángulos arbitrarios o inválidos', () => {
    expect(parsearRotacion('45').valido).toBe(false);
    expect(parsearRotacion('-90').valido).toBe(false);
    expect(parsearRotacion('mucho').valido).toBe(false);
  });
});

describe('parsearRecorte', () => {
  it('sin ningún campo, devuelve null (sin recorte)', () => {
    expect(parsearRecorte({})).toEqual({ valido: true, valor: null });
  });

  it('con los cuatro campos, arma el rectángulo', () => {
    const resultado = parsearRecorte({
      cropX: '10',
      cropY: '20',
      cropWidth: '100',
      cropHeight: '200',
    });

    expect(resultado).toEqual({
      valido: true,
      valor: { left: 10, top: 20, width: 100, height: 200 },
    });
  });

  it('rechaza un rectángulo a medias', () => {
    const resultado = parsearRecorte({ cropX: '10', cropY: '20' });

    expect(resultado.valido).toBe(false);
  });

  it('rechaza coordenadas negativas o no enteras', () => {
    expect(
      parsearRecorte({ cropX: '-1', cropY: '0', cropWidth: '100', cropHeight: '100' }).valido,
    ).toBe(false);
    expect(
      parsearRecorte({ cropX: '0', cropY: '0', cropWidth: '10.5', cropHeight: '100' }).valido,
    ).toBe(false);
  });

  it('rechaza un recorte más chico que el mínimo', () => {
    const resultado = parsearRecorte({
      cropX: '0',
      cropY: '0',
      cropWidth: '5',
      cropHeight: '5',
    });

    expect(resultado.valido).toBe(false);
  });
});
