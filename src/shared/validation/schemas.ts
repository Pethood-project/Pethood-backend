/**
 * Adaptador fino entre las utilidades puras de esta carpeta y Zod. Acá no vive ninguna
 * regla: solo se envuelve lo de `dates.ts`, `numbers.ts` y `text.ts` para componerlo en
 * un `<modulo>.dto.ts`. Todo lo que llega por multipart es string, por eso cada schema
 * coerciona en vez de confiar en el tipo que mande el cliente.
 */
import { z } from 'zod';
import { parsearFecha, validarFechaFutura, validarFechaPasada } from './dates';
import { parsearCoordenada, parsearDecimal, parsearId, parsearListaDeIds } from './numbers';
import {
  mensajeInvalido,
  mensajeObligatorio,
  parsearListaDeTextos,
  parsearListaDeValores,
  parsearListaJson,
  validarTexto,
  type OpcionesTexto,
} from './text';

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

/**
 * Vuelve opcional un schema que de por sí es obligatorio (teléfono, correo): lo que llega
 * vacío o no llega queda en null, y lo que trae algo se valida con el schema original.
 *
 * Es para formularios que mandan todos los campos siempre, donde borrar un dato opcional
 * llega como cadena vacía por multipart: con `.optional()` a secas ese vacío se validaría
 * como teléfono y fallaría.
 */
export function vacioComoNuloSchema<T extends z.ZodTypeAny>(schema: T) {
  return z
    .preprocess(
      (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
      schema.optional(),
    )
    .transform((valor): z.output<T> | null => valor ?? null);
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

/**
 * Punta de un rango de fechas de un filtro (`?fechaDesde=2026-09-01`). Vacía o ausente queda
 * `undefined` —"sin esa punta"—, no es un error. A diferencia de las fechas de un formulario,
 * no se exige pasada ni futura: filtrar hacia adelante sólo trae una lista vacía.
 */
export function fechaFiltroSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') return undefined;

    const fecha = parsearFecha(valor as string | Date);

    if (!fecha) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${etiqueta} no es válida` });
      return z.NEVER;
    }

    return fecha;
  });
}

/** Latitud o longitud con signo (ver `parsearCoordenada`). */
export function coordenadaSchema(opciones: { min: number; max: number; etiqueta: string }) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = parsearCoordenada(valor as string | number, opciones);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/**
 * Textos libres de un filtro de selección múltiple, un parámetro por valor
 * (`?localidades=Maipú&localidades=Godoy%20Cruz`). Ausente → `[]`, "sin filtro".
 */
export function listaDeTextosSchema(opciones: {
  max: number;
  maximoElementos: number;
  etiqueta: string;
}) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = parsearListaDeTextos(valor, opciones);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
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

/**
 * Id de una FK, que puede llegar como número (JSON) o como texto (multipart, query).
 *
 * No usa `z.coerce.number`: la coerción convierte un campo ausente en `NaN` y Zod lo reporta
 * con su mensaje en inglés ("Expected number, received nan"), que llegaba tal cual al cliente.
 * Los mensajes concuerdan en género con la etiqueta ("La especie es obligatoria").
 */
export function idSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensajeObligatorio(etiqueta) });
      return z.NEVER;
    }

    const id = parsearId(valor);

    if (id === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensajeInvalido(etiqueta) });
      return z.NEVER;
    }

    return id;
  });
}

/**
 * Tamaño de página de un listado paginado (`?limite=20`). Ausente toma el valor por defecto;
 * fuera de rango es un error en español, no el mensaje en inglés de Zod.
 */
export function limitePaginaSchema(opciones: { porDefecto: number; maximo: number }) {
  const { porDefecto, maximo } = opciones;

  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') return porDefecto;

    const limite = parsearId(valor);

    if (limite === null || limite > maximo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El límite tiene que ser un número entre 1 y ${maximo}`,
      });
      return z.NEVER;
    }

    return limite;
  });
}

/**
 * Lista de ids separada por comas en la query string (`?estados=1,3`). Ausente → `[]`, que
 * el servicio interpreta como "sin filtro".
 */
