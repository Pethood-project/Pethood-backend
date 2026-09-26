/**
 * Entrada y salida del seguimiento post-adopción (spec 011). Las reglas genéricas (trim,
 * longitudes) salen de `shared/validation`; acá solo se compone lo propio del módulo.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { textoSchema } from '../../shared/validation/schemas';

/**
 * HU-9.1. Los textos de error son LITERALES de la historia de usuario ("Completar
 * descripción", "Limite de caracteres superado"): son consigna académica evaluable, no
 * redacción libre. La regla que decide si el valor es válido sigue viviendo en
 * `shared/validation/text.ts` — acá solo se le pasa qué mensaje mostrar.
 *
 * La foto no se valida acá: llega como archivo por multipart, así que la exige el service
 * (mensaje "Adjuntar imagen de prueba").
 */
export const subirActualizacionSchema = z.object({
  descripcion: textoSchema({
    ...LIMITES.seguimiento.descripcion,
    etiqueta: 'La descripción',
    errorObligatorio: 'Completar descripción',
    errorLongitud: 'Limite de caracteres superado',
  }),
});

export type SubirActualizacionDto = z.infer<typeof subirActualizacionSchema>;

/** Pregunta que el refugio le escribe a mano al adoptante (spec 011 §6.11). */
export const enviarPreguntaSchema = z.object({
  texto: textoSchema({ ...LIMITES.seguimiento.pregunta, etiqueta: 'La pregunta' }),
});

export type EnviarPreguntaDto = z.infer<typeof enviarPreguntaSchema>;

/** Estado derivado de un pedido de seguimiento — no se guarda en base (spec 011 §3). */
export type EstadoSeguimiento = 'PENDIENTE' | 'VENCIDO' | 'COMPLETADO';

/** Desde qué lado mira el usuario: quien tiene la mascota, o quien la entregó. */
export type RolSeguimiento = 'ADOPTANTE' | 'PUBLICADOR';

export interface MascotaSeguimientoDto {
  id: number;
  nombre: string | null;
  imagenUrl: string | null;
}

export interface AdoptanteSeguimientoDto {
  id: number;
  nombre: string;
  apellido: string;
}

export interface SeguimientoItemDto {
  id: number;
  /** 1-based, el número de pedido dentro de la secuencia (GUI-21). */
  numero: number;
  pregunta: string;
  /** La escribió el refugio y la mandó en el momento, fuera de la secuencia de días. */
  esManual: boolean;
  estado: EstadoSeguimiento;
  descripcion: string | null;
  fotoUrl: string | null;
  /** Cuándo llegó el pedido. */
  fechaPedido: string;
  /** Hasta cuándo se puede responder (fechaPedido + 48 h). */
  plazo: string | null;
  /** Cuándo lo respondió el adoptante, null si todavía no. */
  fechaRespuesta: string | null;
}

export interface SolicitudEnSeguimientoDto {
  solicitudId: number;
  tipo: string;
  rol: RolSeguimiento;
  mascota: MascotaSeguimientoDto;
  adoptante: AdoptanteSeguimientoDto;
  totales: { completados: number; vencidos: number; pendientes: number };
  /** El pedido que se puede responder ahora, o null si no hay ninguno (botón en gris). */
  pendiente: { id: number; pregunta: string; plazo: string | null } | null;
  proximoAviso: string | null;
  /** La secuencia se agotó (adopción) o terminó el período de tránsito. */
  finalizado: boolean;
}

export interface DetalleSeguimientoDto {
  solicitudId: number;
  tipo: string;
  rol: RolSeguimiento;
  puedeSubirActualizacion: boolean;
  /** Solo el refugio que entregó la mascota, mientras el seguimiento no haya terminado. */
  puedeEnviarPregunta: boolean;
  /** Pregunta del refugio que reemplaza a la aleatoria del próximo pedido automático. */
  preguntaProgramada: PreguntaProgramadaDto | null;
  mascota: MascotaSeguimientoDto;
  adoptante: AdoptanteSeguimientoDto;
  proximoAviso: string | null;
  finalizado: boolean;
  /** Del más reciente al más viejo. */
  seguimientos: SeguimientoItemDto[];
}

export interface PreguntaProgramadaDto {
  id: number;
  texto: string;
  /** Cuándo la escribió el refugio. */
  fechaAlta: string;
}

export interface PreguntaEnviadaDto {
  mensaje: string;
  /**
   * `false`: se creó un pedido nuevo que el adoptante tiene que responder ya.
   * `true`: había una pregunta activa, así que quedó programada para el próximo pedido.
   */
  programada: boolean;
  detalle: DetalleSeguimientoDto;
}

export interface ActualizacionCargadaDto {
  /** Texto literal de HU-9.1. */
  mensaje: string;
  seguimiento: SeguimientoItemDto;
}

/**
 * HU-9.3: una actualización puntual, con el contexto necesario para abrirla suelta.
 *
 * Lleva mascota, adoptante y solicitud porque se puede entrar desde una notificación, sin
 * haber pasado por el expediente de la mascota: la pantalla no tendría de dónde sacar de qué
 * animal se trata.
 */
export interface ActualizacionSeguimientoDto extends SeguimientoItemDto {
  solicitudId: number;
  tipo: string;
  rol: RolSeguimiento;
  mascota: MascotaSeguimientoDto;
  adoptante: AdoptanteSeguimientoDto;
  /**
   * Texto a mostrar cuando NO hay actualización cargada, con las palabras literales de
   * HU-9.3. Es null en una completada: ahí se muestran descripción y foto.
   */
  mensaje: string | null;
}
