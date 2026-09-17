/** Validación de texto reutilizable. Funciones puras, sin dependencias. */

export type ResultadoTexto = { valido: true; valor: string } | { valido: false; error: string };

/** Concuerda en género con el artículo de la etiqueta ("La ubicación" → obligatoria). */
export function mensajeObligatorio(etiqueta: string): string {
  const femenino = /^(La|Las)\s/.test(etiqueta.trim());
  return `${etiqueta} es ${femenino ? 'obligatoria' : 'obligatorio'}`;
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
}

/**
 * Texto con trim previo. Un valor de solo espacios queda vacío; si el campo exige un
 * mínimo de 2 o más, se reporta como longitud inválida y no como campo sin completar,
 * porque para quien lo escribió el campo tenía contenido.
 */
export function validarTexto(valor: unknown, opciones: OpcionesTexto): ResultadoTexto {
  const { min = 0, max, etiqueta, obligatorio = true, errorObligatorio, errorLongitud } = opciones;
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

  return { valido: true, valor: recortado };
}
