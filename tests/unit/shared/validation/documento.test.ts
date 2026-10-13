import { describe, expect, it } from 'vitest';
import {
  dniDesdeIdentificacion,
  normalizarDni,
  validarDni,
} from '../../../../src/shared/validation/documento';

describe('validarDni', () => {
  it('acepta 7 u 8 dígitos, con trim', () => {
    expect(validarDni(' 30123456 ')).toEqual({ valido: true, valor: '30123456' });
    expect(validarDni('7123456')).toEqual({ valido: true, valor: '7123456' });
  });

  it('vacío es obligatorio', () => {
    expect(validarDni('')).toEqual({ valido: false, error: 'El DNI es obligatorio.' });
    expect(validarDni(undefined)).toEqual({ valido: false, error: 'El DNI es obligatorio.' });
  });

  it('rechaza otro largo, puntos o letras', () => {
    const error = { valido: false, error: 'El DNI debe tener 7 u 8 dígitos numéricos.' };
    expect(validarDni('123456')).toEqual(error);
    expect(validarDni('30.123.456')).toEqual(error);
    expect(validarDni('3012345A')).toEqual(error);
  });
});

describe('dniDesdeIdentificacion', () => {
  it('saca el DNI de los 8 dígitos del medio de un CUIL o CUIT', () => {
    expect(dniDesdeIdentificacion('CUIL', '20301234569')).toBe('30123456');
    expect(dniDesdeIdentificacion('CUIT', 27301234560)).toBe('30123456');
  });

  it('un DNI de 7 dígitos va con cero adelante en el CUIL y se compara sin él', () => {
    expect(dniDesdeIdentificacion('CUIL', '20071234563')).toBe('7123456');
  });

  it('acepta el DNI directo', () => {
    expect(dniDesdeIdentificacion('DNI', '30123456')).toBe('30123456');
  });

  it('null si no se puede sacar un DNI', () => {
    expect(dniDesdeIdentificacion('CUIL', '123')).toBeNull();
    expect(dniDesdeIdentificacion('PASAPORTE', 'AB123')).toBeNull();
    expect(dniDesdeIdentificacion(null, null)).toBeNull();
  });
});

describe('normalizarDni', () => {
  it('quita ceros a la izquierda para comparar', () => {
    expect(normalizarDni('07123456')).toBe('7123456');
  });
});
