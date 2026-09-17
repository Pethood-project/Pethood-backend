import { describe, expect, it } from 'vitest';
import {
  aFechaISO,
  esAnteriorAlAnioMinimo,
  esFutura,
  esPasada,
  parsearFecha,
  validarFechaPasada,
} from '../../../../src/shared/validation/dates';

describe('parsearFecha', () => {
  it('interpreta AAAA-MM-DD como medianoche local, no UTC', () => {
    const fecha = parsearFecha('2022-03-15')!;

    // Sin esto, en timezones negativas la fecha se corre un día para atrás.
    expect(fecha.getFullYear()).toBe(2022);
    expect(fecha.getMonth()).toBe(2);
    expect(fecha.getDate()).toBe(15);
  });

  it('devuelve null para vacío, null, undefined y texto no parseable', () => {
    expect(parsearFecha('')).toBeNull();
    expect(parsearFecha(null)).toBeNull();
    expect(parsearFecha(undefined)).toBeNull();
    expect(parsearFecha('no es una fecha')).toBeNull();
  });

  it('devuelve null para un Date inválido', () => {
    expect(parsearFecha(new Date('roto'))).toBeNull();
  });

  it('deja pasar un Date válido tal cual', () => {
    const original = new Date(2020, 0, 5);
    expect(parsearFecha(original)).toBe(original);
  });
});

describe('esFutura / esPasada', () => {
  const hoy = new Date(2026, 7, 13, 10, 0, 0);

  it('una fecha de hoy no es futura sin importar la hora', () => {
    expect(esFutura(new Date(2026, 7, 13, 23, 0, 0), hoy)).toBe(false);
  });

  it('mañana sí es futura', () => {
    expect(esFutura(new Date(2026, 7, 14), hoy)).toBe(true);
  });

  it('una fecha de hoy no es pasada', () => {
    expect(esPasada(new Date(2026, 7, 13, 0, 0, 0), hoy)).toBe(false);
  });

  it('ayer sí es pasada', () => {
    expect(esPasada(new Date(2026, 7, 12), hoy)).toBe(true);
  });
});

describe('esAnteriorAlAnioMinimo', () => {
  it('rechaza años previos a 1900 y acepta 1900 en adelante', () => {
    expect(esAnteriorAlAnioMinimo(new Date(1899, 11, 31))).toBe(true);
    expect(esAnteriorAlAnioMinimo(new Date(1900, 0, 1))).toBe(false);
  });
});

describe('aFechaISO', () => {
  it('formatea en hora local con ceros a la izquierda', () => {
    expect(aFechaISO(new Date(2024, 0, 5))).toBe('2024-01-05');
  });
});

describe('validarFechaPasada', () => {
  it('acepta una fecha pasada válida', () => {
    const resultado = validarFechaPasada('2022-03-15', 'La fecha de nacimiento');

    expect(resultado.valida).toBe(true);
  });

  it('rechaza una fecha futura', () => {
    const anioProximo = new Date().getFullYear() + 1;
    const resultado = validarFechaPasada(`${anioProximo}-01-01`, 'La fecha de nacimiento');

    expect(resultado).toEqual({
      valida: false,
      error: 'La fecha de nacimiento no puede ser futura',
    });
  });

  it('rechaza una fecha anterior a 1900', () => {
    const resultado = validarFechaPasada('1850-01-01', 'La fecha de nacimiento');

    expect(resultado).toEqual({
      valida: false,
      error: 'La fecha de nacimiento no puede ser anterior a 1900',
    });
  });

  it('rechaza un valor no parseable', () => {
    const resultado = validarFechaPasada('cualquier cosa', 'La fecha de nacimiento');

    expect(resultado).toEqual({ valida: false, error: 'La fecha de nacimiento no es válida' });
  });
});
