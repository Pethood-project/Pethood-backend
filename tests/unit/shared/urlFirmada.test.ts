import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  esRutaPrivada,
  firmarUrlArchivo,
  firmarUrlsArchivo,
  normalizarRutaArchivo,
  verificarFirma,
} from '../../../src/shared/urlFirmada';

const CHAT = '/api/v1/archivos/chats/abc.mp4';
const MASCOTA = '/api/v1/archivos/mascotas/abc.jpg';

/** Saca `exp` y `sig` de una URL firmada. */
function partes(url: string): { ruta: string; exp: string; sig: string } {
  const [base, query] = url.split('?');
  const params = new URLSearchParams(query);
  return {
    ruta: base!.replace('/api/v1/archivos', ''),
    exp: params.get('exp')!,
    sig: params.get('sig')!,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('esRutaPrivada', () => {
  it('son privadas las tres subcarpetas que no se muestran en público', () => {
    expect(esRutaPrivada('/chats/abc.mp4')).toBe(true);
    expect(esRutaPrivada('/historias-clinicas/abc.pdf')).toBe(true);
    expect(esRutaPrivada('/seguimientos/abc.jpg')).toBe(true);
  });

  it('no son privadas las que se muestran en el feed o en el perfil', () => {
    expect(esRutaPrivada('/mascotas/abc.jpg')).toBe(false);
    expect(esRutaPrivada('/publicaciones/abc.jpg')).toBe(false);
    expect(esRutaPrivada('/perfiles/abc.jpg')).toBe(false);
  });

  it('una subcarpeta desconocida se trata como pública', () => {
    // Es el comportamiento histórico. Sumar una privada nueva es agregarla a la lista.
    expect(esRutaPrivada('/loquesea/abc.jpg')).toBe(false);
  });
});

describe('firmarUrlArchivo', () => {
  it('firma las privadas y deja intactas las públicas', () => {
    expect(firmarUrlArchivo(CHAT)).toMatch(/\?exp=\d+&sig=[0-9a-f]{32}$/);
    expect(firmarUrlArchivo(MASCOTA)).toBe(MASCOTA);
  });

  it('un registro sin archivo sigue sin archivo', () => {
    expect(firmarUrlArchivo(null)).toBeNull();
    expect(firmarUrlArchivo(undefined)).toBeNull();
    expect(firmarUrlArchivo('')).toBeNull();
  });

  it('una URL absoluta pasa de largo', () => {
    // Es de R2: la sirve Cloudflare y no pasa por este servidor, así que esta firma no
    // aplica. Es la brecha conocida que hay que cerrar antes de activar R2.
    const r2 = 'https://cdn.pethood.test/chats/abc.mp4';
    expect(firmarUrlArchivo(r2)).toBe(r2);
  });

  it('la firma vale para el archivo que firmó, no para otro', () => {
    const { exp, sig } = partes(firmarUrlArchivo(CHAT)!);

    expect(verificarFirma('/chats/abc.mp4', exp, sig)).toBe(true);
    // La misma firma en otro archivo de la misma carpeta no sirve.
    expect(verificarFirma('/chats/otro.mp4', exp, sig)).toBe(false);
  });

  it('firmarUrlsArchivo conserva el orden', () => {
    const firmadas = firmarUrlsArchivo([CHAT, MASCOTA]);

    expect(firmadas[0]).toMatch(/^\/api\/v1\/archivos\/chats\/abc\.mp4\?exp=/);
    expect(firmadas[1]).toBe(MASCOTA);
  });
});

describe('la firma es estable dentro de la ventana', () => {
  it('dos respuestas seguidas devuelven la MISMA url', () => {
    // Si cambiara en cada request, el cliente volvería a descargar la misma foto —o el
    // mismo video de 30 MB— cada vez, porque su caché indexa por URL.
    vi.useFakeTimers();
    // Las dos horas caen en la misma ventana de 6 h (06:00–12:00).
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'));
    const primera = firmarUrlArchivo(CHAT);

    vi.setSystemTime(new Date('2026-09-24T11:00:00Z'));
    expect(firmarUrlArchivo(CHAT)).toBe(primera);
  });

  it('pasada la ventana, la url cambia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
    const primera = firmarUrlArchivo(CHAT);

    vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
    expect(firmarUrlArchivo(CHAT)).not.toBe(primera);
  });

  it('una url recién emitida tiene al menos una ventana entera de vida', () => {
    vi.useFakeTimers();
    // Justo antes del corte de ventana: es el caso que el redondeo tiene que cubrir.
    vi.setSystemTime(new Date('2026-09-24T11:59:59Z'));
    const { exp } = partes(firmarUrlArchivo(CHAT)!);

    expect(Number(exp) - Date.now()).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});

describe('verificarFirma', () => {
  it('rechaza una firma vencida', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
    const { ruta, exp, sig } = partes(firmarUrlArchivo(CHAT)!);

    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    expect(verificarFirma(ruta, exp, sig)).toBe(false);
  });

  it('rechaza una firma inventada', () => {
    const { ruta, exp } = partes(firmarUrlArchivo(CHAT)!);

    expect(verificarFirma(ruta, exp, 'f'.repeat(32))).toBe(false);
  });

  it('rechaza si falta exp o sig', () => {
    expect(verificarFirma('/chats/abc.mp4', undefined, undefined)).toBe(false);
    expect(verificarFirma('/chats/abc.mp4', '99999999999999', undefined)).toBe(false);
  });

  it('rechaza un exp que no es un número', () => {
    const { ruta, sig } = partes(firmarUrlArchivo(CHAT)!);

    expect(verificarFirma(ruta, 'mañana', sig)).toBe(false);
  });

  it('rechaza un exp estirado a mano para durar más', () => {
    // El vencimiento está DENTRO de lo firmado: cambiarlo invalida la firma.
    const { ruta, exp, sig } = partes(firmarUrlArchivo(CHAT)!);

    expect(verificarFirma(ruta, String(Number(exp) + 999_999), sig)).toBe(false);
  });

  it('rechaza una firma de largo distinto sin romperse', () => {
    const { ruta, exp } = partes(firmarUrlArchivo(CHAT)!);

    expect(verificarFirma(ruta, exp, 'abc')).toBe(false);
  });
});

describe('normalizarRutaArchivo (esquive de la firma con `..`)', () => {
  it('deja pasar una ruta limpia, firmada o no', () => {
    expect(normalizarRutaArchivo('/documentos-identidad/abc.jpg')).toBe(
      '/documentos-identidad/abc.jpg',
    );
  });

  it.each([
    '/perfiles/../documentos-identidad/abc.jpg',
    '/perfiles/%2e%2e/documentos-identidad/abc.jpg',
    '/./documentos-identidad/abc.jpg',
    '//documentos-identidad/abc.jpg',
    '/perfiles/%00/abc.jpg',
    '/perfiles/%E0%A4%A',
  ])('rechaza %s', (ruta) => {
    expect(normalizarRutaArchivo(ruta)).toBeNull();
  });

  it('el namespace privado se reconoce sin importar mayúsculas', () => {
    expect(esRutaPrivada('/DOCUMENTOS-IDENTIDAD/abc.jpg')).toBe(true);
  });
});

describe('ventana de los documentos de identidad', () => {
  it('vence en 10 minutos como mucho, no en horas', () => {
    const url = firmarUrlArchivo('/api/v1/archivos/documentos-identidad/dni.jpg')!;
    const { exp } = partes(url);
    const restante = Number(exp) - Date.now();

    expect(restante).toBeGreaterThan(0);
    expect(restante).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('el resto de las privadas conserva su ventana larga', () => {
    const { exp } = partes(firmarUrlArchivo(CHAT)!);
    expect(Number(exp) - Date.now()).toBeGreaterThan(60 * 60 * 1000);
  });
});
