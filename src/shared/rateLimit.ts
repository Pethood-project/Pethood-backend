interface ContadorIntentos {
  cantidad: number;
  reiniciaEn: number;
}

const intentos = new Map<string, ContadorIntentos>();

const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

export function estaBloqueado(clave: string): boolean {
  const actual = intentos.get(clave);
  if (!actual) return false;
  if (Date.now() > actual.reiniciaEn) {
    intentos.delete(clave);
    return false;
  }
  return actual.cantidad >= MAX_INTENTOS;
}

export function registrarFallo(clave: string): void {
  const ahora = Date.now();
  const actual = intentos.get(clave);

  if (!actual || ahora > actual.reiniciaEn) {
    intentos.set(clave, { cantidad: 1, reiniciaEn: ahora + VENTANA_MS });
    return;
  }

  actual.cantidad += 1;
}

export function limpiarIntentos(clave: string): void {
  intentos.delete(clave);
}