export function listaDeIdsSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = parsearListaDeIds(valor, etiqueta);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/**
 * Lista separada por comas de valores de un catálogo cerrado (`?estados=Pendiente,Aprobada`).
 * Ausente → `[]`, que el servicio interpreta como "sin filtro".
 */
export function listaDeValoresSchema<T extends string>(permitidos: readonly T[], etiqueta: string) {
  return z.unknown().transform((valor, ctx): T[] => {
    const resultado = parsearListaDeValores(valor, permitidos, etiqueta);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/** Entero dentro de un rango (ej. el orden de una FAQ). Coerciona: llega como string en query/form. */
export function enteroSchema(opciones: { min: number; max: number; etiqueta: string }) {
  const { min, max, etiqueta } = opciones;
  return z.coerce
    .number({
      required_error: `${etiqueta} es obligatorio`,
      invalid_type_error: `${etiqueta} no es válido`,
    })
    .int(`${etiqueta} no es válido`)
    .min(min, `${etiqueta} debe estar entre ${min} y ${max}`)
    .max(max, `${etiqueta} debe estar entre ${min} y ${max}`);
}

/**
 * Lista de objetos que llega como JSON en un campo multipart (ver `parsearListaJson`). Cada
 * ítem se valida con `item`, así sus mensajes llegan tal cual al usuario.
 */
export function listaJsonSchema<T extends z.ZodTypeAny>(
  item: T,
  opciones: { max: number; etiqueta: string },
) {
  const { max, etiqueta } = opciones;

  return z
    .unknown()
    .transform((valor, ctx) => {
      const resultado = parsearListaJson(valor, etiqueta);

      if (!resultado.valido) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
        return z.NEVER;
      }

      return resultado.valor;
    })
    .pipe(z.array(item).max(max, `${etiqueta}: como máximo ${max}`));
}

/**
 * Fecha opcional de un filtro por rango. Vacío o ausente devuelve `undefined` (sin filtro);
 * con valor, tiene que ser una fecha real. Se usa en las dos puntas de un rango.
 */
export function fechaOpcionalSchema(campo: string) {
  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') return undefined;

    const fecha = parsearFecha(valor as string | Date);
    if (!fecha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [campo],
        message: 'La fecha no es válida',
      });
      return z.NEVER;
    }

    return fecha;
  });
}

/**
 * Coordenada geográfica opcional (latitud o longitud), en grados decimales. Acepta coma o
 * punto, porque en la query llega como texto. Se valida contra el rango real de la esfera.
 *
 * A diferencia de `coordenadaSchema`, vacío/ausente devuelve `undefined` ("sin filtro"): es
 * para coordenadas opcionales (filtros del feed, ficha) donde el cliente puede no mandarlas.
 */
export function coordenadaOpcionalSchema(etiqueta: string, min: number, max: number) {
  return z.unknown().transform((valor, ctx) => {
    if (valor === undefined || valor === null || valor === '') return undefined;

    const numero = Number(typeof valor === 'string' ? valor.replace(',', '.') : valor);

    if (!Number.isFinite(numero) || numero < min || numero > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${etiqueta} no es válida` });
      return z.NEVER;
    }

    return numero;
  });
}

/**
 * URL http(s) obligatoria, con un largo máximo. Para links que el usuario pega a mano (ej.
 * el de Google Maps): valida el protocolo y el largo, no el contenido del sitio.
 */
export function urlSchema(etiqueta: string, max: number) {
  return z.unknown().transform((valor, ctx) => {
    const texto = typeof valor === 'string' ? valor.trim() : '';

    if (!texto) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${etiqueta} es obligatorio` });
      return z.NEVER;
    }

    if (texto.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${etiqueta} no puede superar los ${max} caracteres`,
      });
      return z.NEVER;
    }

    try {
      const url = new URL(texto);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocolo');
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${etiqueta} no es un link válido` });
      return z.NEVER;
    }

    return texto;
  });
}
