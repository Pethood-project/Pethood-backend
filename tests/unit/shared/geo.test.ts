import { describe, expect, it } from 'vitest';
import {
  coordenadasDeMapsUrl,
  distanciaKm,
  distanciaKmTexto,
  esLinkCortoDeMaps,
  resolverCoordenadasDeMapsUrl,
} from '../../../src/shared/geo';

describe('coordenadasDeMapsUrl', () => {
  it('extrae coordenadas del formato @lat,lng', () => {
    expect(coordenadasDeMapsUrl('https://www.google.com/maps/@-32.889,-68.845,15z')).toEqual({
      latitud: -32.889,
      longitud: -68.845,
    });
  });

  it('extrae coordenadas del formato !3d..!4d..', () => {
    expect(
      coordenadasDeMapsUrl('https://www.google.com/maps/place/X/data=!3d-34.6!4d-58.38'),
    ).toEqual({ latitud: -34.6, longitud: -58.38 });
  });

  it('extrae coordenadas del query ?q=lat,lng', () => {
    expect(coordenadasDeMapsUrl('https://maps.google.com/?q=-32.89,-68.84')).toEqual({
      latitud: -32.89,
      longitud: -68.84,
    });
  });

  it('devuelve null si el link no tiene coordenadas (acortador)', () => {
    expect(coordenadasDeMapsUrl('https://maps.app.goo.gl/abc123')).toBeNull();
  });

  it('devuelve null si no se le pasa link', () => {
    expect(coordenadasDeMapsUrl(null)).toBeNull();
  });

  it('rechaza pares de números fuera del rango geográfico', () => {
    expect(coordenadasDeMapsUrl('https://www.google.com/maps/@999,999,15z')).toBeNull();
  });
});

describe('esLinkCortoDeMaps', () => {
  it('reconoce los acortadores de Google Maps', () => {
    expect(esLinkCortoDeMaps('https://maps.app.goo.gl/HpdJo4NGsPVy3Zc8A')).toBe(true);
    expect(esLinkCortoDeMaps('https://goo.gl/maps/abc')).toBe(true);
  });

  it('no marca los links completos', () => {
    expect(esLinkCortoDeMaps('https://www.google.com/maps/@-32.8,-68.8,15z')).toBe(false);
  });
});

describe('resolverCoordenadasDeMapsUrl', () => {
  it('resuelve un link corto siguiendo la redirección y saca las coordenadas de la URL final', async () => {
    const resolutor = async (): Promise<{ url: string }> => ({
      url: 'https://www.google.com/maps/place/Refugio/@-32.889,-68.845,17z',
    });

    await expect(
      resolverCoordenadasDeMapsUrl('https://maps.app.goo.gl/CortoA', resolutor),
    ).resolves.toEqual({ latitud: -32.889, longitud: -68.845 });
  });

  it('no toca la red cuando el link ya trae coordenadas', async () => {
    let llamado = false;
    const resolutor = async (): Promise<{ url: string }> => {
      llamado = true;
      return { url: '' };
    };

    await expect(
      resolverCoordenadasDeMapsUrl('https://www.google.com/maps/@1.5,2.5,15z', resolutor),
    ).resolves.toEqual({ latitud: 1.5, longitud: 2.5 });
    expect(llamado).toBe(false);
  });

  it('devuelve null si la resolución falla (sin cachear el error)', async () => {
    const resolutor = async (): Promise<{ url: string }> => {
      throw new Error('sin red');
    };

    await expect(
      resolverCoordenadasDeMapsUrl('https://maps.app.goo.gl/CortoError', resolutor),
    ).resolves.toBeNull();
  });
});

describe('distanciaKm', () => {
  it('calcula una distancia razonable entre dos puntos de Mendoza', () => {
    const distancia = distanciaKm(
      { latitud: -32.889, longitud: -68.845 },
      { latitud: -32.905, longitud: -68.83 },
    );

    // ~2 km entre esos dos puntos.
    expect(distancia).toBeGreaterThan(1);
    expect(distancia).toBeLessThan(4);
  });

  it('da 0 para el mismo punto', () => {
    expect(distanciaKm({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 0 })).toBe(0);
  });
});

describe('distanciaKmTexto', () => {
  it('formatea la distancia con coma decimal, lista para la ficha', () => {
    const texto = distanciaKmTexto(
      { latitud: -32.889, longitud: -68.845 },
      { latitud: -32.905, longitud: -68.83 },
    );

    expect(texto).toMatch(/^A \d,\d km$/);
  });

  it('devuelve null si falta alguna de las dos ubicaciones', () => {
    expect(distanciaKmTexto(null, { latitud: 1, longitud: 2 })).toBeNull();
    expect(distanciaKmTexto({ latitud: 1, longitud: 2 }, null)).toBeNull();
  });
});
