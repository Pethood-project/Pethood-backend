/**
 * Cifrado simétrico para secretos guardados en la base (tokens de Mercado Pago, spec 027).
 *
 * AES-256-GCM: además de ocultar, detecta si el texto cifrado fue alterado. Formato
 * `v1:<iv>:<tag>:<datos>` en base64, con IV aleatorio por mensaje: el mismo token cifra distinto
 * cada vez. La clave es de 32 bytes en base64 y vive en `.env`, nunca en la base.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITMO = 'aes-256-gcm';

function clave(claveBase64: string): Buffer {
  const buffer = Buffer.from(claveBase64, 'base64');
  if (buffer.length !== 32) throw new Error('La clave de cifrado tiene que tener 32 bytes');
  return buffer;
}

export function cifrar(texto: string, claveBase64: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv(ALGORITMO, clave(claveBase64), iv);
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);

  return [
    VERSION,
    iv.toString('base64'),
    cifrador.getAuthTag().toString('base64'),
    datos.toString('base64'),
  ].join(':');
}

export function descifrar(cifrado: string, claveBase64: string): string {
  const [version, iv, tag, datos] = cifrado.split(':');
  if (version !== VERSION || !iv || !tag || !datos) throw new Error('Formato de cifrado inválido');

  const descifrador = createDecipheriv(ALGORITMO, clave(claveBase64), Buffer.from(iv, 'base64'));
  descifrador.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    descifrador.update(Buffer.from(datos, 'base64')),
    descifrador.final(),
  ]).toString('utf8');
}
