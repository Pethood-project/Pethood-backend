/**
 * Contraseña nueva: validación pura, sin dependencias.
 *
 * Se aplica al crearla o cambiarla (registro, recuperación, cambio desde el perfil). Al
 * ingresar no: ahí alcanza con que no venga vacía, para no dejar afuera a cuentas anteriores.
 *
 * Letras y símbolos se miden con las mismas letras del castellano que usa el resto de la
 * validación (`nombrePersonaSchema`): un símbolo es lo que no es letra, número ni espacio.
 */
const MINIMO_CARACTERES = 8;

const REGEX_MAYUSCULA = /[A-ZÁÉÍÓÚÜÑ]/;
const REGEX_MINUSCULA = /[a-záéíóúüñ]/;
const REGEX_NUMERO = /\d/;
const REGEX_SIMBOLO = /[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\d\s]/;

export const MENSAJE_PASSWORD_NUEVA =
  'La contraseña debe tener al menos 8 caracteres, con una mayúscula, una minúscula, un número y un símbolo.';

export type ResultadoPassword = { valido: true; valor: string } | { valido: false; error: string };

export function validarPasswordNueva(valor: unknown): ResultadoPassword {
  if (typeof valor !== 'string' || valor === '') {
    return { valido: false, error: 'La contraseña es obligatoria.' };
  }

  const cumple =
    valor.length >= MINIMO_CARACTERES &&
    REGEX_MAYUSCULA.test(valor) &&
    REGEX_MINUSCULA.test(valor) &&
    REGEX_NUMERO.test(valor) &&
    REGEX_SIMBOLO.test(valor);

  return cumple ? { valido: true, valor } : { valido: false, error: MENSAJE_PASSWORD_NUEVA };
}
