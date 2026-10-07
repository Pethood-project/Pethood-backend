/**
 * Datos para transferir: alias y CBU/CVU (spec 026). Funciones puras, sin dependencias.
 *
 * Los dos son opcionales por separado (la campaña exige al menos uno, eso lo decide el DTO).
 * Sólo se valida el formato: los dígitos verificadores del CBU quedan fuera de alcance.
 */
import { LIMITES } from './limits';

export type ResultadoBancario =
  { valido: true; valor: string | null } | { valido: false; error: string };

const REGEX_ALIAS = /^[A-Za-z0-9.-]+$/;
const REGEX_CBU = /^\d+$/;

/** Formato BCRA: de 6 a 20 caracteres entre letras, números, puntos y guiones. */
export function validarAliasOpcional(valor: unknown): ResultadoBancario {
  const alias = typeof valor === 'string' ? valor.trim() : '';
  const { min, max } = LIMITES.campania.alias;

  if (alias === '') return { valido: true, valor: null };
  if (alias.length < min || alias.length > max) {
    return { valido: false, error: `El alias debe tener entre ${min} y ${max} caracteres` };
  }
  if (!REGEX_ALIAS.test(alias)) {
    return {
      valido: false,
      error: 'El alias sólo puede tener letras, números, puntos y guiones',
    };
  }

  return { valido: true, valor: alias };
}

/** CBU o CVU: 22 dígitos. Los espacios se descartan porque suelen venir al copiar y pegar. */
export function validarCbuOpcional(valor: unknown): ResultadoBancario {
  const cbu = typeof valor === 'string' ? valor.replace(/\s+/g, '') : '';
  const { largo } = LIMITES.campania.cbu;

  if (cbu === '') return { valido: true, valor: null };
  if (cbu.length !== largo || !REGEX_CBU.test(cbu)) {
    return { valido: false, error: `El CBU o CVU debe tener ${largo} números` };
  }

  return { valido: true, valor: cbu };
}
