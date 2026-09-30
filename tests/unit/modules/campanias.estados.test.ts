import { describe, expect, it } from 'vitest';
import {
  calcularPorcentaje,
  siguienteEstadoAutomatico,
  transicionManualPermitida,
  type CampaniaParaEvaluar,
} from '../../../src/modules/campanias/campanias.estados';

const AHORA = new Date(2026, 8, 30, 12, 0, 0);

function dia(offset: number): Date {
  return new Date(2026, 8, 30 + offset);
}

function campania(opciones: Partial<CampaniaParaEvaluar>): CampaniaParaEvaluar {
  return {
    estado: 'Activa',
    fechaInicio: dia(-10),
    fechaFin: dia(10),
    objetivo: 100000,
    recaudado: 0,
    ...opciones,
  };
}

describe('siguienteEstadoAutomatico', () => {
  it('activa una Inactiva cuya fecha de inicio es hoy', () => {
    expect(
      siguienteEstadoAutomatico(campania({ estado: 'Inactiva', fechaInicio: dia(0) }), AHORA),
    ).toBe('Activa');
  });

  it('deja Inactiva una que empieza mañana', () => {
    expect(
      siguienteEstadoAutomatico(campania({ estado: 'Inactiva', fechaInicio: dia(1) }), AHORA),
    ).toBeNull();
  });

  it('una Activa que termina hoy sigue Activa hasta el fin del día', () => {
    expect(siguienteEstadoAutomatico(campania({ fechaFin: dia(0) }), AHORA)).toBeNull();
  });

  it('finaliza una Activa cuya fecha de fin ya pasó', () => {
    expect(siguienteEstadoAutomatico(campania({ fechaFin: dia(-1) }), AHORA)).toBe('Finalizada');
  });

  it('finaliza una Activa que alcanzó el objetivo', () => {
    expect(siguienteEstadoAutomatico(campania({ recaudado: 100000 }), AHORA)).toBe('Finalizada');
  });

  it('una Inactiva con el fin vencido termina Finalizada en una sola corrida', () => {
    expect(
      siguienteEstadoAutomatico(
        campania({ estado: 'Inactiva', fechaInicio: dia(-5), fechaFin: dia(-1) }),
        AHORA,
      ),
    ).toBe('Finalizada');
  });

  it('no toca estados finales', () => {
    expect(
      siguienteEstadoAutomatico(campania({ estado: 'Finalizada', fechaFin: dia(-1) }), AHORA),
    ).toBeNull();
    expect(
      siguienteEstadoAutomatico(campania({ estado: 'Cancelada', recaudado: 999999 }), AHORA),
    ).toBeNull();
  });
});

describe('transicionManualPermitida', () => {
  it('finalizar sólo desde Activa', () => {
    expect(transicionManualPermitida('Activa', 'Finalizada')).toBe(true);
    expect(transicionManualPermitida('Inactiva', 'Finalizada')).toBe(false);
    expect(transicionManualPermitida('Cancelada', 'Finalizada')).toBe(false);
  });

  it('cancelar desde Inactiva o Activa', () => {
    expect(transicionManualPermitida('Inactiva', 'Cancelada')).toBe(true);
    expect(transicionManualPermitida('Activa', 'Cancelada')).toBe(true);
    expect(transicionManualPermitida('Finalizada', 'Cancelada')).toBe(false);
  });
});

describe('calcularPorcentaje', () => {
  it('redondea hacia abajo', () => {
    expect(calcularPorcentaje(1430000, 2500000)).toBe(57);
  });

  it('se topea en 100 aunque el recaudado supere el objetivo', () => {
    expect(calcularPorcentaje(150000, 100000)).toBe(100);
  });

  it('0 con objetivo 0, para no dividir por cero', () => {
    expect(calcularPorcentaje(10, 0)).toBe(0);
  });
});
