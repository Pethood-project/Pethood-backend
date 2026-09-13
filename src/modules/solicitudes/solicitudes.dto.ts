/**
 * Entrada y salida de Solicitud: HU-7.1 (crear), HU-7.3 (historial propio del solicitante),
 * HU-7.4 (resolver) y HU-7.5 (listado/detalle recibidos por el refugio). Las reglas
 * genéricas salen de `shared/validation`; acá solo se compone lo propio de Solicitud.
 */
import { z } from 'zod';
import { esPasada, parsearFecha } from '../../shared/validation/dates';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoSchema,
  idSchema,
  textoOpcionalSchema,
  textoSchema,
} from '../../shared/validation/schemas';

/** Nombres reales del catálogo TipoSolicitud (prisma/seed.ts). */
export const TIPOS_SOLICITUD = ['Adopcion', 'Transito'] as const;
export type TipoSolicitudNombre = (typeof TIPOS_SOLICITUD)[number];

/** Respuestas cerradas del paso 2 de GUI-7.1.1. Se guardan tal cual en `Hogar`. */
export const TIPOS_VIVIENDA = ['Casa', 'Departamento', 'Otro'] as const;
export const ESPACIOS_EXTERIORES = ['Balcon', 'Patio', 'Jardin', 'Ninguno'] as const;

/**
 * Texto literal que exige HU-7.1 cuando el adoptante elige tránsito y no completa el
 * período. No es el mensaje genérico de campo vacío: la HU lo fija palabra por palabra.
 */
const FALTA_PERIODO = 'Tenés que completar el campo';

/** Paso 2: el hogar del solicitante. Viaja anidado para no mezclarlo con la solicitud. */
const hogarSchema = z.object({
  direccion: textoSchema({ ...LIMITES.hogar.direccion, etiqueta: 'La dirección' }),
  tipoVivienda: z.enum(TIPOS_VIVIENDA, {
    required_error: 'Elegí el tipo de vivienda',
    invalid_type_error: 'El tipo de vivienda no es válido',
  }),
  espacioExterior: z.enum(ESPACIOS_EXTERIORES, {
    required_error: 'Elegí si tenés espacios al aire libre',
    invalid_type_error: 'El espacio al aire libre no es válido',
  }),
  tieneNinios: booleanoSchema(),
  tieneMascotas: booleanoSchema(),
  detalleMascotas: textoOpcionalSchema({
    ...LIMITES.hogar.detalleMascotas,
    etiqueta: 'El detalle de tus mascotas',
  }),
  experienciaPrevia: booleanoSchema(),
  // Los tres valores son el TOPE de cada rango, no una cantidad exacta de horas: el
  // formulario ofrece "menos de 4", "entre 4 y 8" y "más de 8".
  horasSolo: z.union([z.literal(4), z.literal(8), z.literal(12)], {
    errorMap: () => ({ message: 'Elegí cuántas horas quedaría sola' }),
  }),
  descripcion: textoOpcionalSchema({
    ...LIMITES.hogar.descripcion,
    etiqueta: 'La descripción de tu casa',
  }),
});

export type HogarDto = z.infer<typeof hogarSchema>;

/**
 * Alta de solicitud (HU-7.1). El período de tránsito no se puede validar campo por campo
 * porque su obligatoriedad depende de `tipoSolicitud`: se acepta cualquier fecha en el
 * schema base y las reglas cruzadas van en el `superRefine`.
 */
