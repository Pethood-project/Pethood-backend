import { describe, expect, it } from 'vitest';
import {
  diasDesde,
  esPublicacionAntigua,
  esSolicitudDemorada,
} from '../../../src/shared/alertasRefugio';

const HOY = new Date('2026-10-19T12:00:00.000Z');
const hace = (dias: number) => new Date(HOY.getTime() - dias * 86_400_000);

describe('diasDesde', () => {
  it('cuenta días enteros y nunca da negativo', () => {
    expect(diasDesde(hace(3), HOY)).toBe(3);
    expect(diasDesde(new Date(HOY.getTime() + 86_400_000), HOY)).toBe(0);
  });
});

describe('esSolicitudDemorada', () => {
  it('abierta con 5 días o más en su estado: demorada', () => {
    expect(esSolicitudDemorada({ nombre: 'Pendiente', desde: hace(5) }, HOY)).toBe(true);
    expect(esSolicitudDemorada({ nombre: 'En_Revision', desde: hace(9) }, HOY)).toBe(true);
    // Ya revisada y esperando la decisión del refugio.
    expect(esSolicitudDemorada({ nombre: 'Revisada', desde: hace(6) }, HOY)).toBe(true);
  });

  it('una cerrada o cancelada ya no espera nada: nunca está demorada', () => {
    expect(esSolicitudDemorada({ nombre: 'Cerrada', desde: hace(40) }, HOY)).toBe(false);
    expect(esSolicitudDemorada({ nombre: 'Cancelada', desde: hace(40) }, HOY)).toBe(false);
  });

  it('abierta hace menos de 5 días, o ya resuelta: no', () => {
    expect(esSolicitudDemorada({ nombre: 'Pendiente', desde: hace(4) }, HOY)).toBe(false);
    expect(esSolicitudDemorada({ nombre: 'Aprobada', desde: hace(30) }, HOY)).toBe(false);
  });
});

describe('esPublicacionAntigua', () => {
  it('activa o pausada con 60 días o más: antigua', () => {
    expect(esPublicacionAntigua({ estado: 'Activa', fechaAlta: hace(60) }, HOY)).toBe(true);
    expect(esPublicacionAntigua({ estado: 'Pausada', fechaAlta: hace(100) }, HOY)).toBe(true);
  });

  it('finalizada o reciente: no', () => {
    expect(esPublicacionAntigua({ estado: 'Finalizada', fechaAlta: hace(100) }, HOY)).toBe(false);
    expect(esPublicacionAntigua({ estado: 'Activa', fechaAlta: hace(59) }, HOY)).toBe(false);
  });
});
