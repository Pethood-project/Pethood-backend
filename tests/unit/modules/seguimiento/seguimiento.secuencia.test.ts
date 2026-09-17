import { describe, expect, it } from 'vitest';
import {
  correspondeBorrarSeguimientos,
  DIAS_TRANSITO_POR_DEFECTO,
  elegirPregunta,
  pedidosExigiblesA,
  plazoDeRespuesta,
  programaDeSeguimiento,
  proximoAviso,
  sumarDias,
} from '../../../../src/modules/seguimiento/seguimiento.secuencia';

const APROBACION = new Date('2026-01-01T12:00:00.000Z');

/** Offsets en días desde la aprobación, que es como está escrita la HU. */
function offsets(fechas: { fecha: Date }[]): number[] {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  return fechas.map(({ fecha }) => (fecha.getTime() - APROBACION.getTime()) / MS_POR_DIA);
}

describe('programaDeSeguimiento — adopción', () => {
  it('acumula la secuencia [2,5,5,5,7,7,14,14,30,30,60,90,180,365,365] de HU-9.2', () => {
    const programa = programaDeSeguimiento(APROBACION, 'Adopcion');

    expect(offsets(programa)).toEqual([
      2, 7, 12, 17, 24, 31, 45, 59, 89, 119, 179, 269, 449, 814, 1179,
    ]);
  });

  it('son 15 pedidos y después la secuencia se agota', () => {
    const programa = programaDeSeguimiento(APROBACION, 'Adopcion');

    expect(programa).toHaveLength(15);
    expect(programa.map((pedido) => pedido.numero)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });
});

describe('programaDeSeguimiento — tránsito', () => {
  it('arranca con [2,2,3,4,5,5] y sigue cada 5 días', () => {
    const programa = programaDeSeguimiento(APROBACION, 'Transito');

    expect(offsets(programa).slice(0, 9)).toEqual([2, 4, 7, 11, 16, 21, 26, 31, 36]);
  });

  it('no programa pedidos más allá del fin del período de tránsito', () => {
    const programa = programaDeSeguimiento(APROBACION, 'Transito', 10);

    expect(offsets(programa)).toEqual([2, 4, 7]);
  });

  it('con la duración por defecto el último pedido entra dentro del período', () => {
    const programa = programaDeSeguimiento(APROBACION, 'Transito');
    const ultimo = offsets(programa).at(-1)!;

    expect(ultimo).toBeLessThanOrEqual(DIAS_TRANSITO_POR_DEFECTO);
    expect(ultimo + 5).toBeGreaterThan(DIAS_TRANSITO_POR_DEFECTO);
  });
});

describe('pedidosExigiblesA', () => {
  it('el día de la aprobación todavía no hay ningún pedido', () => {
    expect(pedidosExigiblesA(APROBACION, 'Adopcion', APROBACION)).toEqual([]);
  });

  it('a los 2 días llega el primero (borde exacto incluido)', () => {
    const exigibles = pedidosExigiblesA(APROBACION, 'Adopcion', sumarDias(APROBACION, 2));

    expect(exigibles).toHaveLength(1);
  });

  it('a los 8 días ya son dos: la fecha del tercero (día 12) todavía no llegó', () => {
    const exigibles = pedidosExigiblesA(APROBACION, 'Adopcion', sumarDias(APROBACION, 8));

    expect(offsets(exigibles)).toEqual([2, 7]);
  });

  it('una solicitud vieja materializa toda la secuencia de una', () => {
    const exigibles = pedidosExigiblesA(APROBACION, 'Adopcion', sumarDias(APROBACION, 2000));

    expect(exigibles).toHaveLength(15);
  });
});

describe('proximoAviso', () => {
  it('recién aprobada apunta al primer pedido, a los 2 días', () => {
    expect(proximoAviso(APROBACION, 'Adopcion', APROBACION)).toEqual(sumarDias(APROBACION, 2));
  });

  it('es null cuando la secuencia se agotó (GUI-21 lo muestra como finalizado)', () => {
    expect(proximoAviso(APROBACION, 'Adopcion', sumarDias(APROBACION, 2000))).toBeNull();
  });
});

describe('plazoDeRespuesta', () => {
  it('son 48 horas desde que llega el pedido (HU-9.1)', () => {
    const pedido = new Date('2026-03-10T08:00:00.000Z');

    expect(plazoDeRespuesta(pedido)).toEqual(new Date('2026-03-12T08:00:00.000Z'));
  });
});

describe('correspondeBorrarSeguimientos', () => {
  it('una adopción no se borra nunca: no tiene fin de período', () => {
    const dentroDe10Anios = sumarDias(APROBACION, 3650);

    expect(correspondeBorrarSeguimientos(APROBACION, 'Adopcion', dentroDe10Anios)).toBe(false);
  });

  it('un tránsito no se borra mientras no hayan pasado 5 días del fin', () => {
    const cuatroDiasDespues = sumarDias(APROBACION, 10 + 4);

    expect(correspondeBorrarSeguimientos(APROBACION, 'Transito', cuatroDiasDespues, 10)).toBe(
      false,
    );
  });

  it('un tránsito se borra pasados los 5 días del fin (HU-9.1)', () => {
    const seisDiasDespues = sumarDias(APROBACION, 10 + 6);

    expect(correspondeBorrarSeguimientos(APROBACION, 'Transito', seisDiasDespues, 10)).toBe(true);
  });
});

describe('elegirPregunta', () => {
  const PREGUNTAS = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('devuelve null si el catálogo está vacío', () => {
    expect(elegirPregunta([], [])).toBeNull();
  });

  it('no repite mientras queden preguntas sin usar', () => {
    // aleatorio() = 0 elige siempre la primera candidata: con 1 y 2 usadas, queda la 3.
    expect(elegirPregunta(PREGUNTAS, [1, 2], () => 0)).toEqual({ id: 3 });
  });

  it('agotado el catálogo vuelve a sortear sobre todas', () => {
    expect(elegirPregunta(PREGUNTAS, [1, 2, 3], () => 0)).toEqual({ id: 1 });
  });

  it('acota el índice aunque el aleatorio devuelva 1', () => {
    expect(elegirPregunta(PREGUNTAS, [], () => 1)).toEqual({ id: 3 });
  });
});
