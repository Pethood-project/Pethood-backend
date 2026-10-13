import { describe, expect, it } from 'vitest';
import { emparejar } from '../../../src/modules/campanias/campanias.conciliacion';

const H = 60 * 60 * 1000;
const T0 = new Date('2026-09-30T15:00:00Z');
const en = (horas: number) => new Date(T0.getTime() + horas * H);

const donacion = (id: number, horas = 0, monto = 5000, dni = '30123456') => ({
  id,
  monto,
  fechaAlta: en(horas),
  dni,
});
const pago = (
  id: string,
  horas = -0.1,
  monto = 5000,
  numeroDoc = '20301234569',
  estado = 'approved',
) => ({
  id,
  monto,
  fecha: en(horas),
  estado,
  tipoDoc: 'CUIL',
  numeroDoc,
});

describe('emparejar', () => {
  it('monto + DNI + ventana: la transferencia hecha un rato antes de «Terminar donación»', () => {
    expect(emparejar([donacion(1)], [pago('p1')], new Set())).toEqual([
      { donacionId: 1, pagoId: 'p1' },
    ]);
  });

  it('no empareja otro DNI, otro monto, un pago no aprobado ni uno ya usado', () => {
    expect(emparejar([donacion(1)], [pago('p1', -1, 5000, '20999999999')], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', -1, 5000.01)], new Set())).toEqual([]);
    expect(
      emparejar([donacion(1)], [pago('p1', -1, 5000, '20301234569', 'pending')], new Set()),
    ).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1')], new Set(['p1']))).toEqual([]);
  });

  it('respeta la ventana: hasta 24 h antes y 72 h después', () => {
    expect(emparejar([donacion(1)], [pago('p1', -25)], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', 73)], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', 71)], new Set())).toHaveLength(1);
  });

  it('dos donaciones iguales: la más vieja se lleva el primer pago y un pago no se usa dos veces', () => {
    expect(emparejar([donacion(2, 1), donacion(1, 0)], [pago('p1', 0.5)], new Set())).toEqual([
      { donacionId: 1, pagoId: 'p1' },
    ]);
    expect(
      emparejar([donacion(1, 0), donacion(2, 1)], [pago('p1', 0.5), pago('p2', 1.5)], new Set()),
    ).toEqual([
      { donacionId: 1, pagoId: 'p1' },
      { donacionId: 2, pagoId: 'p2' },
    ]);
  });

  it('DNI de 7 dígitos guardado sin cero contra CUIL con cero', () => {
    expect(
      emparejar(
        [donacion(1, 0, 5000, '7123456')],
        [pago('p1', -1, 5000, '20071234563')],
        new Set(),
      ),
    ).toHaveLength(1);
  });
});
