import { describe, expect, it } from 'vitest';
import { esMascotaDelAmbito, esMascotaPropia, resolverAmbito } from '../../../src/shared/ambito';
import { ROL_API } from '../../../src/shared/roles';

const MIEMBRO = [ROL_API.MIEMBRO_REFUGIO];
const ADOPTANTE = [ROL_API.ADOPTANTE];

describe('resolverAmbito', () => {
  it('sin cabecera, un miembro de refugio arranca en REFUGIO', () => {
    expect(resolverAmbito(undefined, MIEMBRO)).toEqual({ ok: true, ambito: 'REFUGIO' });
  });

  it('sin cabecera, cualquier otro usuario queda en PERSONAL', () => {
    expect(resolverAmbito(undefined, ADOPTANTE)).toEqual({ ok: true, ambito: 'PERSONAL' });
  });

  it('un miembro puede pedir su perfil personal', () => {
    expect(resolverAmbito('PERSONAL', MIEMBRO)).toEqual({ ok: true, ambito: 'PERSONAL' });
  });

  it('acepta el valor sin importar mayúsculas', () => {
    expect(resolverAmbito('refugio', MIEMBRO)).toEqual({ ok: true, ambito: 'REFUGIO' });
  });

  it('pedir REFUGIO sin pertenecer a uno es un error, no un PERSONAL silencioso', () => {
    expect(resolverAmbito('REFUGIO', ADOPTANTE)).toEqual({ ok: false, motivo: 'SIN_REFUGIO' });
  });

  it('rechaza un valor desconocido', () => {
    expect(resolverAmbito('ADMIN', MIEMBRO)).toEqual({ ok: false, motivo: 'INVALIDO' });
  });
});

describe('esMascotaDelAmbito', () => {
  const actor = { id: 2, refugioId: 1 };

  it('en PERSONAL, solo las personales propias', () => {
    expect(esMascotaDelAmbito({ usuarioId: 2, refugioId: null }, actor, 'PERSONAL')).toBe(true);
    expect(esMascotaDelAmbito({ usuarioId: 2, refugioId: 1 }, actor, 'PERSONAL')).toBe(false);
    expect(esMascotaDelAmbito({ usuarioId: 9, refugioId: null }, actor, 'PERSONAL')).toBe(false);
  });

  it('en REFUGIO, cualquiera de su refugio y ninguna personal', () => {
    expect(esMascotaDelAmbito({ usuarioId: 9, refugioId: 1 }, actor, 'REFUGIO')).toBe(true);
    expect(esMascotaDelAmbito({ usuarioId: 2, refugioId: null }, actor, 'REFUGIO')).toBe(false);
    expect(esMascotaDelAmbito({ usuarioId: 9, refugioId: 5 }, actor, 'REFUGIO')).toBe(false);
  });
});

describe('esMascotaPropia', () => {
  const actor = { id: 2, refugioId: 1 };

  it('lo personal y lo de su refugio son propios; lo de otros, no', () => {
    expect(esMascotaPropia({ usuarioId: 2, refugioId: null }, actor)).toBe(true);
    expect(esMascotaPropia({ usuarioId: 9, refugioId: 1 }, actor)).toBe(true);
    expect(esMascotaPropia({ usuarioId: 9, refugioId: 5 }, actor)).toBe(false);
    expect(esMascotaPropia({ usuarioId: 9, refugioId: null }, actor)).toBe(false);
  });
});
