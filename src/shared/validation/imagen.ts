/**
 * Validación de los parámetros de edición de imagen (recorte y rotación) que el cliente
 * puede mandar junto con el archivo en un upload multipart. Funciones puras, sin
 * dependencias — igual criterio que el resto de esta carpeta.
 */
import { LIMITES } from './limits';

export type RotacionValida = 0 | 90 | 180 | 270;

const ROTACIONES_VALIDAS: readonly RotacionValida[] = [0, 90, 180, 270];

export type ResultadoRotacion =
  { valido: true; valor: RotacionValida } | { valido: false; error: string };

/**
 * Campo `rotacion` opcional del multipart. Ausente/vacío = sin rotación. Solo se admiten
 * giros de 90° para no tener que definir un color de relleno de fondo (sin spec que lo pida).
 */
export function parsearRotacion(valor: unknown): ResultadoRotacion {
  if (valor === undefined || valor === null || valor === '') {
    return { valido: true, valor: 0 };
  }

  const numero = Number(valor);

  if (!ROTACIONES_VALIDAS.includes(numero as RotacionValida)) {
    return { valido: false, error: 'La rotación debe ser 0, 90, 180 o 270 grados' };
  }

  return { valido: true, valor: numero as RotacionValida };
}

export interface Recorte {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ResultadoRecorte =
  { valido: true; valor: Recorte | null } | { valido: false; error: string };

const CAMPOS_RECORTE = ['cropX', 'cropY', 'cropWidth', 'cropHeight'] as const;

/**
 * Campos `cropX`/`cropY`/`cropWidth`/`cropHeight` opcionales del multipart, en píxeles sobre
 * la imagen ORIGINAL subida (antes de cualquier resize de compresión). Ausentes los cuatro =
 * sin recorte; presentes solo algunos = error, porque un rectángulo a medias no se puede
 * completar sin inventar un valor. Los límites contra el tamaño real de la imagen se
 * verifican después, en el middleware, porque acá no se conocen sus dimensiones.
 */
export function parsearRecorte(body: Record<string, unknown>): ResultadoRecorte {
  const presentes = CAMPOS_RECORTE.filter(
    (campo) => body[campo] !== undefined && body[campo] !== '',
  );

  if (presentes.length === 0) {
    return { valido: true, valor: null };
  }

  if (presentes.length < CAMPOS_RECORTE.length) {
    return {
      valido: false,
      error: 'Para recortar la imagen hay que enviar cropX, cropY, cropWidth y cropHeight',
    };
  }

  const left = Number(body.cropX);
  const top = Number(body.cropY);
  const width = Number(body.cropWidth);
  const height = Number(body.cropHeight);

  if (![left, top, width, height].every((numero) => Number.isInteger(numero) && numero >= 0)) {
    return {
      valido: false,
      error: 'Las coordenadas de recorte deben ser números enteros positivos',
    };
  }

  const minimo = LIMITES.imagen.recorteMinimoPx;

  if (width < minimo || height < minimo) {
    return {
      valido: false,
      error: `El recorte debe tener al menos ${minimo}x${minimo} píxeles`,
    };
  }

  return { valido: true, valor: { left, top, width, height } };
}
