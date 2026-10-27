/**
 * Estados de una solicitud y causas de sus estados finales, en un solo lugar.
 *
 * Quien necesite saber si una solicitud sigue abierta usa `estaAbierta`: repetir la lista en
 * cada módulo deja huecos apenas se agrega una etapa.
 */
import type { MotivoSolicitud } from '@prisma/client';

export const ESTADO_SOLICITUD = {
  PENDIENTE: 'Pendiente',
  EN_REVISION: 'En_Revision',
  REVISADA: 'Revisada',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  CANCELADA: 'Cancelada',
  CERRADA: 'Cerrada',
} as const;

export type NombreEstadoSolicitud = (typeof ESTADO_SOLICITUD)[keyof typeof ESTADO_SOLICITUD];

/** Todavía puede cambiar de estado. */
export const ESTADOS_SOLICITUD_ABIERTA: readonly NombreEstadoSolicitud[] = [
  ESTADO_SOLICITUD.PENDIENTE,
  ESTADO_SOLICITUD.EN_REVISION,
  ESTADO_SOLICITUD.REVISADA,
];

/** No tiene salida: el refugio decidió (Aprobada, Rechazada), el solicitante (Cancelada) o nadie (Cerrada). */
export const ESTADOS_SOLICITUD_FINAL: readonly NombreEstadoSolicitud[] = [
  ESTADO_SOLICITUD.APROBADA,
  ESTADO_SOLICITUD.RECHAZADA,
  ESTADO_SOLICITUD.CANCELADA,
  ESTADO_SOLICITUD.CERRADA,
];

export function estaAbierta(nombre: string | undefined): boolean {
  return nombre !== undefined && (ESTADOS_SOLICITUD_ABIERTA as readonly string[]).includes(nombre);
}

/** Causas válidas de cada estado final que lleva una. */
export const MOTIVOS_POR_ESTADO = {
  [ESTADO_SOLICITUD.RECHAZADA]: [
    'NO_CUMPLE_REQUISITOS',
    'MASCOTA_CON_HOGAR',
    'SIN_CONTACTO',
    'OTRO',
  ],
  [ESTADO_SOLICITUD.CANCELADA]: ['RETIRADA_POR_SOLICITANTE', 'CUENTA_CERRADA_SOLICITANTE'],
  [ESTADO_SOLICITUD.CERRADA]: [
    'ADOPTADA_POR_OTRA_PERSONA',
    'MASCOTA_FALLECIDA',
    'PUBLICACION_RETIRADA',
    'PUBLICANTE_CERRO_CUENTA',
    'VENCIDA_SIN_RESPUESTA',
  ],
} as const satisfies Partial<Record<NombreEstadoSolicitud, readonly MotivoSolicitud[]>>;

export const MOTIVOS_RECHAZO = MOTIVOS_POR_ESTADO[ESTADO_SOLICITUD.RECHAZADA];

/** Si `motivo` es una de las causas del estado. Los estados sin causa solo aceptan `null`. */
export function motivoCorresponde(
  estado: NombreEstadoSolicitud,
  motivo: MotivoSolicitud | null,
): boolean {
  const permitidos = (MOTIVOS_POR_ESTADO as Partial<Record<string, readonly string[]>>)[estado];

  if (!permitidos) return motivo === null;
  return motivo !== null && permitidos.includes(motivo);
}
