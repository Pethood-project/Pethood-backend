/** Validación de texto reutilizable. Funciones puras, sin dependencias. */

const REGEX_SOLO_LETRAS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/;

export type ResultadoTexto = { valido: true; valor: string } | { valido: false; error: string };

function esFemenina(etiqueta: string): boolean {
  return /^(La|Las)\s/.test(etiqueta.trim());
}

/** Concuerda en género con el artículo de la etiqueta ("La ubicación" → obligatoria). */
export function mensajeObligatorio(etiqueta: string): string {
  return `${etiqueta} es ${esFemenina(etiqueta) ? 'obligatoria' : 'obligatorio'}`;
}

/** Igual criterio de género: "La especie no es válida", "El estado no es válido". */
export function mensajeInvalido(etiqueta: string): string {
  return `${etiqueta} no es ${esFemenina(etiqueta) ? 'válida' : 'válido'}`;
}

/** Un solo mensaje para "muy corto" y "muy largo", no dos distintos. */
export function mensajeLongitud(etiqueta: string, min: number, max: number): string {
  // Sin un mínimo real, hablar de un rango que arranca en cero confunde.
  if (min <= 1) return `${etiqueta} no puede superar los ${max} caracteres`;
  return `${etiqueta} debe tener entre ${min} y ${max} caracteres`;
}

export interface OpcionesTexto {
  min?: number;
  max: number;
  etiqueta: string;
  obligatorio?: boolean;
  /**
   * Mensajes a medida, para cuando la HU fija el texto literal que tiene que ver el usuario
   * (ej. HU-9.1 exige "Completar descripción" y no el genérico "La descripción es
   * obligatoria"). Solo cambian el texto: la regla que decide si el valor es válido sigue
   * siendo la de esta función, para que el DTO nunca tenga que reimplementarla.
   */
  errorObligatorio?: string;
  errorLongitud?: string;
  /** Solo letras y espacios (REQUISITOS §4: nombres solo alfabéticos). */
  soloLetras?: boolean;
}

/**
 * Texto con trim previo. Un valor de solo espacios queda vacío; si el campo exige un
 * mínimo de 2 o más, se reporta como longitud inválida y no como campo sin completar,
 * porque para quien lo escribió el campo tenía contenido.
 */
export function validarTexto(valor: unknown, opciones: OpcionesTexto): ResultadoTexto {
  const {
    min = 0,
    max,
    etiqueta,
    obligatorio = true,
    errorObligatorio,
    errorLongitud,
    soloLetras = false,
  } = opciones;
  const recortado = typeof valor === 'string' ? valor.trim() : '';

  const porLongitud = errorLongitud ?? mensajeLongitud(etiqueta, min, max);

  if (!recortado) {
    if (!obligatorio) return { valido: true, valor: '' };
    if (min >= 2) return { valido: false, error: porLongitud };
    return { valido: false, error: errorObligatorio ?? mensajeObligatorio(etiqueta) };
  }

  if (recortado.length < min || recortado.length > max) {
    return { valido: false, error: porLongitud };
  }

  if (soloLetras && !REGEX_SOLO_LETRAS.test(recortado)) {
    return { valido: false, error: `${etiqueta} solo puede tener letras` };
  }

  return { valido: true, valor: recortado };
}

export type ResultadoListaJson =
  { valido: true; valor: unknown[] } | { valido: false; error: string };

/**
 * Lista de objetos que viaja como JSON dentro de un campo de texto: es la forma de mandar
 * una lista de pares (ej. vacuna + fecha) en un multipart, que solo sabe de strings. Acepta
 * también el array ya parseado (body JSON). Ausente o vacía → lista vacía.
 */
export function parsearListaJson(valor: unknown, etiqueta: string): ResultadoListaJson {
  if (valor === undefined || valor === null || valor === '') return { valido: true, valor: [] };
  if (Array.isArray(valor)) return { valido: true, valor };
  if (typeof valor !== 'string') return { valido: false, error: `${etiqueta}: formato inválido` };

  try {
    const parseado: unknown = JSON.parse(valor);
    if (!Array.isArray(parseado)) return { valido: false, error: `${etiqueta}: formato inválido` };
    return { valido: true, valor: parseado };
  } catch {
    return { valido: false, error: `${etiqueta}: formato inválido` };
  }
}

export type ResultadoListaTextos =
  { valido: true; valor: string[] } | { valido: false; error: string };

/**
 * Lista de textos libres de un filtro de selección múltiple, como llega por query string.
 *
 * A diferencia de los ids y los valores de catálogo, NO se separan por coma: un texto libre
 * puede tenerla ("Godoy Cruz, Mendoza"). Se manda un parámetro por valor
 * (`?localidades=Maipú&localidades=Godoy%20Cruz`), que Express entrega como arreglo; uno solo
 * llega como string.
 *
 * Ausente o vacía es "sin filtro" (lista vacía). Hace trim, descarta los vacíos y los
 * repetidos sin distinguir mayúsculas, y rechaza la lista entera si un valor es demasiado
 * largo o si hay más de los permitidos: un filtro aplicado a medias muestra un resultado que
 * el usuario no pidió.
 */
export function parsearListaDeTextos(
  valor: unknown,
  opciones: { max: number; maximoElementos: number; etiqueta: string },
): ResultadoListaTextos {
  const { max, maximoElementos, etiqueta } = opciones;
  const invalido = mensajeInvalido(etiqueta);

  if (valor === undefined || valor === null || valor === '') return { valido: true, valor: [] };

  const crudos = Array.isArray(valor) ? valor : [valor];
  const textos: string[] = [];

  for (const crudo of crudos) {
    if (typeof crudo !== 'string') return { valido: false, error: invalido };

    const limpio = crudo.trim();
    if (!limpio) continue;
    if (limpio.length > max) return { valido: false, error: invalido };

    const repetido = textos.some((texto) => texto.toLowerCase() === limpio.toLowerCase());
    if (!repetido) textos.push(limpio);
  }

  if (textos.length > maximoElementos) {
    return { valido: false, error: `Podés elegir hasta ${maximoElementos} opciones a la vez` };
  }

  return { valido: true, valor: textos };
}

export type ResultadoListaValores<T extends string> =
  { valido: true; valor: T[] } | { valido: false; error: string };

/**
 * Lista separada por comas de valores de un conjunto cerrado, como llega un filtro por query
 * string (`?estados=Pendiente,En_Revision`). Ausente o vacía es "sin filtro" (lista vacía).
 * Descarta repetidos y rechaza la lista entera si algún valor no está permitido: un filtro
 * que se aplica a medias muestra un resultado que el usuario no pidió.
 */
export function parsearListaDeValores<T extends string>(
  valor: unknown,
  permitidos: readonly T[],
  etiqueta: string,
): ResultadoListaValores<T> {
  if (valor === undefined || valor === null || valor === '') return { valido: true, valor: [] };
  if (typeof valor !== 'string') return { valido: false, error: `${etiqueta} no es válido` };

  const valores: T[] = [];

  for (const parte of valor.split(',')) {
    const limpio = parte.trim();
    if (!(permitidos as readonly string[]).includes(limpio)) {
      return { valido: false, error: `${etiqueta} no es válido` };
    }
    if (!valores.includes(limpio as T)) valores.push(limpio as T);
  }

  return { valido: true, valor: valores };
}