export const crearSolicitudSchema = z
  .object({
    publicacionId: idSchema('La publicación'),
    tipoSolicitud: z.enum(TIPOS_SOLICITUD, {
      required_error: 'Elegí si querés adoptar o ser hogar de tránsito',
      invalid_type_error: 'El tipo de solicitud no es válido',
    }),
    motivacion: textoSchema({ ...LIMITES.solicitud.motivacion, etiqueta: 'La motivación' }),
    fechaInicioTransito: z.unknown().optional(),
    fechaFinTransito: z.unknown().optional(),
    hogar: hogarSchema,
  })
  .transform((datos, ctx) => {
    const esTransito = datos.tipoSolicitud === 'Transito';

    // En una adopción el período no existe: lo que haya llegado se descarta en vez de
    // rechazarse, así un formulario que cambia de tránsito a adopción no queda trabado
    // por campos que el usuario ya no ve.
    if (!esTransito) {
      return { ...datos, fechaInicioTransito: null, fechaFinTransito: null };
    }

    const inicio = exigirFechaDePeriodo(datos.fechaInicioTransito, 'fechaInicioTransito', ctx);
    const fin = exigirFechaDePeriodo(datos.fechaFinTransito, 'fechaFinTransito', ctx);

    if (inicio && fin && fin.getTime() <= inicio.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaFinTransito'],
        message: 'La fecha de fin tiene que ser posterior a la de inicio',
      });
    }

    return { ...datos, fechaInicioTransito: inicio, fechaFinTransito: fin };
  });

/**
 * Una punta del período de tránsito: obligatoria, real y no pasada. Devuelve `null` y
 * carga el issue en vez de cortar, para que el formulario reciba de una los dos campos
 * que le faltan y no de a uno por request.
 */
function exigirFechaDePeriodo(
  valor: unknown,
  campo: 'fechaInicioTransito' | 'fechaFinTransito',
  ctx: z.RefinementCtx,
): Date | null {
  const agregarIssue = (message: string): null => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message });
    return null;
  };

  if (valor === undefined || valor === null || valor === '') return agregarIssue(FALTA_PERIODO);

  const fecha = parsearFecha(valor as string | Date);
  if (!fecha) return agregarIssue('La fecha no es válida');

  // `esPasada` compara contra el inicio del día de hoy: un tránsito que arranca hoy vale.
  if (esPasada(fecha)) return agregarIssue('La fecha no puede ser anterior a hoy');

  return fecha;
}

export type CrearSolicitudDto = z.infer<typeof crearSolicitudSchema>;

/** El refugio solo puede llevar una solicitud "Pendiente" a uno de estos dos destinos. */
export const ESTADOS_RESOLUCION = ['Aprobada', 'Rechazada'] as const;

export const resolverSolicitudSchema = z.object({
  estado: z.enum(ESTADOS_RESOLUCION, {
    required_error: 'El estado es obligatorio',
    invalid_type_error: 'El estado no es válido',
  }),
  comentario: textoOpcionalSchema({
    ...LIMITES.solicitud.comentario,
    etiqueta: 'El comentario',
  }),
});

export type ResolverSolicitudDto = z.infer<typeof resolverSolicitudSchema>;

/** Nombres reales del catálogo EstadoSolicitud (prisma/seed.ts). */
export const NOMBRES_ESTADO_SOLICITUD = [
  'Pendiente',
  'En_Revision',
  'Aprobada',
  'Rechazada',
  'Cancelada',
] as const;

export const filtrosRecibidasSchema = z.object({
  estado: z.enum(NOMBRES_ESTADO_SOLICITUD).optional(),
  limite: z.coerce.number().int().positive().max(50).optional().default(20),
  desplazamiento: z.coerce.number().int().min(0).optional().default(0),
});

export type FiltrosRecibidasDto = z.infer<typeof filtrosRecibidasSchema>;

/** El historial propio del solicitante (HU-7.3) se filtra y pagina igual que el recibido. */
export const filtrosMiasSchema = filtrosRecibidasSchema;

export type FiltrosMiasDto = FiltrosRecibidasDto;

export const idSolicitudSchema = idSchema('El id de la solicitud');

/** La publicación es opcional: sin ella solo se evalúa al usuario. */
export const filtrosElegibilidadSchema = z.object({
  publicacionId: idSchema('La publicación').optional(),
});

