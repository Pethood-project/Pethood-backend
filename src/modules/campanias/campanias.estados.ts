/**
 * Máquina de estados de la campaña y cuentas del progreso (spec 026 §6.4, reemplazada por la
 * spec 028 §6.1). Funciones puras: las usan el servicio (alta, edición, cambios de estado,
 * aplicar una donación) y el cron (HU-12.4), así la regla vive en un solo lugar.
 */
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';

export const ESTADO_CAMPANIA = {
  INACTIVA: 'Inactiva',
  ACTIVA: 'Activa',
  /** No se muestra en el portal ni recibe donaciones; el refugio la reactiva o la finaliza. */
  PAUSADA: 'Pausada',
  FINALIZADA: 'Finalizada',
} as const;

export type NombreEstadoCampania = (typeof ESTADO_CAMPANIA)[keyof typeof ESTADO_CAMPANIA];

export const ESTADO_DONACION = {
  PENDIENTE: 'Pendiente',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
} as const;

export type NombreEstadoDonacion = (typeof ESTADO_DONACION)[keyof typeof ESTADO_DONACION];

/**
 * Todavía no cerraron: cuentan para la quota de 5 (spec 026 §6.3), las evalúa el cron y se
 * pueden editar (spec 028). La Pausada cuenta porque se puede reactivar.
 */
export const ESTADOS_VIGENTES: readonly NombreEstadoCampania[] = [
  ESTADO_CAMPANIA.INACTIVA,
  ESTADO_CAMPANIA.ACTIVA,
  ESTADO_CAMPANIA.PAUSADA,
];

/**
 * Los estados que un miembro del refugio puede pedir a mano (spec 028 §6.1): finalizar, pausar
 * y reactivar (pedir «Activa» desde una Pausada). Eliminar no es un estado: es la baja lógica.
 */
export const ESTADOS_MANUALES = [
  ESTADO_CAMPANIA.FINALIZADA,
  ESTADO_CAMPANIA.PAUSADA,
  ESTADO_CAMPANIA.ACTIVA,
] as const;
export type EstadoManual = (typeof ESTADOS_MANUALES)[number];

/**
 * Desde dónde transfirió el donante (spec 027). Mercado Pago sólo informa quién transfirió en
 * las transferencias entre cuentas de Mercado Pago: las de otro banco o billetera llegan con el
 * dueño de la cuenta del refugio como pagador, así que esas no se pueden confirmar solas.
 */
export const ORIGENES_DONACION = ['MERCADO_PAGO', 'OTRO_BANCO'] as const;
export type OrigenDonacion = (typeof ORIGENES_DONACION)[number];

/** Por qué el refugio rechaza una donación (HU-12.3). */
export const MOTIVOS_RECHAZO = ['NO_RECIBIDA', 'MONTO_NO_COINCIDE'] as const;
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

/** Desde qué estados se llega a cada estado manual. Finalizada es final. */
const ORIGENES_MANUALES: Record<EstadoManual, readonly string[]> = {
  Finalizada: [ESTADO_CAMPANIA.INACTIVA, ESTADO_CAMPANIA.ACTIVA, ESTADO_CAMPANIA.PAUSADA],
  Pausada: [ESTADO_CAMPANIA.ACTIVA],
  Activa: [ESTADO_CAMPANIA.PAUSADA],
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

/** Las que el SISTEMA cierra por fecha o por meta: una Pausada cierra igual que una Activa. */
const ESTADOS_QUE_CIERRAN: readonly string[] = [ESTADO_CAMPANIA.ACTIVA, ESTADO_CAMPANIA.PAUSADA];

/**
 * A qué estado lleva el SISTEMA a la campaña en este momento (HU-12.4), o `null` si no cambia.
 *
 * Aplica los dos pasos de una vez: una Inactiva con la fecha de fin ya vencida (por ejemplo, si
 * el cron no corrió) termina Finalizada en la misma corrida. La fecha de inicio cuenta desde el
 * comienzo de ese día y la de fin hasta su último instante. Una Pausada no se activa (ya
 * arrancó), pero sí se finaliza (spec 028 §6.1).
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
    ESTADOS_QUE_CIERRAN.includes(estado) &&
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
