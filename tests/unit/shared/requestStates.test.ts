import { describe, expect, it } from 'vitest';
import {
  ESTADO_SOLICITUD,
  ESTADOS_SOLICITUD_ABIERTA,
  ESTADOS_SOLICITUD_FINAL,
  MOTIVOS_POR_ESTADO,
  estaAbierta,
  motivoCorresponde,
} from '../../../src/shared/requestStates';

describe('estados abiertos y finales', () => {
  it('abiertas son las tres etapas por las que pasa una solicitud', () => {
    expect([...ESTADOS_SOLICITUD_ABIERTA]).toEqual(['Pendiente', 'En_Revision', 'Revisada']);
  });

  it('abiertos y finales no se solapan y juntos son todos los estados', () => {
    const todos = Object.values(ESTADO_SOLICITUD).sort();
    const unidos = [...ESTADOS_SOLICITUD_ABIERTA, ...ESTADOS_SOLICITUD_FINAL].sort();

    expect(unidos).toEqual(todos);
    expect(new Set(unidos).size).toBe(unidos.length);
  });

  it.each(['Pendiente', 'En_Revision', 'Revisada'])('%s está abierta', (nombre) => {
    expect(estaAbierta(nombre)).toBe(true);
  });

  it.each(['Aprobada', 'Rechazada', 'Cancelada', 'Cerrada', 'algo-raro', undefined])(
    '%s no está abierta',
    (nombre) => {
      expect(estaAbierta(nombre)).toBe(false);
    },
  );
});

describe('motivoCorresponde', () => {
  it('cada causa pertenece a un solo estado', () => {
    const todas = Object.values(MOTIVOS_POR_ESTADO).flat();

    expect(new Set(todas).size).toBe(todas.length);
  });

  it('acepta las causas de su estado', () => {
    expect(motivoCorresponde('Rechazada', 'NO_CUMPLE_REQUISITOS')).toBe(true);
    expect(motivoCorresponde('Cancelada', 'RETIRADA_POR_SOLICITANTE')).toBe(true);
    expect(motivoCorresponde('Cerrada', 'VENCIDA_SIN_RESPUESTA')).toBe(true);
  });

  it('rechaza la causa de otro estado', () => {
    expect(motivoCorresponde('Rechazada', 'VENCIDA_SIN_RESPUESTA')).toBe(false);
    expect(motivoCorresponde('Cerrada', 'RETIRADA_POR_SOLICITANTE')).toBe(false);
    expect(motivoCorresponde('Cancelada', 'MASCOTA_FALLECIDA')).toBe(false);
  });

  it('los estados finales con causa la exigen', () => {
    expect(motivoCorresponde('Rechazada', null)).toBe(false);
    expect(motivoCorresponde('Cancelada', null)).toBe(false);
    expect(motivoCorresponde('Cerrada', null)).toBe(false);
  });

  it('los estados sin causa solo aceptan null', () => {
    expect(motivoCorresponde('Aprobada', null)).toBe(true);
    expect(motivoCorresponde('Pendiente', null)).toBe(true);
    expect(motivoCorresponde('Revisada', null)).toBe(true);
    expect(motivoCorresponde('Aprobada', 'OTRO')).toBe(false);
    expect(motivoCorresponde('Revisada', 'OTRO')).toBe(false);
  });
});
