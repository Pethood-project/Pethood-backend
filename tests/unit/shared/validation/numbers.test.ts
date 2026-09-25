import { describe, expect, it } from 'vitest';
import {
  parsearDecimal,
  parsearId,
  parsearListaDeIds,
} from '../../../../src/shared/validation/numbers';
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

describe('parsearListaDeIds', () => {
  it('ausente o vacía es "sin filtro"', () => {
    expect(parsearListaDeIds(undefined, 'El estado')).toEqual({ valido: true, valor: [] });
    expect(parsearListaDeIds('', 'El estado')).toEqual({ valido: true, valor: [] });
  });

  it('separa por comas, tolera espacios y descarta repetidos', () => {
    expect(parsearListaDeIds('1, 3,1', 'El estado')).toEqual({ valido: true, valor: [1, 3] });
  });

  it('rechaza la lista entera si un elemento no es un id', () => {
    for (const valor of ['1,x', '1,,3', '0', '-2', '1.5']) {
      expect(parsearListaDeIds(valor, 'El estado')).toEqual({
        valido: false,
        error: 'El estado no es válido',
      });
    }
  });

  it('rechaza un parámetro repetido (llega como array)', () => {
    expect(parsearListaDeIds(['1', '2'], 'El estado').valido).toBe(false);
  });
});
