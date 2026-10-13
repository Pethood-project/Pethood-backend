/**
 * Firma las URLs de los archivos **privados** para que no basten por sí solas.
 *
 * ## El problema
 *
 * `/api/v1/archivos` se sirve con `express.static` y sin autenticación: cualquiera con el
 * link abre el archivo, sin sesión y sin ser participante de nada. Para la foto de una mascota
 * da igual —se muestra en el feed de adopción, es pública por diseño—, pero los adjuntos de
 * una conversación, los comprobantes de historia clínica, las pruebas de vida de un
 * seguimiento y el DNI/selfie de un usuario no lo son.
 *
 * ## Por qué no alcanza con pedir el token
 *
 * Lo obvio sería poner `autenticar` delante y listo. **No se puede:** en React Native,
 * `<Image source={{ uri }} />` descarga por su cuenta y no manda el header `Authorization`.
 * Habría que pasarle `headers` a las 25 imágenes remotas de la app, y encima eso rompe el
 * cacheo. La app se quedaría sin una sola foto.
 *
 * Por eso la autorización viaja **en la URL**: es lo mismo que hacen las URLs prefirmadas de
 * S3/R2 y por el mismo motivo.
 *
 * ## Qué gana y qué no
 *
 * Gana: el link **vence**, así que una URL filtrada deja de servir; y no se puede fabricar una
 * para un archivo ajeno, porque hace falta el secreto. Pierde: sigue siendo un *bearer* — quien
 * tenga el link vigente entra. La versión fuerte sería chequear la pertenencia al chat en cada
 * request, y eso es justo lo que el `<Image>` de RN no deja hacer.
 *
 * ## Por qué el vencimiento se redondea
 *
 * Si cada respuesta trajera una firma distinta, la URL cambiaría todo el tiempo y el cliente
 * volvería a descargar la misma foto una y otra vez —con videos de hasta 30 MB, carísimo—
 * porque su caché indexa por URL. Acá el vencimiento se alinea a una ventana fija: todas las
 * respuestas de un mismo tramo devuelven **exactamente la misma URL**, y el archivo se cachea
 * como siempre.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';

import { env } from '../config/env';
import { RUTA_PUBLICA_ARCHIVOS } from './storage';

/**
 * Las subcarpetas cuyo contenido NO es público. Coinciden con las `SUBCARPETA_*` de cada
 * módulo: `chats`, historia clínica, seguimiento y documentos de identidad.
 *
 * Lo que queda afuera es público a propósito: `mascotas` y `publicaciones` se muestran en el
 * feed de adopción, y `perfiles` es el avatar que ve cualquiera con quien hables.
 */
const NAMESPACES_PRIVADOS = new Set([
  'chats',
  'historias-clinicas',
  'seguimientos',
  'documentos-identidad',
]);

/** Cuánto dura una firma, y cada cuánto cambia. */
const VENTANA_MS = 6 * 60 * 60 * 1000;

/**
 * Ventana más corta para lo que es documentación de identidad: un link filtrado de un DNI no
 * puede seguir sirviendo medio día. La URL vale entre 1 y 2 ventanas (5–10 min); quien tenga
 * la pantalla abierta más tiempo tiene que volver a pedir el detalle. El caché del cliente
 * no importa acá: son dos imágenes que se miran una vez.
 */
const VENTANA_DOCUMENTOS_MS = 5 * 60 * 1000;
const NAMESPACE_DOCUMENTOS = 'documentos-identidad';

/** Longitud de la firma en hex. 32 caracteres son 128 bits: de sobra, y no infla la URL. */
const LARGO_FIRMA = 32;

/**
 * Vencimiento alineado a la ventana, **siempre con al menos una ventana entera por delante**.
 *
 * Se suman dos ventanas y no una para que una URL emitida justo antes del corte no nazca
 * venciendo en dos segundos.
 */
