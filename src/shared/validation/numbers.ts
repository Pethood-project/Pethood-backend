/** Validación numérica reutilizable. Funciones puras, sin dependencias. */

export type ResultadoDecimal = { valido: true; valor: number } | { valido: false; error: string };

function patronDecimal(enteros: number, decimales: number): RegExp {
  // Sin decimales no hay parte decimal: `\d{1,0}` ni siquiera es una regex válida.
  const parteDecimal = decimales > 0 ? `([.,]\\d{1,${decimales}})?` : '';
  return new RegExp(`^\\d{1,${enteros}}${parteDecimal}$`);
}

/** Qué se esperaba, para el mensaje de formato inválido. */
function mensajeFormato(etiqueta: string, decimales: number): string {
  if (decimales === 0) return `${etiqueta} debe ser un número entero, sin puntos ni comas`;
  const ejemplo = ' (ej. 12,5)';
  return `${etiqueta} debe ser un número con hasta ${decimales} decimal${decimales === 1 ? '' : 'es'}${ejemplo}`;
}

/**
 * Valida y normaliza un decimal escrito con coma o punto: `"12,5"` → `12.5`.
 * Rechaza el exceso de decimales en vez de redondear, para no guardar en silencio
 * un valor distinto al que se escribió.
 */
export function parsearDecimal(
  valor: string | number | null | undefined,
  opciones: { min: number; max: number; decimales: number; etiqueta: string },
): ResultadoDecimal {
  const { min, max, decimales, etiqueta } = opciones;

  if (valor === null || valor === undefined || valor === '') {
    return { valido: false, error: `${etiqueta} es obligatorio` };
  }

  const texto = String(valor).trim();
  const enteros = String(Math.trunc(max)).length;

  if (!patronDecimal(enteros, decimales).test(texto)) {
    return { valido: false, error: mensajeFormato(etiqueta, decimales) };
  }

  const numero = Number(texto.replace(',', '.'));

  if (numero < min || numero > max) {
    return { valido: false, error: `${etiqueta} debe estar entre ${min} y ${max}` };
  }

  return { valido: true, valor: numero };
}

/**
 * Latitud o longitud: un número con signo dentro del rango del eje, que llega como texto
 * desde un form multipart.
 *
 * No sirve `parsearDecimal` por dos motivos: no acepta negativos (y en Argentina las dos
 * coordenadas lo son) y rechaza el exceso de decimales, mientras que el GPS del teléfono
 * entrega 10 o más. Acá no se redondea ni se trunca: se guarda el número tal cual llegó.
 */
export function parsearCoordenada(
  valor: string | number | null | undefined,
  opciones: { min: number; max: number; etiqueta: string },
): ResultadoDecimal {
  const { min, max, etiqueta } = opciones;

  if (valor === null || valor === undefined || valor === '') {
    return { valido: false, error: `${etiqueta} es obligatoria` };
  }

  const texto = String(valor).trim();

  // Signo opcional, parte entera y decimales con punto o coma. Nada de exponentes ni de
  // `Infinity`, que `Number()` aceptaría.
  if (!/^[-+]?\d{1,3}([.,]\d+)?$/.test(texto)) {
    return { valido: false, error: `${etiqueta} no es válida` };
  }

  const numero = Number(texto.replace(',', '.'));

  if (numero < min || numero > max) {
    return { valido: false, error: `${etiqueta} debe estar entre ${min} y ${max}` };
  }

  return { valido: true, valor: numero };
}

/** Id de una FK que llega como string desde un form multipart. */
export function parsearId(valor: unknown): number | null {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

export type ResultadoListaIds =
  { valido: true; valor: number[] } | { valido: false; error: string };

/**
 * Lista de ids separada por comas, como llega un filtro por query string (`?estados=1,3`).
 * Ausente o vacía es "sin filtro" (lista vacía). Descarta repetidos y rechaza la lista
 * entera si algún elemento no es un id válido, en vez de ignorarlo: un filtro que se aplica
 * a medias muestra un resultado que el usuario no pidió.
 */
export function parsearListaDeIds(valor: unknown, etiqueta: string): ResultadoListaIds {
  if (valor === undefined || valor === null || valor === '') return { valido: true, valor: [] };
  if (typeof valor !== 'string') return { valido: false, error: `${etiqueta} no es válido` };

  const ids: number[] = [];

  for (const parte of valor.split(',')) {
    const id = parsearId(parte.trim());
    if (id === null) return { valido: false, error: `${etiqueta} no es válido` };
    if (!ids.includes(id)) ids.push(id);
  }

  return { valido: true, valor: ids };
}
