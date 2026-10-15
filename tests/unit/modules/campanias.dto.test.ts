import { describe, expect, it } from 'vitest';
import {
  cambiarEstadoCampaniaSchema,
  crearCampaniaSchema,
  donarSchema,
  editarCampaniaSchema,
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

describe('editarCampaniaSchema (spec 028)', () => {
  it('todo es opcional: vacío no cambia nada', () => {
    expect(editarCampaniaSchema.parse({})).toEqual({});
  });

  it('valida y normaliza lo que llega', () => {
    const resultado = editarCampaniaSchema.parse({
      titulo: '  Castraciones de otoño  ',
      objetivo: '150000',
      fechaFin: enDias(10),
    });
    expect(resultado.titulo).toBe('Castraciones de otoño');
    expect(resultado.objetivo).toBe(150000);
    expect(resultado.fechaFin).toBeInstanceOf(Date);
  });

  it('la fecha de fin tiene que ser posterior a hoy', () => {
    expect(primerError(editarCampaniaSchema.safeParse({ fechaFin: enDias(0) }))).toBe(
      'La fecha de fin debe ser posterior a hoy',
    );
    expect(editarCampaniaSchema.safeParse({ fechaFin: enDias(1) }).success).toBe(true);
  });

  it('respeta los límites de la meta del alta', () => {
    expect(editarCampaniaSchema.safeParse({ objetivo: '5000' }).success).toBe(false);
  });

  it('no deja vaciar el título', () => {
    expect(editarCampaniaSchema.safeParse({ titulo: '   ' }).success).toBe(false);
  });

  it('alias, CBU y fecha de inicio no se pueden modificar', () => {
    expect(primerError(editarCampaniaSchema.safeParse({ alias: 'otro.alias' }))).toBe(
      'El alias no se puede modificar',
    );
    expect(primerError(editarCampaniaSchema.safeParse({ cbu: '0'.repeat(22) }))).toBe(
      'El CBU/CVU no se puede modificar',
    );
    expect(primerError(editarCampaniaSchema.safeParse({ fechaInicio: enDias(3) }))).toBe(
      'La fecha de inicio no se puede modificar',
    );
  });
});

describe('cambiarEstadoCampaniaSchema', () => {
  it('acepta finalizar, pausar y reactivar', () => {
    for (const estado of ['Finalizada', 'Pausada', 'Activa']) {
      expect(cambiarEstadoCampaniaSchema.safeParse({ estado }).success).toBe(true);
    }
  });

  it('Cancelada ya no existe (spec 028)', () => {
    expect(primerError(cambiarEstadoCampaniaSchema.safeParse({ estado: 'Cancelada' }))).toBe(
      'El estado tiene que ser "Finalizada", "Pausada" o "Activa"',
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
