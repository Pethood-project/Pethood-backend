import { describe, expect, it } from 'vitest';
import {
  crearHistoriaClinicaSchema,
  editarHistoriaClinicaSchema,
} from '../../../src/modules/historia-clinica/historia-clinica.dto';
import { aFechaISO } from '../../../src/shared/validation/dates';

/**
 * `aFechaISO` y no `toISOString().slice(0, 10)`: ese último lee los componentes en UTC, que
 * en un huso horario negativo (Argentina, UTC-3) puede quedar un día adelantado respecto
 * del calendario local cerca de la medianoche — el mismo criterio que usa el schema para
 * interpretar la fecha que arma este helper.
 */
function mañana(): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 1);
  return aFechaISO(fecha);
}

function ayer(): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - 1);
  return aFechaISO(fecha);
}

function hoy(): string {
  return aFechaISO(new Date());
}

const DATOS_BASE = {
  fechaVisita: ayer(),
  titulo: 'Control anual',
  descripcion: 'Chequeo general, todo bien',
};

describe('crearHistoriaClinicaSchema — obligatorios', () => {
  it('acepta solo los campos obligatorios', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse(DATOS_BASE);
    expect(resultado.success).toBe(true);
  });

  it('rechaza sin título', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, titulo: '' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza sin descripción', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, descripcion: '' });
    expect(resultado.success).toBe(false);
  });

  it('rechaza una fecha de visita futura', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({
      ...DATOS_BASE,
      fechaVisita: mañana(),
    });
    expect(resultado.success).toBe(false);
  });

  it('acepta la fecha de visita de hoy', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, fechaVisita: hoy() });
    expect(resultado.success).toBe(true);
  });
});

describe('crearHistoriaClinicaSchema — fecha próxima', () => {
  it('es opcional', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse(DATOS_BASE);
    expect(resultado.success && resultado.data.fechaProxima).toBeNull();
  });

  it('rechaza una fecha próxima igual a hoy', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, fechaProxima: hoy() });
    expect(resultado.success).toBe(false);
  });

  it('rechaza una fecha próxima pasada', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, fechaProxima: ayer() });
    expect(resultado.success).toBe(false);
  });

  it('acepta una fecha próxima futura', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({
      ...DATOS_BASE,
      fechaProxima: mañana(),
    });
    expect(resultado.success).toBe(true);
  });
});

describe('crearHistoriaClinicaSchema — booleanos desde multipart', () => {
  it('vacunacion ausente colapsa a false', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse(DATOS_BASE);
    expect(resultado.success && resultado.data.vacunacion).toBe(false);
  });

  it('vacunacion como texto "true" se lee como true', () => {
    const resultado = crearHistoriaClinicaSchema.safeParse({ ...DATOS_BASE, vacunacion: 'true' });
    expect(resultado.success && resultado.data.vacunacion).toBe(true);
  });
});

describe('editarHistoriaClinicaSchema — todo opcional', () => {
  it('acepta un objeto vacío (PATCH que solo trae el documento)', () => {
    const resultado = editarHistoriaClinicaSchema.safeParse({});
    expect(resultado.success).toBe(true);
  });

  it('un campo ausente queda undefined, para que el service lo complete con el valor vigente', () => {
    const resultado = editarHistoriaClinicaSchema.safeParse({ titulo: 'Nuevo título' });
    expect(resultado.success && resultado.data.fechaVisita).toBeUndefined();
    expect(resultado.success && resultado.data.descripcion).toBeUndefined();
  });

  it('rechaza un título que supera el límite de caracteres', () => {
    const resultado = editarHistoriaClinicaSchema.safeParse({ titulo: 'a'.repeat(101) });
    expect(resultado.success).toBe(false);
  });
});
