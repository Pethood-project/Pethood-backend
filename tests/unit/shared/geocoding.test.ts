import { beforeEach, describe, expect, it, vi } from 'vitest';

const geocode = vi.fn();

vi.mock('node-geocoder', () => ({
  default: vi.fn(() => ({ geocode })),
}));

import {
  construirMapaUrl,
  direccionParaGeocodificar,
  geocodificarDireccion,
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
  const DIRECCION = { calleAltura: 'San Martín 123', localidad: 'Godoy Cruz', provincia: 'Mendoza' };

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