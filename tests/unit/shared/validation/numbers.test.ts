import { describe, expect, it } from 'vitest';
import { parsearDecimal, parsearId } from '../../../../src/shared/validation/numbers';
import { LIMITES } from '../../../../src/shared/validation/limits';

const peso = { ...LIMITES.mascota.peso, etiqueta: 'El peso' };

describe('parsearDecimal', () => {
  it('acepta coma como separador decimal y la normaliza a punto', () => {
    expect(parsearDecimal('12,5', peso)).toEqual({ valido: true, valor: 12.5 });
  });

  it('acepta punto como separador decimal', () => {
    expect(parsearDecimal('12.5', peso)).toEqual({ valido: true, valor: 12.5 });
  });

  it('acepta un entero sin decimales', () => {
    expect(parsearDecimal('5', peso)).toEqual({ valido: true, valor: 5 });
  });

  it('acepta un number además de un string', () => {
    expect(parsearDecimal(8.2, peso)).toEqual({ valido: true, valor: 8.2 });
  });

  it('rechaza más decimales de los permitidos en vez de redondear', () => {
    const resultado = parsearDecimal('12,55', peso);

    expect(resultado).toEqual({
      valido: false,
      error: 'El peso debe ser un número con hasta 1 decimal (ej. 12,5)',
    });
  });

  it('rechaza texto no numérico', () => {
    expect(parsearDecimal('mucho', peso).valido).toBe(false);
  });

  it('rechaza un valor ausente o vacío', () => {
    expect(parsearDecimal('', peso)).toEqual({ valido: false, error: 'El peso es obligatorio' });
    expect(parsearDecimal(undefined, peso).valido).toBe(false);
  });

  it('rechaza valores fuera del rango permitido', () => {
    expect(parsearDecimal('0', peso).valido).toBe(false);
    expect(parsearDecimal('9999', peso).valido).toBe(false);
  });

  it('rechaza un negativo', () => {
    expect(parsearDecimal('-5', peso).valido).toBe(false);
  });
});

describe('parsearId', () => {
  it('acepta enteros positivos, incluso como string', () => {
    expect(parsearId('7')).toBe(7);
    expect(parsearId(7)).toBe(7);
  });

  it('rechaza cero, negativos, decimales y texto', () => {
    expect(parsearId('0')).toBeNull();
    expect(parsearId('-1')).toBeNull();
    expect(parsearId('1.5')).toBeNull();
    expect(parsearId('abc')).toBeNull();
  });
});
