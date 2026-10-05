import { describe, expect, it } from 'vitest';
import {
  crearReporteSchema,
  filtrosReportesSchema,
  resolverReporteSchema,
} from '../../../../src/modules/reportes/reportes.dto';

describe('crearReporteSchema', () => {
  const valido = { tipo: 'PUBLICACION', objetoId: 12, motivo: 'La foto no corresponde.' };

  it('acepta un reporte válido', () => {
    expect(crearReporteSchema.parse(valido)).toEqual(valido);
  });

  it('acepta el id como texto', () => {
    expect(crearReporteSchema.parse({ ...valido, objetoId: '12' }).objetoId).toBe(12);
  });

  it('rechaza un tipo que no existe', () => {
    expect(crearReporteSchema.safeParse({ ...valido, tipo: 'MASCOTA' }).success).toBe(false);
  });

  it('rechaza un motivo corto o pasado de largo', () => {
    expect(crearReporteSchema.safeParse({ ...valido, motivo: 'mal' }).success).toBe(false);
    expect(crearReporteSchema.safeParse({ ...valido, motivo: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('rechaza un objetoId vacío o inválido', () => {
    expect(crearReporteSchema.safeParse({ ...valido, objetoId: undefined }).success).toBe(false);
    expect(crearReporteSchema.safeParse({ ...valido, objetoId: 'abc' }).success).toBe(false);
  });
});

describe('resolverReporteSchema', () => {
  it('exige una respuesta', () => {
    expect(resolverReporteSchema.safeParse({ respuesta: '   ' }).success).toBe(false);
    expect(resolverReporteSchema.safeParse({ respuesta: 'Resuelto.' }).success).toBe(true);
  });
});

describe('filtrosReportesSchema', () => {
  it('por defecto lista los pendientes, página 1', () => {
    expect(filtrosReportesSchema.parse({})).toMatchObject({ estado: 'pendiente', page: 1 });
  });

  it('rechaza un estado desconocido', () => {
    expect(filtrosReportesSchema.safeParse({ estado: 'abierto' }).success).toBe(false);
  });
});
