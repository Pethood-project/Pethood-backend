/**
 * Geocodificación de direcciones con `node-geocoder`.
 *
 * Traduce la dirección estructurada que carga un usuario o un refugio (provincia + localidad
 * + calle y altura) a coordenadas (`latitud`/`longitud`) y a una URL de Google Maps. Las
 * coordenadas se guardan aparte para poder calcular distancias con `distanciaKm` (geo.ts) sin
 * depender de parsear la URL.
 *
 * El proveedor se elige por entorno (`GEOCODER_PROVIDER`): `openstreetmap` (gratis, sin key)
 * o `google` (con `GEOCODER_API_KEY`). El proyecto NO integra un SDK de mapas interactivo:
 * acá sólo se resuelven coordenadas. Ver `docs/DEUDA_TECNICA.md`, ítem 22.
 */
import NodeGeocoder from 'node-geocoder';
import { env } from '../config/env';
import type { Coordenadas } from './geo';

export interface DireccionAProcesar {
  calleAltura: string;
  localidad: string;
  provincia: string;
}

export interface UbicacionGeocodificada extends Coordenadas {
  /** URL oficial de Google Maps con las coordenadas, lista para guardar y mostrar. */
  mapaUrl: string;
}

/** URL oficial de Google Maps a partir de un par de coordenadas. */
export function construirMapaUrl({ latitud, longitud }: Coordenadas): string {
  return `https://www.google.com/maps?q=${latitud},${longitud}`;
}

/** Formato que espera el geocoder: «<calle y altura>, <localidad>, <provincia>, Argentina». */
export function direccionParaGeocodificar(direccion: DireccionAProcesar): string {
  return `${direccion.calleAltura}, ${direccion.localidad}, ${direccion.provincia}, Argentina`;
}

/**
 * Arma la dirección a partir de los campos sueltos de un formulario. Sólo hay dirección
 * geocodificable si están los tres; si falta uno, no se geocodifica (ni se pisan las
 * coordenadas existentes). Reutilizado por perfil de usuario, registro y perfil de refugio.
 */
export function direccionDesdeCampos(campos: {
  provincia?: string | null;
  localidad?: string | null;
  calleAltura?: string | null;
}): DireccionAProcesar | null {
  const { calleAltura, localidad, provincia } = campos;
  if (!calleAltura || !localidad || !provincia) return null;
  return { calleAltura, localidad, provincia };
}

let geocoder: ReturnType<typeof NodeGeocoder> | null = null;

function obtenerGeocoder(): ReturnType<typeof NodeGeocoder> {
  if (geocoder) return geocoder;

  geocoder =
    env.GEOCODER_PROVIDER === 'google'
      ? NodeGeocoder({ provider: 'google', apiKey: env.GEOCODER_API_KEY!, language: 'es' })
      : NodeGeocoder({
          provider: 'openstreetmap',
          language: 'es',
          // Nominatim pide un contacto para uso sostenido; es opcional (ver .env.example).
          ...(env.GEOCODER_EMAIL ? { email: env.GEOCODER_EMAIL } : {}),
        });

  return geocoder;
}

/**
 * Coordenadas y URL de Maps de una dirección, o `null` si el proveedor no encontró nada o la
 * red falló. No lanza: el llamador decide si eso es un error de negocio (dirección que el
 * usuario debe corregir) o un dato opcional que simplemente no se guarda.
 */
export async function geocodificarDireccion(
  direccion: DireccionAProcesar,
): Promise<UbicacionGeocodificada | null> {
  try {
    const [resultado] = await obtenerGeocoder().geocode(direccionParaGeocodificar(direccion));
    const latitud = resultado?.latitude;
    const longitud = resultado?.longitude;

    if (latitud === undefined || longitud === undefined) return null;

    const coordenadas: Coordenadas = { latitud, longitud };
    return { ...coordenadas, mapaUrl: construirMapaUrl(coordenadas) };
  } catch (error) {
    console.error('Error al geocodificar la dirección:', error);
    return null;
  }
}

/**
 * URL de Google Maps que BUSCA un texto, para cuando no hay coordenadas (el geocoder no
 * encontró el lugar). Maps resuelve la búsqueda por su cuenta, así el link sirve igual.
 */
export function construirMapaUrlDeBusqueda(texto: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`;
}

/** Un lugar sin calle: provincia y localidad, y opcionalmente una referencia libre. */
export interface LugarAGeocodificar {
  provincia: string;
  localidad: string;
  /** Aclaratorio libre ("cerca de la plaza Italia"): puede no ser geocodificable. */
  referencia?: string | null;
}

/** Texto del lugar para el geocoder o para buscar en Maps: «<referencia>, <localidad>, <provincia>, Argentina». */
export function textoDeLugar(lugar: LugarAGeocodificar): string {
  return [lugar.referencia, lugar.localidad, lugar.provincia, 'Argentina']
    .filter((parte) => parte && parte.trim() !== '')
    .join(', ');
}

/**
 * Tope de espera del geocoder al publicar: si el proveedor tarda, el alta sigue sin
 * coordenadas del lugar en vez de quedar colgada.
 */
const ESPERA_MAXIMA_LUGAR_MS = 6000;

async function coordenadasDeTexto(texto: string): Promise<Coordenadas | null> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const vencimiento = new Promise<null>((resolver) => {
    temporizador = setTimeout(() => resolver(null), ESPERA_MAXIMA_LUGAR_MS);
  });

  try {
    const busqueda = obtenerGeocoder()
      .geocode(texto)
      .then(([resultado]) =>
        resultado?.latitude !== undefined && resultado?.longitude !== undefined
          ? { latitud: resultado.latitude, longitud: resultado.longitude }
          : null,
      );

    return await Promise.race([busqueda, vencimiento]);
  } catch (error) {
    console.error('Error al geocodificar el lugar:', error);
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Coordenadas de un lugar sin calle (el de un aviso de mascota perdida, spec 020). La
 * referencia es texto libre y muchas veces el geocoder no la entiende ("en la esquina del
 * kiosco"), así que primero se prueba con ella y, si no hay resultado, sólo con localidad y
 * provincia, que siempre salen del catálogo. `null` si no se encontró nada. No lanza.
 */
export async function geocodificarLugar(lugar: LugarAGeocodificar): Promise<Coordenadas | null> {
  if (lugar.referencia && lugar.referencia.trim() !== '') {
    const conReferencia = await coordenadasDeTexto(textoDeLugar(lugar));
    if (conReferencia) return conReferencia;
  }

  return coordenadasDeTexto(textoDeLugar({ ...lugar, referencia: null }));
}
