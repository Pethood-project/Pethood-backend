/**
 * Emparejamiento de donaciones Pendientes con transferencias de Mercado Pago (spec 027 §6.1).
 * Función pura: el servicio le pasa las donaciones de un mismo donante y monto, y los pagos que
 * devolvió Mercado Pago para ese monto.
 */
import type { PagoMp } from '../mercadopago/mercadopago.cliente';
import { dniDesdeIdentificacion, normalizarDni } from '../../shared/validation/documento';

const HORA_MS = 60 * 60 * 1000;
/** El adoptante transfiere antes de tocar «Terminar donación». */
export const VENTANA_ANTES_MS = 24 * HORA_MS;
/** Las transferencias bancarias a veces tardan en acreditarse. */
export const VENTANA_DESPUES_MS = 72 * HORA_MS;

export interface DonacionAConciliar {
  id: number;
  monto: number;
  fechaAlta: Date;
  dni: string;
}

const centavos = (monto: number): number => Math.round(monto * 100);

function dentroDeLaVentana(donacion: DonacionAConciliar, pago: PagoMp): boolean {
  const desde = donacion.fechaAlta.getTime() - VENTANA_ANTES_MS;
  const hasta = donacion.fechaAlta.getTime() + VENTANA_DESPUES_MS;
  return pago.fecha.getTime() >= desde && pago.fecha.getTime() <= hasta;
}

/**
 * Cada donación, de la más vieja a la más nueva, se queda con el primer pago que cumple todo y
 * todavía nadie tomó. Un pago nunca confirma dos donaciones.
 */
export function emparejar(
  donaciones: DonacionAConciliar[],
  pagos: PagoMp[],
  usados: Set<string>,
): { donacionId: number; pagoId: string }[] {
  const tomados = new Set(usados);
  const pares: { donacionId: number; pagoId: string }[] = [];

  const porFecha = [...donaciones].sort(
    (a, b) => a.fechaAlta.getTime() - b.fechaAlta.getTime() || a.id - b.id,
  );
  const pagosPorFecha = [...pagos].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  for (const donacion of porFecha) {
    const dni = normalizarDni(donacion.dni);
    const pago = pagosPorFecha.find(
      (candidato) =>
        !tomados.has(candidato.id) &&
        candidato.estado === 'approved' &&
        centavos(candidato.monto) === centavos(donacion.monto) &&
        dniDesdeIdentificacion(candidato.tipoDoc, candidato.numeroDoc) === dni &&
        dentroDeLaVentana(donacion, candidato),
    );
    if (!pago) continue;

    tomados.add(pago.id);
    pares.push({ donacionId: donacion.id, pagoId: pago.id });
  }

  return pares;
}
