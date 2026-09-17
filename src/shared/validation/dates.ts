/** Utilidades de fecha reutilizables. Funciones puras, sin dependencias. */
import { LIMITES } from './limits';

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const SOLO_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Parsea texto ISO o Date. Devuelve null si no es una fecha real.
 *
 * Un `AAAA-MM-DD` se arma como medianoche LOCAL: `new Date('2022-03-15')` lo interpreta
 * como UTC y en timezones negativas termina siendo el día anterior en hora local.
 */
export function parsearFecha(valor: string | Date | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;

  const partes = SOLO_FECHA.exec(valor);
  const fecha = partes
    ? new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]))
    : new Date(valor);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function finDelDia(fecha: Date): Date {
  const copia = new Date(fecha);
  copia.setHours(23, 59, 59, 999);
  return copia;
}

export function inicioDelDia(fecha: Date): Date {
  const copia = new Date(fecha);
  copia.setHours(0, 0, 0, 0);
  return copia;
}

/** Compara contra el fin del día de hoy, así una fecha de hoy nunca cuenta como futura. */
export function esFutura(fecha: Date, hoy: Date = new Date()): boolean {
  return fecha.getTime() > finDelDia(hoy).getTime();
}

export function esPasada(fecha: Date, hoy: Date = new Date()): boolean {
  return fecha.getTime() < inicioDelDia(hoy).getTime();
}

export function esAnteriorAlAnioMinimo(
  fecha: Date,
  anioMinimo: number = LIMITES.fecha.anioMinimo,
): boolean {
  return fecha.getFullYear() < anioMinimo;
}

/**
 * Fecha de nacimiento que corresponde a alguien que hoy cumple exactamente `anios`.
 * Sirve para traducir un filtro de edad a un rango de `fechaNacimiento`.
 */
export function restarAnios(anios: number, hoy: Date = new Date()): Date {
  const copia = new Date(hoy);
  copia.setFullYear(copia.getFullYear() - anios);
  return copia;
}

/** Formatea a `AAAA-MM-DD` en hora local — `toISOString` corre el día según timezone. */
export function aFechaISO(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Parsea un mes calendario "AAAA-MM" (formato de <input type="month">). Null si es inválido. */
export function parsearMesISO(
  valor: string | null | undefined,
): { anio: number; mes: number } | null {
  if (!valor) return null;
  const partes = SOLO_MES.exec(valor);
  if (!partes) return null;
  return { anio: Number(partes[1]), mes: Number(partes[2]) };
}

/** Primer instante local del mes "AAAA-MM". */
export function inicioDeMes(anio: number, mes: number): Date {
  return new Date(anio, mes - 1, 1, 0, 0, 0, 0);
}

/** Último instante local del mes "AAAA-MM". */
export function finDeMes(anio: number, mes: number): Date {
  return new Date(anio, mes, 0, 23, 59, 59, 999);
}

export type ResultadoFecha = { valida: true; fecha: Date } | { valida: false; error: string };

/** Fecha de algo que ya pasó (nacimiento, visita médica): existente, no futura y ≥1900. */
export function validarFechaPasada(
  valor: string | Date | null | undefined,
  etiqueta: string,
): ResultadoFecha {
  const fecha = parsearFecha(valor);

  if (!fecha) return { valida: false, error: `${etiqueta} no es válida` };
  if (esFutura(fecha)) return { valida: false, error: `${etiqueta} no puede ser futura` };
  if (esAnteriorAlAnioMinimo(fecha)) {
    return {
      valida: false,
      error: `${etiqueta} no puede ser anterior a ${LIMITES.fecha.anioMinimo}`,
    };
  }

  return { valida: true, fecha };
}

/** Fecha de algo que todavía no pasó (próximo control): existente y estrictamente futura. */
export function validarFechaFutura(
  valor: string | Date | null | undefined,
  etiqueta: string,
): ResultadoFecha {
  const fecha = parsearFecha(valor);

  if (!fecha) return { valida: false, error: `${etiqueta} no es válida` };
  if (!esFutura(fecha)) return { valida: false, error: `${etiqueta} debe ser posterior a hoy` };

  return { valida: true, fecha };
}
