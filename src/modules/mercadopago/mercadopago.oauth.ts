/**
 * `state` y PKCE de la vinculación con Mercado Pago (spec 027 §6.9).
 *
 * El `state` es un JWT firmado que vence a los 10 minutos (lo mismo que el código de Mercado
 * Pago) y lleva el refugio, el usuario y el verificador de PKCE **cifrado**: pasa por el
 * navegador y por Mercado Pago, así que no puede ir en claro. No se guarda en ningún lado
 * (sesión stateless, CONSTITUTION): el código de Mercado Pago ya es de un solo uso.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { cifrar, descifrar } from '../../shared/cifrado';

const AUDIENCIA = 'mp-vinculacion';

export function generarPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString('base64url');
  const desafio = createHash('sha256').update(verificador).digest('base64url');
  return { verificador, desafio };
}

/**
 * Clave con la que se firma el `state`: derivada de `MP_CLAVE_CIFRADO` y **nunca** `JWT_SECRET`.
 * El `state` pasa por el navegador y por Mercado Pago; firmado con el secreto de las sesiones,
 * `autenticar` lo habría aceptado como token de login.
 */
export function secretoDelState(claveCifrado: string): string {
  return createHash('sha256').update(`mp-vinculacion:${claveCifrado}`).digest('base64');
}

export interface EstadoVinculacion {
  refugioId: number;
  usuarioId: number;
  verificador: string;
}

export function firmarEstado(
  estado: EstadoVinculacion,
  secreto: string,
  claveCifrado: string,
): string {
  return jwt.sign(
    { r: estado.refugioId, u: estado.usuarioId, v: cifrar(estado.verificador, claveCifrado) },
    secreto,
    { expiresIn: '10m', audience: AUDIENCIA },
  );
}

export function leerEstado(
  state: string,
  secreto: string,
  claveCifrado: string,
): EstadoVinculacion {
  const datos = jwt.verify(state, secreto, { audience: AUDIENCIA }) as {
    r: number;
    u: number;
    v: string;
  };
  return { refugioId: datos.r, usuarioId: datos.u, verificador: descifrar(datos.v, claveCifrado) };
}
