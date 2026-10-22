import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumirCanje,
  emitirCanje,
  limpiarCanjes,
} from '../../../../src/modules/auth/auth.canjeStore';
import { canjeGoogleBodySchema } from '../../../../src/modules/auth/auth.dto';

const NONCE = 'a'.repeat(32);

describe('auth.canjeStore', () => {
  beforeEach(() => {
    limpiarCanjes();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('devuelve el token una sola vez', () => {
    const codigo = emitirCanje('jwt', NONCE);

    expect(consumirCanje(codigo, NONCE)).toBe('jwt');
    expect(consumirCanje(codigo, NONCE)).toBeNull();
  });

  it('rechaza un nonce distinto y quema el código', () => {
    const codigo = emitirCanje('jwt', NONCE);

    expect(consumirCanje(codigo, 'b'.repeat(32))).toBeNull();
    expect(consumirCanje(codigo, NONCE)).toBeNull();
  });

  it('rechaza un código vencido', () => {
    const codigo = emitirCanje('jwt', NONCE);
    vi.advanceTimersByTime(61_000);

    expect(consumirCanje(codigo, NONCE)).toBeNull();
  });

  it('el body exige un nonce largo y sin caracteres raros', () => {
    expect(canjeGoogleBodySchema.safeParse({ code: 'x', nonce: NONCE }).success).toBe(true);
    expect(canjeGoogleBodySchema.safeParse({ code: 'x', nonce: 'corto' }).success).toBe(false);
    expect(canjeGoogleBodySchema.safeParse({ code: 'x', nonce: `${NONCE}!` }).success).toBe(false);
  });
});
