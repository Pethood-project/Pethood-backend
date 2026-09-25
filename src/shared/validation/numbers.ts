/** Validación numérica reutilizable. Funciones puras, sin dependencias. */

export type ResultadoDecimal = { valido: true; valor: number } | { valido: false; error: string };

function patronDecimal(enteros: number, decimales: number): RegExp {
  return new RegExp(`^\\d{1,${enteros}}([.,]\\d{1,${decimales}})?$`);
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
    const ejemplo = decimales > 0 ? ' (ej. 12,5)' : '';
    return {
      valido: false,
      error: `${etiqueta} debe ser un número con hasta ${decimales} decimal${decimales === 1 ? '' : 'es'}${ejemplo}`,
    };
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
