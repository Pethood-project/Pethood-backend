/**
 * Plan de vacunación de perros y gatos (spec 019). Lo usan la historia clínica (alta de una
 * vacuna), el alta de mascota (vacunas que ya tiene) y las fichas de mascota y publicación
 * (medallas). Es fijo: si cambia, cambia acá y en el enum `TipoVacuna` de schema.prisma.
 *
 * `descripcion` es el texto que la app precarga en el registro de historia clínica y el que
 * muestra al tocar una medalla. El color de cada medalla es del front
 * (`apps/mobile/constants/Vacunas.ts`), atado al `tipo`.
 */
import type { TipoVacuna } from '@prisma/client';
import { aFechaISO, inicioDelDia } from './validation/dates';

/** Nombre de la especie en el catálogo `Especie` (ver `prisma/seed/catalogos.ts`). */
export type EspecieVacunable = 'Perro' | 'Gato';

export interface Vacuna {
  tipo: TipoVacuna;
  especie: EspecieVacunable;
  nombre: string;
  descripcion: string;
}

/** En el orden del calendario: así se listan en el selector. */
export const VACUNAS: readonly Vacuna[] = [
  {
    tipo: 'PRIMOVACUNACION',
    especie: 'Perro',
    nombre: 'Primovacunación',
    descripcion: '6 a 8 semanas: Primovacunación con Puppy / Polivalente (Parvovirus y Moquillo).',
  },
  {
    tipo: 'MULTIPLE',
    especie: 'Perro',
    nombre: 'Vacuna Múltiple',
    descripcion:
      '9 a 12 semanas: Vacuna Múltiple o Séxtuple (Parvovirus, Moquillo, Hepatitis, ' +
      'Parainfluenza y Leptospirosis).',
  },
  {
    tipo: 'REFUERZO_MULTIPLE',
    especie: 'Perro',
    nombre: 'Refuerzo Múltiple',
    descripcion: '14 a 16 semanas: Refuerzo de la vacuna Múltiple/Óctuple.',
  },
  {
    tipo: 'ANTIRRABICA',
    especie: 'Perro',
    nombre: 'Antirrábica',
    descripcion: 'A partir de los 3 a 4 meses: Vacuna Antirrábica (obligatoria por ley).',
  },
  {
    tipo: 'TRIVALENTE_FELINA',
    especie: 'Gato',
    nombre: 'Trivalente Felina',
    descripcion:
      '8 semanas: Vacuna Trivalente Felina (Panleucopenia, Calicivirus y Rinotraqueítis).',
  },
  {
    tipo: 'REFUERZO_TRIVALENTE_LEUCEMIA',
    especie: 'Gato',
    nombre: 'Refuerzo Trivalente + Leucemia',
    descripcion:
      '12 semanas: Refuerzo de la Trivalente Felina + Leucemia Felina (FeLV) (recomendada ' +
      'si el gato tiene acceso al exterior o convivencia con otros gatos).',
  },
  {
    tipo: 'REFUERZO_LEUCEMIA',
    especie: 'Gato',
    nombre: 'Refuerzo Leucemia Felina',
    descripcion: '16 semanas: Segundo refuerzo de Leucemia Felina (si aplica).',
  },
  {
    tipo: 'ANTIRRABICA',
    especie: 'Gato',
    nombre: 'Antirrábica',
    descripcion: 'A partir de los 3 a 4 meses: Vacuna Antirrábica.',
  },
];

/** Todos los tipos, sin repetir, para validar la entrada antes de conocer la especie. */
export const TIPOS_VACUNA = [...new Set(VACUNAS.map((vacuna) => vacuna.tipo))] as [
  TipoVacuna,
  ...TipoVacuna[],
];

function mismaEspecie(especie: EspecieVacunable, nombreEspecie: string): boolean {
  return especie.toLowerCase() === nombreEspecie.trim().toLowerCase();
}

/** Vacunas que admite una especie. Vacío si la especie no tiene plan (ej. un conejo). */
export function vacunasDeEspecie(nombreEspecie: string): Vacuna[] {
  return VACUNAS.filter((vacuna) => mismaEspecie(vacuna.especie, nombreEspecie));
}

/** La vacuna de ese tipo para esa especie, o null si la especie no la admite. */
export function buscarVacuna(tipo: TipoVacuna, nombreEspecie: string): Vacuna | null {
  return (
    VACUNAS.find((vacuna) => vacuna.tipo === tipo && mismaEspecie(vacuna.especie, nombreEspecie)) ??
    null
  );
}

export type ResultadoVacuna = { valida: true; vacuna: Vacuna } | { valida: false; error: string };

/**
 * Regla de negocio de una vacuna aplicada, igual al cargarla con la mascota que desde la
 * historia clínica: tiene que ser del plan de la especie y no puede ser anterior al
 * nacimiento (sin fecha de nacimiento, eso último no se puede chequear).
 */
export function validarVacunaDeMascota(
  tipo: TipoVacuna,
  fecha: Date,
  mascota: { especie: string; fechaNacimiento: Date | null },
): ResultadoVacuna {
  const vacuna = buscarVacuna(tipo, mascota.especie);

  if (!vacuna) {
    return { valida: false, error: 'Esa vacuna no corresponde a la especie de la mascota' };
  }

  if (mascota.fechaNacimiento && inicioDelDia(fecha) < inicioDelDia(mascota.fechaNacimiento)) {
    return {
      valida: false,
      error: `La fecha de la vacuna ${vacuna.nombre} no puede ser anterior al nacimiento`,
    };
  }

  return { valida: true, vacuna };
}

/** Vacuna de la mascota, tal como la pinta una medalla. */
export interface VacunaAplicadaDto {
  tipo: TipoVacuna;
  nombre: string;
  descripcion: string;
  /** `AAAA-MM-DD` de la aplicación más reciente de ese tipo. */
  fechaAplicacion: string;
}

/**
 * Medallas de una mascota a partir de sus registros de vacuna vigentes: una por tipo (un
 * refuerzo repetido no duplica la medalla) con la fecha más reciente, en el orden del
 * calendario. Un tipo que la especie no admite se descarta — solo puede pasar si la
 * mascota cambió de especie después de cargarlo.
 */
export function vacunasAplicadas(
  registros: { tipoVacuna: TipoVacuna | null; fechaVisita: Date }[],
  nombreEspecie: string,
): VacunaAplicadaDto[] {
  const ultimaPorTipo = new Map<TipoVacuna, Date>();

  for (const { tipoVacuna, fechaVisita } of registros) {
    if (!tipoVacuna) continue;
    const anterior = ultimaPorTipo.get(tipoVacuna);
    if (!anterior || fechaVisita > anterior) ultimaPorTipo.set(tipoVacuna, fechaVisita);
  }

  return vacunasDeEspecie(nombreEspecie)
    .filter((vacuna) => ultimaPorTipo.has(vacuna.tipo))
    .map((vacuna) => ({
      tipo: vacuna.tipo,
      nombre: vacuna.nombre,
      descripcion: vacuna.descripcion,
      fechaAplicacion: aFechaISO(ultimaPorTipo.get(vacuna.tipo)!),
    }));
}
