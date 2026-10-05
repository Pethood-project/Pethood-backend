import { beforeEach, describe, expect, it, vi } from 'vitest';

const geocode = vi.fn();

vi.mock('node-geocoder', () => ({
  default: vi.fn(() => ({ geocode })),
}));

import {
  construirMapaUrl,
  construirMapaUrlDeBusqueda,
  direccionParaGeocodificar,
  geocodificarDireccion,
  geocodificarLugar,
  textoDeLugar,
} from '../../../src/shared/geocoding';

describe('construirMapaUrl', () => {
  it('arma la URL oficial de Google Maps con las coordenadas', () => {
    expect(construirMapaUrl({ latitud: -32.889, longitud: -68.845 })).toBe(
      'https://www.google.com/maps?q=-32.889,-68.845',
    );
  });
});

describe('direccionParaGeocodificar', () => {
  it('concatena calle, localidad, provincia y país', () => {
    expect(
      direccionParaGeocodificar({
        calleAltura: 'San Martín 123',
        localidad: 'Godoy Cruz',
        provincia: 'Mendoza',
      }),
    ).toBe('San Martín 123, Godoy Cruz, Mendoza, Argentina');
  });
});

describe('geocodificarDireccion', () => {
  const DIRECCION = {
    calleAltura: 'San Martín 123',
    localidad: 'Godoy Cruz',
    provincia: 'Mendoza',
  };

  beforeEach(() => {
    geocode.mockReset();
  });

  it('devuelve coordenadas y URL de Maps cuando el proveedor encuentra la dirección', async () => {
    geocode.mockResolvedValue([{ latitude: -32.889, longitude: -68.845 }]);

    await expect(geocodificarDireccion(DIRECCION)).resolves.toEqual({
      latitud: -32.889,
      longitud: -68.845,
      mapaUrl: 'https://www.google.com/maps?q=-32.889,-68.845',
    });
    expect(geocode).toHaveBeenCalledWith('San Martín 123, Godoy Cruz, Mendoza, Argentina');
  });

  it('devuelve null si el proveedor no encuentra la dirección', async () => {
    geocode.mockResolvedValue([]);

    await expect(geocodificarDireccion(DIRECCION)).resolves.toBeNull();
  });

  it('devuelve null si la geocodificación falla (no rompe el flujo)', async () => {
    geocode.mockRejectedValue(new Error('sin red'));

    await expect(geocodificarDireccion(DIRECCION)).resolves.toBeNull();
  });
});

describe('construirMapaUrlDeBusqueda', () => {
  it('arma una búsqueda de Google Maps con el texto escapado', () => {
    expect(construirMapaUrlDeBusqueda('Godoy Cruz, Mendoza')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Godoy%20Cruz%2C%20Mendoza',
    );
  });
});

describe('textoDeLugar', () => {
  it('concatena referencia, localidad, provincia y país, salteando lo vacío', () => {
    expect(textoDeLugar({ provincia: 'Mendoza', localidad: 'Maipú', referencia: 'Ruta 60' })).toBe(
      'Ruta 60, Maipú, Mendoza, Argentina',
    );
    expect(textoDeLugar({ provincia: 'Mendoza', localidad: 'Maipú', referencia: '  ' })).toBe(
      'Maipú, Mendoza, Argentina',
    );
  });
});

describe('geocodificarLugar', () => {
  const LUGAR = { provincia: 'Mendoza', localidad: 'Maipú', referencia: 'Ruta 60' };

  beforeEach(() => {
    geocode.mockReset();
  });

  it('prueba primero con la referencia', async () => {
    geocode.mockResolvedValue([{ latitude: -32.98, longitude: -68.78 }]);

    await expect(geocodificarLugar(LUGAR)).resolves.toEqual({ latitud: -32.98, longitud: -68.78 });
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith('Ruta 60, Maipú, Mendoza, Argentina');
  });

  it('si la referencia no se encuentra, vuelve a probar sólo con localidad y provincia', async () => {
    geocode
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ latitude: -32.9, longitude: -68.8 }]);

    await expect(geocodificarLugar(LUGAR)).resolves.toEqual({ latitud: -32.9, longitud: -68.8 });
    expect(geocode).toHaveBeenLastCalledWith('Maipú, Mendoza, Argentina');
  });

  it('sin referencia va directo a localidad y provincia', async () => {
    geocode.mockResolvedValue([{ latitude: -32.9, longitude: -68.8 }]);

    await geocodificarLugar({ ...LUGAR, referencia: null });

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith('Maipú, Mendoza, Argentina');
  });

  it('devuelve null si no encuentra nada o falla, sin romper el alta', async () => {
    geocode.mockRejectedValue(new Error('sin red'));

    await expect(geocodificarLugar(LUGAR)).resolves.toBeNull();
  });

  it('no espera más de la cuenta a un proveedor que no responde', async () => {
    vi.useFakeTimers();
    geocode.mockReturnValue(new Promise(() => undefined));

    const resultado = geocodificarLugar({ ...LUGAR, referencia: null });
    await vi.advanceTimersByTimeAsync(6000);

    await expect(resultado).resolves.toBeNull();
    vi.useRealTimers();
  });
});