function vencimiento(ahora: number, ventanaMs: number = VENTANA_MS): number {
  return (Math.floor(ahora / ventanaMs) + 2) * ventanaMs;
}

function calcularFirma(rutaRelativa: string, exp: number): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`${rutaRelativa}:${exp}`)
    .digest('hex')
    .slice(0, LARGO_FIRMA);
}

/** `true` si esa ruta cae en una subcarpeta privada. Espera la ruta SIN el prefijo público. */
export function esRutaPrivada(rutaRelativa: string): boolean {
  const primerTramo = rutaRelativa.replace(/^\/+/, '').split('/')[0]?.toLowerCase();
  return primerTramo !== undefined && NAMESPACES_PRIVADOS.has(primerTramo);
}

/**
 * Ruta decodificada y **ya normalizada**, o `null` si el request trae segmentos `.`/`..`, `//`
 * o un escape inválido.
 *
 * Existe porque `express.static` normaliza DESPUÉS de que el middleware de firma decidió con el
 * primer tramo: `/perfiles/../documentos-identidad/x.jpg` parecía pública, pasaba sin firma y
 * el estático la resolvía a la carpeta privada. Ninguna URL legítima (`firmarUrlArchivo`) trae
 * esos segmentos, así que se rechaza todo lo que no sea idéntico a su forma normalizada.
 */
export function normalizarRutaArchivo(rutaCruda: string): string | null {
  let ruta: string;
  try {
    ruta = decodeURIComponent(rutaCruda);
  } catch {
    return null;
  }
  if (ruta.includes('\0') || ruta.includes('\\') || posix.normalize(ruta) !== ruta) return null;
  return ruta;
}

/**
 * Le agrega la firma a una URL de archivo privado. Devuelve cualquier otra cosa sin tocar:
 *
 * - `null` sigue siendo `null` (el registro no tenía archivo).
 * - Una URL **absoluta** pasa de largo: es de R2, que sirve Cloudflare y no pasa por este
 *   servidor. ⚠️ Mientras R2 esté apagado no es un problema, pero **activarlo vuelve a dejar
 *   públicos los archivos privados** hasta que se firmen con `getSignedUrl` del SDK de S3.
 *   Ver `docs/DEUDA_TECNICA.md`.
 * - Una ruta de una subcarpeta pública (mascotas, publicaciones, perfiles) tampoco se firma.
 */
export function firmarUrlArchivo(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;

  const rutaRelativa = url.startsWith(RUTA_PUBLICA_ARCHIVOS)
    ? url.slice(RUTA_PUBLICA_ARCHIVOS.length)
    : url;

  if (!esRutaPrivada(rutaRelativa)) return url;

  const primerTramo = rutaRelativa.replace(/^\/+/, '').split('/')[0]?.toLowerCase();
  const ventana = primerTramo === NAMESPACE_DOCUMENTOS ? VENTANA_DOCUMENTOS_MS : VENTANA_MS;
  const exp = vencimiento(Date.now(), ventana);
  return `${url}?exp=${exp}&sig=${calcularFirma(rutaRelativa, exp)}`;
}

/** Firma una lista conservando el orden. */
export function firmarUrlsArchivo(urls: string[]): string[] {
  return urls.map((url) => firmarUrlArchivo(url) ?? url);
}

/**
 * Valida la firma de una ruta privada. `false` si venció, si no coincide o si falta.
 *
 * La comparación es de tiempo constante: comparar con `===` filtra, por cuánto tarda en
 * fallar, cuántos caracteres del principio acertaste.
 */
export function verificarFirma(rutaRelativa: string, exp: unknown, firma: unknown): boolean {
  if (typeof exp !== 'string' || typeof firma !== 'string') return false;

  const vence = Number(exp);
  if (!Number.isFinite(vence) || vence <= Date.now()) return false;

  const esperada = Buffer.from(calcularFirma(rutaRelativa, vence));
  const recibida = Buffer.from(firma);

  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}
