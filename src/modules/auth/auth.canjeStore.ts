import { randomBytes } from 'node:crypto';

const TTL_MS = 60 * 1000;

interface Canje {
  token: string;
  nonce: string;
  expiraEn: number;
}

// En memoria, igual que `auth.resetStore`: con más de una instancia habría que moverlo a Redis.
const canjes = new Map<string, Canje>();

/** Código de un solo uso para que el JWT del login con Google no viaje en la URL. */
export function emitirCanje(token: string, nonce: string): string {
  const codigo = randomBytes(32).toString('hex');
  canjes.set(codigo, { token, nonce, expiraEn: Date.now() + TTL_MS });
  return codigo;
}

/** Devuelve el JWT si el código vive y el nonce es el del navegador que inició el flujo. */
export function consumirCanje(codigo: string, nonce: string): string | null {
  const actual = canjes.get(codigo);
  canjes.delete(codigo);

  if (!actual || Date.now() > actual.expiraEn || actual.nonce !== nonce) return null;
  return actual.token;
}

export function limpiarCanjes(): void {
  canjes.clear();
}
