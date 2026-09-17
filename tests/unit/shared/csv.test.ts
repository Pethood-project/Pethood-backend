import { describe, expect, it } from 'vitest';
import { escaparCampoCsv, filaCsv } from '../../../src/shared/csv';

describe('escaparCampoCsv', () => {
  it('deja pasar un texto simple sin comillas', () => {
    expect(escaparCampoCsv('Firulais')).toBe('Firulais');
  });

  it('entrecomilla un campo con coma', () => {
    expect(escaparCampoCsv('Mendoza, Argentina')).toBe('"Mendoza, Argentina"');
  });

  it('escapa comillas dobles duplicándolas', () => {
    expect(escaparCampoCsv('Dijo "hola"')).toBe('"Dijo ""hola"""');
  });

  it('entrecomilla un campo con salto de línea', () => {
    expect(escaparCampoCsv('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('null y undefined quedan como campo vacío, no como texto "null"', () => {
    expect(escaparCampoCsv(null)).toBe('');
    expect(escaparCampoCsv(undefined)).toBe('');
  });

  it('serializa Date como ISO', () => {
    const fecha = new Date('2026-08-18T10:00:00.000Z');
    expect(escaparCampoCsv(fecha)).toBe('2026-08-18T10:00:00.000Z');
  });

  it.each([
    // Con coma adentro: además de la comilla de neutralización, entra el quoting normal
    // de CSV (regla de comas ya cubierta arriba) — se suman los dos escapes.
    ['=SUMA(1,1)', `"'=SUMA(1,1)"`],
    ['@SUM(1,1)', `"'@SUM(1,1)"`],
    ['+22', "'+22"],
    ['-22', "'-22"],
  ])('neutraliza fórmula de Excel/Sheets: %s queda como texto plano', (entrada, esperado) => {
    expect(escaparCampoCsv(entrada)).toBe(esperado);
  });

  it('un nombre que arranca con guion (apellido compuesto) no es fórmula pero igual se neutraliza', () => {
    // Trade-off aceptado: "-De la Cruz" no es una fórmula real, pero Excel no distingue
    // el caso y la comilla simple inicial es invisible al abrir el archivo.
    expect(escaparCampoCsv('-De la Cruz')).toBe("'-De la Cruz");
  });

  it('un signo = en medio del texto no dispara el escape (no es el primer caracter)', () => {
    expect(escaparCampoCsv('2 + 2 = 4')).toBe('2 + 2 = 4');
  });
});

describe('filaCsv', () => {
  it('une los campos con coma y termina en salto de línea', () => {
    expect(filaCsv([1, 'Firulais', true])).toBe('1,Firulais,true\n');
  });
});
