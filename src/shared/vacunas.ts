/**
 * Reglas de las vacunas de una mascota (spec 019). Desde la spec 029 el plan de vacunación es
 * el catálogo `Vacuna` (+ `VacunaEspecie`): cada módulo lo lee con su repository y acá solo
 * queda la lógica pura, igual para el alta de mascota que para la historia clínica.
 *
 * `codigo` es el identificador estable que la API expone como `tipo` y al que la app ata el
 * color de la medalla (`apps/mobile/constants/Vacunas.ts`).
 */
import { aFechaISO, inicioDelDia } from './validation/dates';

export interface Vacuna {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
}

/** Campos de `Vacuna` que piden las reglas de abajo, para el `select` de los repositories. */
export const SELECT_VACUNA = { id: true, codigo: true, nombre: true, descripcion: true } as const;

export type ResultadoVacuna = { valida: true; vacuna: Vacuna } | { valida: false; error: string };

/**
 * Regla de negocio de una vacuna aplicada: tiene que ser del plan de la especie y no puede
 * ser anterior al nacimiento (sin fecha de nacimiento, eso último no se puede chequear).
 *
 * `vacuna` es la del catálogo con ese código, activa y asociada a la especie de la mascota,
 * o `null` si no hay ninguna (código inexistente, de baja o de otra especie).
 */
export function validarVacunaDeMascota(
  vacuna: Vacuna | null,
  fecha: Date,
  fechaNacimiento: Date | null,
): ResultadoVacuna {
  if (!vacuna) {
    return { valida: false, error: 'Esa vacuna no corresponde a la especie de la mascota' };
  }

  if (fechaNacimiento && inicioDelDia(fecha) < inicioDelDia(fechaNacimiento)) {
    return {
      valida: false,
      error: `La fecha de la vacuna ${vacuna.nombre} no puede ser anterior al nacimiento`,
    };
  }

  return { valida: true, vacuna };
}

/**
 * Código estable de una vacuna nueva a partir de su nombre (spec 029 §6): mayúsculas, sin
 * tildes y con `_` en lugar de lo que no sea letra o número («Refuerzo + Leucemia» →
 * `REFUERZO_LEUCEMIA`). Si ya existe, suma un sufijo numérico (`_2`, `_3`...). `existentes`
 * son los códigos tomados, incluidos los de vacunas de baja.
 */
export function aCodigoVacuna(nombre: string, existentes: readonly string[]): string {
  const base =
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'VACUNA';

  if (!existentes.includes(base)) return base;

  let sufijo = 2;
  while (existentes.includes(`${base}_${sufijo}`)) sufijo++;
  return `${base}_${sufijo}`;
}

/** Vacuna de la mascota, tal como la pinta una medalla. */
export interface VacunaAplicadaDto {
  /** El `codigo` de la vacuna. */
  tipo: string;
  nombre: string;
  descripcion: string;
  /** `AAAA-MM-DD` de la aplicación más reciente de esa vacuna. */
  fechaAplicacion: string;
}

/**
 * Medallas de una mascota a partir de sus registros de vacuna vigentes: una por vacuna (un
 * refuerzo repetido no duplica la medalla) con la fecha más reciente, en el orden del
 * catálogo (creación). Una vacuna de baja o que ya no es de la especie se sigue mostrando:
 * fue aplicada (spec 029 §6).
 */
export function vacunasAplicadas(
  registros: { vacuna: Vacuna | null; fechaVisita: Date }[],
): VacunaAplicadaDto[] {
  const ultimaPorVacuna = new Map<number, { vacuna: Vacuna; fecha: Date }>();

  for (const { vacuna, fechaVisita } of registros) {
    if (!vacuna) continue;
    const anterior = ultimaPorVacuna.get(vacuna.id);
    if (!anterior || fechaVisita > anterior.fecha) {
      ultimaPorVacuna.set(vacuna.id, { vacuna, fecha: fechaVisita });
    }
  }

  return [...ultimaPorVacuna.values()]
    .sort((a, b) => a.vacuna.id - b.vacuna.id)
    .map(({ vacuna, fecha }) => ({
      tipo: vacuna.codigo,
      nombre: vacuna.nombre,
      descripcion: vacuna.descripcion,
      fechaAplicacion: aFechaISO(fecha),
    }));
}
