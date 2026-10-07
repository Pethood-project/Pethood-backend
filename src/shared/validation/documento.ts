/**
 * DNI: validación y comparación (spec 027). Funciones puras, sin dependencias.
 *
 * Mercado Pago informa al pagador de una transferencia por CUIL/CUIT (11 dígitos: 2 de tipo,
 * los 8 del DNI con cero adelante si tiene 7, y 1 verificador). Para compararlo con el DNI del
 * usuario se sacan los 8 del medio y se ignoran los ceros a la izquierda.
 */
const REGEX_DNI = /^\d{7,8}$/;

export type ResultadoDni = { valido: true; valor: string } | { valido: false; error: string };

export function validarDni(valor: unknown): ResultadoDni {
  const dni = typeof valor === 'string' ? valor.trim() : '';

  if (dni === '') return { valido: false, error: 'El DNI es obligatorio.' };
  if (!REGEX_DNI.test(dni)) {
    return { valido: false, error: 'El DNI debe tener 7 u 8 dígitos numéricos.' };
  }

  return { valido: true, valor: dni };
}

/** Para comparar: «07123456» y «7123456» son el mismo DNI. */
export function normalizarDni(dni: string): string {
  return dni.replace(/^0+/, '');
}

/** El DNI que sale de la identificación del pagador, o `null` si no se puede saber. */
export function dniDesdeIdentificacion(
  tipo?: string | null,
  numero?: string | number | null,
): string | null {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  const tipoNormalizado = (tipo ?? '').toUpperCase();

  let dni: string | null = null;
  if ((tipoNormalizado === 'CUIL' || tipoNormalizado === 'CUIT') && digitos.length === 11) {
    dni = digitos.slice(2, 10);
  } else if (tipoNormalizado === 'DNI' && REGEX_DNI.test(digitos)) {
    dni = digitos;
  }

  return dni ? normalizarDni(dni) || null : null;
}
