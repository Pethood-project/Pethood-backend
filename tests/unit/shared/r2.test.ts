import { describe, expect, it } from 'vitest';
import { configR2Desde } from '../../../src/shared/r2';

describe('configR2Desde', () => {
  const completo = {
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'pethood',
    R2_PUBLIC_BASE_URL: 'https://cdn.pethood.test/',
  };

  it('devuelve undefined si falta alguna key', () => {
    expect(configR2Desde({})).toBeUndefined();
    expect(configR2Desde({ ...completo, R2_BUCKET_NAME: '' })).toBeUndefined();
  });

  it('normaliza la URL pública sin barra final', () => {
    const config = configR2Desde(completo);
    expect(config?.publicBaseUrl).toBe('https://cdn.pethood.test');
    expect(config?.bucket).toBe('pethood');
  });
});