export type FiltrosElegibilidadDto = z.infer<typeof filtrosElegibilidadSchema>;

/**
 * Chequeo previo de HU-7.1: si el usuario puede abrir el formulario y, si no, por qué.
 * Los contadores viajan además del motivo para que el cartel pueda decir "ya tenés 5 de 5"
 * sin que la UI recalcule nada.
 */
export interface ElegibilidadDto {
  puedeSolicitar: boolean;
  /** `null` cuando puede solicitar. */
  motivo: 'NO_VERIFICADO' | 'LIMITE_ALCANZADO' | 'YA_SOLICITADA' | null;
  /** Texto literal de la HU para ese motivo, o `null`. */
  mensaje: string | null;
  verificado: boolean;
  pendientes: number;
  maximo: number;
  /** Solicitud viva del usuario sobre esa publicación, para el CTA "Ver mi solicitud". */
  solicitudAbiertaId: number | null;
  /**
   * Hogar vigente del usuario, o null si nunca cargó uno. Con esto el paso 2 del formulario
   * arranca como resumen de lo ya declarado en vez de ocho campos vacíos, sin una petición
   * aparte: la UI ya llama a este endpoint antes de abrir el modal.
   */
  hogar: HogarSolicitanteDto | null;
}

/** Período ofrecido en una solicitud de tránsito. Null cuando el tipo es "Adopcion". */
export interface PeriodoTransitoDto {
  /** `AAAA-MM-DD`: es un día del calendario, no un instante. */
  fechaInicio: string;
  fechaFin: string;
}

export interface SolicitudResumenDto {
  id: number;
  publicacionId: number;
  mascota: { id: number; nombre: string | null; imagenUrl: string | null };
  solicitante: { id: number; nombre: string; apellido: string };
  tipoSolicitud: string;
  estado: { id: number; nombre: string };
  comentario: string | null;
  transito: PeriodoTransitoDto | null;
  fechaAlta: string;
  fechaRespuesta: string | null;
}

/** Una fila del histórico de HU-7.5, ordenado del estado más reciente al más viejo. */
export interface EstadoSolicitudDto {
  id: number;
  nombre: string;
  fecha: string;
}

/**
 * El hogar declarado por el solicitante, tal como lo lee quien resuelve la solicitud.
 * Null si es una solicitud anterior a HU-7.1, cuando el formulario todavía no lo pedía.
 */
export interface HogarSolicitanteDto {
  direccion: string;
  tipoVivienda: string | null;
  espacioExterior: string | null;
  tieneNinios: boolean;
  tieneMascotas: boolean;
  detalleMascotas: string | null;
  experienciaPrevia: boolean;
  horasSolo: number | null;
  descripcion: string | null;
}

/**
 * El hogar vigente hoy, cuando NO es el mismo que se declaró al enviar la solicitud: el
 * solicitante se mudó o corrigió sus datos después.
 *
 * Es señal de control para quien resuelve y para el seguimiento post-adopción: le dice
 * dónde dijo que estaría el animal y dónde dice estar ahora. Null cuando no cambió nada,
 * que es el caso normal.
 */
export interface CambioDeHogarDto {
  hogar: HogarSolicitanteDto;
  /** Cuándo se cargó la versión vigente. */
  fechaCambio: string;
}

export interface SolicitudDetalleDto extends SolicitudResumenDto {
  motivacion: string;
  /** Lo que el solicitante declaró al enviar, o sea lo que se está evaluando. */
  hogar: HogarSolicitanteDto | null;
  /** Solo viene si el hogar cambió después de enviar la solicitud. */
  cambioDeHogar: CambioDeHogarDto | null;
  historial: EstadoSolicitudDto[];
}

export interface ListaSolicitudesRecibidasDto {
  /** Total que matchea el filtro, no el largo de esta página. */
  total: number;
  solicitudes: SolicitudResumenDto[];
}
