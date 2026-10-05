/**
 * Utilidades de geolocalización puras, sin dependencias (Módulo 11, HU-11.3).
 *
 * El proyecto NO usa SDK de mapas ni geocodificación. Las coordenadas salen de dos fuentes:
 * - las que captura el dispositivo al publicar (`publicacion_ubicacion_latitud/longitud`), y
 * - las que se extraen del enlace de Google Maps del refugio (`refugio_mapa_url`).
 *
 * `coordenadasDeMapsUrl` entiende los formatos que produce Google Maps cuando el link es
 * "completo" (con `@lat,lng`, `!3d..!4d..`, `?q=lat,lng`, `ll=`, etc.). `resolverCoordenadasDeMapsUrl`
 * además resuelve los links cortos (`maps.app.goo.gl`) siguiendo la redirección, con caché y
 * tope de tiempo. Ver `docs/DEUDA_TECNICA.md`.
 */

export interface Coordenadas {
  latitud: number;
  longitud: number;
}

function esValida(latitud: number, longitud: number): boolean {
  return (
    Number.isFinite(latitud) &&
    Number.isFinite(longitud) &&
    latitud >= -90 &&
    latitud <= 90 &&
    longitud >= -180 &&
    longitud <= 180
  );
}

function aCoordenadas(latitudTexto: string, longitudTexto: string): Coordenadas | null {
  const latitud = Number(latitudTexto);
  const longitud = Number(longitudTexto);
  return esValida(latitud, longitud) ? { latitud, longitud } : null;
}

/**
 * De más específico a más genérico. El orden importa: `!3d..!4d..` y `@lat,lng` son
 * inequívocos, mientras que la última captura cualquier par de decimales (por eso va al
 * final y se valida el rango geográfico).
 */
const PATRONES = [
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i,
  /[?&](?:q|query|ll|center|destination)=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
  /\/(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
];

export function coordenadasDeMapsUrl(url: string | null | undefined): Coordenadas | null {
  if (!url) return null;

  for (const patron of PATRONES) {
    const coincidencia = patron.exec(url);
    if (!coincidencia) continue;

    const coordenadas = aCoordenadas(coincidencia[1]!, coincidencia[2]!);
    if (coordenadas) return coordenadas;
  }

  return null;
}

/** Hosts de Google Maps que usan links cortos, sin coordenadas hasta seguir la redirección. */
export function esLinkCortoDeMaps(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'maps.app.goo.gl' || hostname === 'goo.gl';
  } catch {
    return false;
  }
}

/** Devuelve la URL final tras seguir redirecciones. Se inyecta para poder testear sin red. */
export type ResolutorUrl = (url: string) => Promise<{ url: string }>;

/**
 * Sigue la redirección con un tope de tiempo: si Google tarda o no responde, el filtro no
 * puede quedarse esperando. Se corta a los 4 s y se trata como "sin coordenadas".
 */
async function seguirRedireccion(url: string): Promise<{ url: string }> {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 4000);

  try {
    const respuesta = await fetch(url, { redirect: 'follow', signal: controlador.signal });
    return { url: respuesta.url };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Caché por URL original. Los links cortos se resuelven una sola vez: el feed vuelve a
 * consultar el mismo refugio en cada página y no hay que golpear a Google cada vez.
 * Solo se cachean los resultados definitivos (con o sin coordenadas); un error de red no se
 * guarda, para poder reintentar.
 */
const cacheCoordenadas = new Map<string, Coordenadas | null>();

/**
 * Coordenadas de un enlace de Google Maps, resolviendo los links cortos
 * (`maps.app.goo.gl`). Primero intenta el parseo directo; si el link es corto, sigue la
 * redirección y parsea la URL final.
 *
 * `resolutor` se puede inyectar para testear sin red.
 */
export async function resolverCoordenadasDeMapsUrl(
  url: string | null | undefined,
  resolutor: ResolutorUrl = seguirRedireccion,
): Promise<Coordenadas | null> {
  if (!url) return null;

  const directas = coordenadasDeMapsUrl(url);
  if (directas) return directas;

  if (cacheCoordenadas.has(url)) return cacheCoordenadas.get(url) ?? null;
  if (!esLinkCortoDeMaps(url)) {
    cacheCoordenadas.set(url, null);
    return null;
  }

  try {
    const respuesta = await resolutor(url);
    const coordenadas = coordenadasDeMapsUrl(respuesta.url);
    cacheCoordenadas.set(url, coordenadas);
    return coordenadas;
  } catch {
    // Transitorio (timeout, sin red): no se cachea, así el próximo pedido reintenta.
    return null;
  }
}

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Distancia en kilómetros entre dos coordenadas (fórmula del semiverseno/Haversine). */
export function distanciaKm(a: Coordenadas, b: Coordenadas): number {
  const RADIO_TIERRA_KM = 6371;
  const deltaLat = aRadianes(b.latitud - a.latitud);
  const deltaLng = aRadianes(b.longitud - a.longitud);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(aRadianes(a.latitud)) * Math.cos(aRadianes(b.latitud)) * Math.sin(deltaLng / 2) ** 2;

  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distancia entre dos ubicaciones ya como texto para la ficha («A 2,3 km»), redondeada a un
 * decimal. Devuelve `null` si falta alguna de las dos, para que el llamador decida si muestra
 * el dato o no. Se usa en el detalle de la mascota (adoptante ↔ refugio).
 */
export function distanciaKmTexto(
  a: Coordenadas | null | undefined,
  b: Coordenadas | null | undefined,
): string | null {
  if (!a || !b) return null;

  const km = Math.round(distanciaKm(a, b) * 10) / 10;
  return `A ${km.toString().replace('.', ',')} km`;
}
