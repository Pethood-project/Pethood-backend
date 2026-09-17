/**
 * Adaptador fino entre las utilidades puras de esta carpeta y Zod. Acá no vive ninguna
 * regla: solo se envuelve lo de `dates.ts`, `numbers.ts` y `text.ts` para componerlo en
 * un `<modulo>.dto.ts`. Todo lo que llega por multipart es string, por eso cada schema
 * coerciona en vez de confiar en el tipo que mande el cliente.
 */
import { z } from 'zod';
import { validarFechaFutura, validarFechaPasada } from './dates';
import { parsearDecimal } from './numbers';
import { validarTexto, type OpcionesTexto } from './text';

export function textoSchema(opciones: Omit<OpcionesTexto, 'obligatorio'>) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarTexto(valor, opciones);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/** Texto que puede venir vacío. Devuelve null en ese caso, para guardarlo así en base. */
export function textoOpcionalSchema(opciones: { max: number; etiqueta: string }) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarTexto(valor, { ...opciones, obligatorio: false });

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor === '' ? null : resultado.valor;
  });
}

/**
 * Igual que `textoOpcionalSchema` pero el vacío queda como cadena vacía y no como null.
 *
 * Es para columnas NOT NULL donde "sin texto" es un valor legítimo y no un dato ausente:
 * `mensaje_contenido` en un mensaje de solo foto (HU-5.2). Va aparte y no como opción del
 * otro para que el tipo inferido sea `string` y el service no tenga que descartar un null
 * que nunca puede llegar.
 */
export function textoOpcionalNoNuloSchema(opciones: { max: number; etiqueta: string }) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarTexto(valor, { ...opciones, obligatorio: false });

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

export function fechaPasadaSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarFechaPasada(valor as string | Date, etiqueta);

    if (!resultado.valida) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.fecha;
  });
}

/** Fecha estrictamente futura y obligatoria (ej. próximo control). */
export function fechaFuturaSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarFechaFutura(valor as string | Date, etiqueta);

    if (!resultado.valida) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.fecha;
  });
}

/** Igual que `fechaFuturaSchema`, pero vacío/ausente se acepta y devuelve null. */
export function fechaFuturaOpcionalSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') return null;

    const resultado = validarFechaFutura(valor as string | Date, etiqueta);

    if (!resultado.valida) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.fecha;
  });
}

export function decimalSchema(opciones: {
  min: number;
  max: number;
  decimales: number;
  etiqueta: string;
}) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = parsearDecimal(valor as string | number, opciones);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/**
 * Sí/no que puede llegar como booleano (JSON) o como texto (`'true'`/`'false'` de un form
 * multipart). Ausente cuenta como `false`: en un alta, un switch que nadie tocó está apagado.
 */
export function booleanoSchema() {
  return z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((valor) => valor === true || valor === 'true');
}

/**
 * Igual que `booleanoSchema`, pero conserva la diferencia entre "llegó en false" y "no
 * llegó". Es el que necesita una edición parcial: ahí un campo ausente significa "no lo
 * toques", y colapsarlo a `false` apagaría una bandera que nadie tocó.
 */
export function booleanoOpcionalSchema() {
  return z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((valor) => (valor === undefined ? undefined : valor === true || valor === 'true'));
}

export function idSchema(etiqueta: string) {
  return z.coerce
    .number({ required_error: `${etiqueta} es obligatorio` })
    .int(`${etiqueta} no es válido`)
    .positive(`${etiqueta} no es válido`);
}
