/**
 * Entrada y salida de campañas y donaciones (spec 021). Las reglas genéricas salen de
 * `shared/validation`; acá sólo se compone lo propio de la campaña.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  aliasOpcionalSchema,
  cbuOpcionalSchema,
  decimalSchema,
  fechaFiltroSchema,
  fechaNoPasadaSchema,
  idSchema,
  limitePaginaSchema,
  listaDeIdsSchema,
  textoSchema,
} from '../../shared/validation/schemas';
import {
  ESTADO_DONACION,
  ESTADOS_MANUALES,
  MOTIVOS_RECHAZO,
  type MotivoRechazo,
} from './campanias.estados';

const { campania, donacion } = LIMITES;

/** Alta (HU-12.1). Multipart: la imagen viaja aparte en `imagen`. */
export const crearCampaniaSchema = z
  .object({
    titulo: textoSchema({ ...campania.titulo, etiqueta: 'El título' }),
    descripcion: textoSchema({ max: campania.descripcion.max, etiqueta: 'La descripción' }),
    objetivo: decimalSchema({ ...campania.objetivo, etiqueta: 'El objetivo' }),
    fechaInicio: fechaNoPasadaSchema('La fecha de inicio'),
    fechaFin: fechaNoPasadaSchema('La fecha de fin'),
    alias: aliasOpcionalSchema(),
    cbu: cbuOpcionalSchema(),
  })
  .refine((datos) => datos.alias !== null || datos.cbu !== null, {
    message: 'Cargá el alias o el CBU/CVU para que puedan donarte',
    path: ['alias'],
  })
  // Zod corre los refine aunque un campo haya fallado (queda `z.NEVER`, no una fecha): esa
  // fecha ya tiene su propio error, acá sólo se comparan dos fechas válidas.
  .refine(
    ({ fechaInicio, fechaFin }) =>
      !(fechaInicio instanceof Date) ||
      !(fechaFin instanceof Date) ||
      fechaFin.getTime() > fechaInicio.getTime(),
    { message: 'La fecha de fin tiene que ser posterior a la de inicio', path: ['fechaFin'] },
  );

export type CrearCampaniaDto = z.infer<typeof crearCampaniaSchema>;

/** Portal del adoptante: sólo paginación. */
export const paginaCampaniasSchema = z.object({
  cursor: idSchema('El cursor').optional(),
  limite: limitePaginaSchema(campania.pagina),
});

export type PaginaCampaniasDto = z.infer<typeof paginaCampaniasSchema>;

/**
 * «Mis Campañas» (HU-12.1). `fechaDesde`/`fechaHasta` filtran por la fecha de INICIO de la
 * campaña, inclusive; «hasta» sólo vale con «desde». `estados` son ids separados por coma.
 */
export const filtrosMisCampaniasSchema = z
  .object({
    cursor: idSchema('El cursor').optional(),
    limite: limitePaginaSchema(campania.pagina),
    fechaDesde: fechaFiltroSchema('La fecha "desde"'),
    fechaHasta: fechaFiltroSchema('La fecha "hasta"'),
    estados: listaDeIdsSchema('El estado'),
  })
  .refine((filtros) => !filtros.fechaHasta || filtros.fechaDesde, {
    message: 'Para filtrar por fecha, elegí la fecha "desde"',
  })
  .refine(
    (filtros) =>
      !filtros.fechaDesde || !filtros.fechaHasta || filtros.fechaDesde <= filtros.fechaHasta,
    { message: 'La fecha "desde" no puede ser posterior a "hasta"' },
  );

export type FiltrosMisCampaniasDto = z.infer<typeof filtrosMisCampaniasSchema>;

/** «Terminar donación» (HU-12.3): lo que el adoptante dice que transfirió. */
export const donarSchema = z.object({
  monto: decimalSchema({ ...donacion.monto, etiqueta: 'El monto' }),
});

export type DonarDto = z.infer<typeof donarSchema>;

/** Finalizar (HU-12.6) o cancelar (HU-12.5). */
export const cambiarEstadoCampaniaSchema = z.object({
  estado: z.enum(ESTADOS_MANUALES, {
    errorMap: () => ({ message: 'El estado tiene que ser "Finalizada" o "Cancelada"' }),
  }),
});

export type CambiarEstadoCampaniaDto = z.infer<typeof cambiarEstadoCampaniaSchema>;

/** Bandeja de revisión del refugio. Sin `estado`, todas. */
export const filtrosDonacionesSchema = z.object({
  cursor: idSchema('El cursor').optional(),
  limite: limitePaginaSchema(donacion.pagina),
  estado: z
    .enum([ESTADO_DONACION.PENDIENTE, ESTADO_DONACION.REALIZADA, ESTADO_DONACION.CANCELADA], {
      errorMap: () => ({ message: 'El estado no es válido' }),
    })
    .optional(),
});

export type FiltrosDonacionesDto = z.infer<typeof filtrosDonacionesSchema>;

/** Aplicar (suma al progreso) o rechazar con motivo (HU-12.3). */
export const resolverDonacionSchema = z.discriminatedUnion(
  'estado',
  [
    z.object({ estado: z.literal(ESTADO_DONACION.REALIZADA) }),
    z.object({
      estado: z.literal(ESTADO_DONACION.CANCELADA),
      motivo: z.enum(MOTIVOS_RECHAZO, {
        errorMap: () => ({ message: 'Elegí por qué rechazás la donación' }),
      }),
    }),
  ],
  { errorMap: () => ({ message: 'El estado tiene que ser "Realizada" o "Cancelada"' }) },
);

export type ResolverDonacionDto = z.infer<typeof resolverDonacionSchema>;

/** Una campaña, igual en el portal, en el detalle y en «Mis Campañas». */
export interface CampaniaDto {
  id: number;
  titulo: string;
  descripcion: string;
  /** `null` sólo en campañas sembradas antes de la spec 021. */
  imagenUrl: string | null;
  objetivo: number;
  /** Suma de las donaciones Realizada: lo único que mueve la barra (regla transversal 11). */
  recaudado: number;
  /** Hacia abajo y topeado en 100, para la barra. */
  porcentaje: number;
  /** Usuarios distintos con al menos una donación Realizada. */
  donantes: number;
  /** `AAAA-MM-DD`, sin hora. */
  fechaInicio: string;
  fechaFin: string;
  estado: { id: number; nombre: string };
  alias: string | null;
  cbu: string | null;
  refugio: { id: number; nombre: string; imagenUrl: string | null };
}

/** En «Mis Campañas», además, cuántas donaciones esperan revisión. */
export interface CampaniaRefugioDto extends CampaniaDto {
  pendientes: number;
}

export interface ListaCampaniasDto<T extends CampaniaDto> {
  campanias: T[];
  hayMas: boolean;
  proximoCursor: number | null;
}

export interface DonacionDto {
  id: number;
  monto: number;
  estado: { id: number; nombre: string };
  /** Sólo en una Cancelada. */
  motivoRechazo: MotivoRechazo | null;
  /** ISO 8601: cuándo la declaró el adoptante. */
  fechaAlta: string;
  donante: { id: number; nombre: string; apellido: string; imagenUrl: string | null };
}

export interface ListaDonacionesDto {
  donaciones: DonacionDto[];
  hayMas: boolean;
  proximoCursor: number | null;
}
