import { describe, expect, it } from 'vitest';
import {
  aCodigoVacuna,
  validarVacunaDeMascota,
  vacunasAplicadas,
} from '../../../src/shared/vacunas';

const ANTIRRABICA = { id: 4, codigo: 'ANTIRRABICA', nombre: 'Antirrábica', descripcion: 'x' };
const PRIMOVACUNACION = {
  id: 1,
  codigo: 'PRIMOVACUNACION',
  nombre: 'Primovacunación',
  descripcion: 'y',
};

describe('aCodigoVacuna (spec 029)', () => {
  it('pasa el nombre a mayúsculas, sin tildes y con guiones bajos', () => {
    expect(aCodigoVacuna('Refuerzo Trivalente + Leucemia', [])).toBe(
      'REFUERZO_TRIVALENTE_LEUCEMIA',
    );
    expect(aCodigoVacuna('  Antirrábica  ', [])).toBe('ANTIRRABICA');
  });

  it('suma un sufijo si el código ya existe, aunque sea de una vacuna de baja', () => {
    expect(aCodigoVacuna('Antirrábica', ['ANTIRRABICA'])).toBe('ANTIRRABICA_2');
    expect(aCodigoVacuna('Antirrábica', ['ANTIRRABICA', 'ANTIRRABICA_2'])).toBe('ANTIRRABICA_3');
  });

  it('un nombre sin letras ni números no deja el código vacío', () => {
    expect(aCodigoVacuna('+++', [])).toBe('VACUNA');
  });
});

describe('validarVacunaDeMascota', () => {
  it('sin vacuna del catálogo para la especie, avisa que no corresponde', () => {
    expect(validarVacunaDeMascota(null, new Date(2025, 0, 1), null)).toEqual({
      valida: false,
      error: 'Esa vacuna no corresponde a la especie de la mascota',
    });
  });

  it('rechaza una aplicación anterior al nacimiento', () => {
    const resultado = validarVacunaDeMascota(
      ANTIRRABICA,
      new Date(2024, 0, 1),
      new Date(2025, 0, 1),
    );
    expect(resultado).toMatchObject({ valida: false });
  });

  it('el mismo día del nacimiento es válido', () => {
    const nacio = new Date(2025, 0, 1, 18);
    expect(validarVacunaDeMascota(ANTIRRABICA, new Date(2025, 0, 1, 9), nacio)).toMatchObject({
      valida: true,
    });
  });
});

describe('vacunasAplicadas', () => {
  it('una medalla por vacuna, con la fecha más reciente, en orden de catálogo', () => {
    const medallas = vacunasAplicadas([
      { vacuna: ANTIRRABICA, fechaVisita: new Date(2023, 7, 1) },
      { vacuna: PRIMOVACUNACION, fechaVisita: new Date(2022, 4, 1) },
      { vacuna: ANTIRRABICA, fechaVisita: new Date(2024, 7, 1) },
      { vacuna: null, fechaVisita: new Date(2024, 9, 1) },
    ]);

    expect(medallas).toEqual([
      {
        tipo: 'PRIMOVACUNACION',
        nombre: 'Primovacunación',
        descripcion: 'y',
        fechaAplicacion: '2022-05-01',
      },
      {
        tipo: 'ANTIRRABICA',
        nombre: 'Antirrábica',
        descripcion: 'x',
        fechaAplicacion: '2024-08-01',
      },
    ]);
  });
});
