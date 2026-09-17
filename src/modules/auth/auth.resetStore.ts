import { createHash, randomInt } from 'node:crypto';

const TTL_MS = 30 * 60 * 1000;
const MAX_INTENTOS = 5;

interface CodigoReset {
  hash: string;
  usuarioId: number;
  expiraEn: number;
  intentos: number;
}

const codigos = new Map<string, CodigoReset>();

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashear(email: string, codigo: string): string {
  return createHash('sha256')
    .update(`${normalizarEmail(email)}:${codigo}`)
    .digest('hex');
}

export function generarCodigoReset(): string {
  return randomInt(100000, 1_000_000).toString();
}

export function guardarCodigoReset(email: string, usuarioId: number, codigo: string): void {
  const clave = normalizarEmail(email);
  codigos.set(clave, {
    hash: hashear(clave, codigo),
    usuarioId,
    expiraEn: Date.now() + TTL_MS,
    intentos: 0,
  });
}

/** Devuelve el usuarioId si el código es válido; si no, `null`. */
export function consumirCodigoReset(email: string, codigo: string): number | null {
  const clave = normalizarEmail(email);
  const actual = codigos.get(clave);

  if (!actual) return null;

  if (Date.now() > actual.expiraEn) {
    codigos.delete(clave);
    return null;
  }

  if (actual.hash !== hashear(clave, codigo)) {
    actual.intentos += 1;
    if (actual.intentos >= MAX_INTENTOS) {
      codigos.delete(clave);
    }
    return null;
  }

  codigos.delete(clave);
  return actual.usuarioId;
}

export function limpiarCodigosReset(): void {
  codigos.clear();
}
