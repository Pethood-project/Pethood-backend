import { describe, expect, it } from 'vitest';
import { aRefugioDeSesion } from '../../../src/shared/refugioSesion';

describe('aRefugioDeSesion', () => {
  const base = { id: 3, nombre: 'Patitas', fechaBaja: null, estado: { nombre: 'Activo' } };

  it('null si no pertenece a ningún refugio', () => {
    expect(aRefugioDeSesion(null)).toBeNull();
  });

  it('expone el estado del refugio', () => {
    expect(aRefugioDeSesion({ ...base, estado: { nombre: 'Pendiente_Verificacion' } })).toEqual({
      id: 3,
      nombre: 'Patitas',
      estado: 'Pendiente_Verificacion',
    });
  });

  it('una baja lógica cuenta como Inactivo', () => {
    expect(aRefugioDeSesion({ ...base, fechaBaja: new Date() })?.estado).toBe('Inactivo');
  });
});
