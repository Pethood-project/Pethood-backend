/**
 * Máquina de estados de la campaña y cuentas del progreso (spec 021 §6.4). Funciones puras:
 * las usan el servicio (alta, finalizar/cancelar, aplicar una donación) y el cron (HU-12.4),
 * así la regla vive en un solo lugar.
 */
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';

export const ESTADO_CAMPANIA = {
  INACTIVA: 'Inactiva',
  ACTIVA: 'Activa',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
} as const;

export type NombreEstadoCampania = (typeof ESTADO_CAMPANIA)[keyof typeof ESTADO_CAMPANIA];

export const ESTADO_DONACION = {
  PENDIENTE: 'Pendiente',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
} as const;

export type NombreEstadoDonacion = (typeof ESTADO_DONACION)[keyof typeof ESTADO_DONACION];

/** Las que cuentan para la quota de 5 (§6.3): todavía no cerraron. */
export const ESTADOS_VIGENTES: readonly NombreEstadoCampania[] = [
  ESTADO_CAMPANIA.INACTIVA,
  ESTADO_CAMPANIA.ACTIVA,
];

/** Los únicos estados que un miembro del refugio puede pedir a mano (HU-12.5 y HU-12.6). */
export const ESTADOS_MANUALES = [ESTADO_CAMPANIA.FINALIZADA, ESTADO_CAMPANIA.CANCELADA] as const;
export type EstadoManual = (typeof ESTADOS_MANUALES)[number];

/** Por qué el refugio rechaza una donación (HU-12.3). */
export const MOTIVOS_RECHAZO = ['NO_RECIBIDA', 'MONTO_NO_COINCIDE'] as const;
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

/** Desde qué estados se llega a cada estado manual. Finalizada y Cancelada son finales. */
const ORIGENES_MANUALES: Record<EstadoManual, readonly string[]> = {
  Finalizada: [ESTADO_CAMPANIA.ACTIVA],
  Cancelada: [ESTADO_CAMPANIA.INACTIVA, ESTADO_CAMPANIA.ACTIVA],
};

export function transicionManualPermitida(desde: string, hacia: EstadoManual): boolean {
  return ORIGENES_MANUALES[hacia].includes(desde);
}

export interface CampaniaParaEvaluar {
  estado: string;
  fechaInicio: Date;
  fechaFin: Date;
  objetivo: number;
  /** Suma de las donaciones Realizada. */
  recaudado: number;
}

/**
 * A qué estado lleva el SISTEMA a la campaña en este momento (HU-12.4), o `null` si no cambia.
 *
 * Aplica los dos pasos de una vez: una Inactiva con la fecha de fin ya vencida (por ejemplo, si
 * el cron no corrió) termina Finalizada en la misma corrida. La fecha de inicio cuenta desde el
 * comienzo de ese día y la de fin hasta su último instante.
 */
export function siguienteEstadoAutomatico(
  campania: CampaniaParaEvaluar,
  ahora: Date,
): NombreEstadoCampania | null {
  let estado = campania.estado;

  if (
    estado === ESTADO_CAMPANIA.INACTIVA &&
    inicioDelDia(campania.fechaInicio).getTime() <= ahora.getTime()
  ) {
    estado = ESTADO_CAMPANIA.ACTIVA;
  }

  if (
    estado === ESTADO_CAMPANIA.ACTIVA &&
    (finDelDia(campania.fechaFin).getTime() < ahora.getTime() ||
      campania.recaudado >= campania.objetivo)
  ) {
    estado = ESTADO_CAMPANIA.FINALIZADA;
  }

  return estado === campania.estado ? null : (estado as NombreEstadoCampania);
}

/** Para la barra: hacia abajo y topeado en 100 (el recaudado real puede superar el objetivo). */
export function calcularPorcentaje(recaudado: number, objetivo: number): number {
  if (objetivo <= 0) return 0;
  // Multiplicar antes de dividir: `57000 / 100000 * 100` da 56.99… y el floor perdía un punto.
  return Math.min(100, Math.floor((recaudado * 100) / objetivo));
}
