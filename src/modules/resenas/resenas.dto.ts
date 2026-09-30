/**
 * Entrada y salida de Reseña (Módulo 10): alta (HU-10.1 a HU-10.4), historial/promedio
 * (HU-10.5) y transacciones elegibles para reseñar. Las reglas genéricas salen de
 * `shared/validation`; acá sólo se compone lo propio de Reseña.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { enteroSchema, idSchema, textoOpcionalSchema } from '../../shared/validation/schemas';

/**
 * Alta de reseña. `solicitudId` es la transacción CONCRETADA que la habilita: sin ella no se
 * puede validar que las dos partes hayan cerrado una adopción o un tránsito. La puntuación es
 * obligatoria (1-5) y el comentario opcional. El receptor lo calcula el service a partir de la
 * solicitud; nunca lo elige el cliente, para que no se pueda reseñar a un tercero.
 */
export const crearResenaSchema = z.object({
  solicitudId: idSchema('La solicitud'),
  puntuacion: enteroSchema({ ...LIMITES.resena.puntuacion, etiqueta: 'La puntuación' }),
  comentario: textoOpcionalSchema({ ...LIMITES.resena.comentario, etiqueta: 'El comentario' }),
});

export type CrearResenaDto = z.infer<typeof crearResenaSchema>;

/** Nombres reales del catálogo TipoSolicitud (prisma/seed.ts), para tipar el flujo. */
const TIPOS_SOLICITUD = ['Adopcion', 'Transito'] as const;

/**
 * Qué flujo de transacción habilitó la reseña. Se deriva de la solicitud; `null` en las
 * reseñas históricas sembradas antes de que existiera el vínculo con la transacción.
 */
export type FlujoResena =
  | 'ADOPTANTE_A_REFUGIO'
  | 'ADOPTANTE_A_ADOPTANTE'
  | 'REFUGIO_A_ADOPTANTE'
  | 'REFUGIO_A_TRANSITO';

/** Quién es el receptor de la reseña: un refugio o una persona (adoptante / hogar de tránsito). */
export type TipoReceptor = 'REFUGIO' | 'PERSONA';

export interface AutorResenaDto {
  id: number;
  nombre: string;
  apellido: string;
  imagenUrl: string | null;
}

/** Una reseña vista desde el perfil del receptor. Nunca expone datos de la contraparte. */
export interface ResenaDto {
  id: number;
  puntuacion: number;
  comentario: string | null;
  /** Instante ISO de alta. */
  fecha: string;
  autor: AutorResenaDto;
  receptor: TipoReceptor;
  flujo: FlujoResena | null;
}

/** Cuántas reseñas hay de cada puntuación, de 5 a 1 para pintar el desglose en ese orden. */
export interface DistribucionEstrellasDto {
  puntuacion: number;
  cantidad: number;
}

/**
 * Historial completo de reputación de un usuario o un refugio: promedio redondeado a un
 * decimal (o `null` sin reseñas), cantidad, desglose y comentarios del más nuevo al más viejo.
 */
export interface ResumenResenasDto {
  promedio: number | null;
  cantidad: number;
  distribucion: DistribucionEstrellasDto[];
  resenas: ResenaDto[];
}

/** La contraparte de una transacción, para que el modal sepa a quién se está valorando. */
export interface ContraparteResenaDto {
  tipo: TipoReceptor;
  id: number;
  nombre: string;
  imagenUrl: string | null;
}

/** Una transacción concretada que el usuario todavía no reseñó (habilitante de HU-10.1). */
export interface TransaccionElegibleDto {
  solicitudId: number;
  /** `Adopcion` o `Transito`. */
  tipoSolicitud: string;
  /** Fecha de alta de la solicitud, para ordenar y contextualizar. */
  fecha: string;
  mascota: { id: number; nombre: string | null; imagenUrl: string | null };
  contraparte: ContraparteResenaDto;
  /** Qué flujo representaría la reseña, para que la UI ajuste el texto. */
  flujo: FlujoResena;
}

/** Tipo del catálogo, exportado por si otro módulo necesita derivar el flujo. */
export const NOMBRES_TIPO_SOLICITUD = TIPOS_SOLICITUD;
