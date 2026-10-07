import { describe, expect, it } from 'vitest';
import {
  crearCampaniaSchema,
  donarSchema,
  resolverDonacionSchema,
} from '../../../src/modules/campanias/campanias.dto';

/** `AAAA-MM-DD` en hora LOCAL: con `toISOString` (UTC), de noche en Argentina sería mañana. */
function enDias(n: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + n);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

const VALIDA = {
  titulo: 'Castraciones de primavera',
  descripcion: 'Queremos castrar 80 animales del barrio.',
  objetivo: '250000',
  fechaInicio: enDias(1),
  fechaFin: enDias(60),
  alias: 'patitas.castra.mp',
  cbu: '',
};

function primerError(resultado: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | undefined {
  return resultado.success ? undefined : resultado.error!.issues[0]!.message;
}

describe('crearCampaniaSchema', () => {
  it('acepta una campaña válida y normaliza alias/CBU', () => {
    const resultado = crearCampaniaSchema.parse(VALIDA);
    expect(resultado.objetivo).toBe(250000);
    expect(resultado.alias).toBe('patitas.castra.mp');
    expect(resultado.cbu).toBeNull();
  });

  it('exige alias o CBU', () => {
    expect(primerError(crearCampaniaSchema.safeParse({ ...VALIDA, alias: '', cbu: '' }))).toBe(
      'Cargá el alias o el CBU/CVU para que puedan donarte',
    );
  });

  it('exige fin posterior al inicio', () => {
    expect(
      primerError(crearCampaniaSchema.safeParse({ ...VALIDA, fechaFin: VALIDA.fechaInicio })),
    ).toBe('La fecha de fin tiene que ser posterior a la de inicio');
  });

  it('rechaza inicio en el pasado', () => {
    expect(primerError(crearCampaniaSchema.safeParse({ ...VALIDA, fechaInicio: enDias(-1) }))).toBe(
      'La fecha de inicio no puede ser anterior a hoy',
    );
  });

  it('rechaza objetivo fuera de rango y descripción larga', () => {
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, objetivo: '9999' }).success).toBe(false);
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, objetivo: '2500001' }).success).toBe(false);
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, descripcion: 'a'.repeat(301) }).success).toBe(
      false,
    );
  });
});

describe('donarSchema', () => {
  const MP = { origen: 'MERCADO_PAGO' };

  it('acepta coma o punto decimal', () => {
    expect(donarSchema.parse({ ...MP, monto: '5000,50' }).monto).toBe(5000.5);
    expect(donarSchema.parse({ ...MP, monto: '5000.50' }).monto).toBe(5000.5);
  });

  it('rechaza 0 y más de dos decimales', () => {
    expect(donarSchema.safeParse({ ...MP, monto: '0' }).success).toBe(false);
    expect(donarSchema.safeParse({ ...MP, monto: '10,555' }).success).toBe(false);
  });

  it('exige desde dónde se transfiere: Mercado Pago u otro banco (spec 027)', () => {
    expect(donarSchema.parse({ monto: '5000', origen: 'OTRO_BANCO' }).origen).toBe('OTRO_BANCO');
    expect(primerError(donarSchema.safeParse({ monto: '5000' }))).toBe(
      'Elegí desde dónde vas a transferir',
    );
    expect(donarSchema.safeParse({ monto: '5000', origen: 'EFECTIVO' }).success).toBe(false);
  });
});

describe('resolverDonacionSchema', () => {
  it('aplicar no pide motivo', () => {
    expect(resolverDonacionSchema.parse({ estado: 'Realizada' })).toEqual({ estado: 'Realizada' });
  });

  it('rechazar exige un motivo válido', () => {
    expect(primerError(resolverDonacionSchema.safeParse({ estado: 'Cancelada' }))).toBe(
      'Elegí por qué rechazás la donación',
    );
    expect(resolverDonacionSchema.parse({ estado: 'Cancelada', motivo: 'NO_RECIBIDA' })).toEqual({
      estado: 'Cancelada',
      motivo: 'NO_RECIBIDA',
    });
  });

  it('rechaza otro estado', () => {
    expect(resolverDonacionSchema.safeParse({ estado: 'Pendiente' }).success).toBe(false);
  });
});
