import { describe, expect, it } from 'vitest';
import { filtrosFeedSchema } from '../../../src/modules/publicaciones/publicaciones.dto';

describe('filtros del feed por publicador (spec 023)', () => {
  it('acepta refugioId y usuarioId como texto de la query', () => {
    const r = filtrosFeedSchema.parse({ refugioId: '4', usuarioId: '9' });
    expect(r).toMatchObject({ refugioId: 4, usuarioId: 9 });
  });

  it('son opcionales', () => {
    const r = filtrosFeedSchema.parse({});
    expect(r.refugioId).toBeUndefined();
    expect(r.usuarioId).toBeUndefined();
  });

  it('rechazan ids inválidos', () => {
    expect(filtrosFeedSchema.safeParse({ refugioId: '0' }).success).toBe(false);
    expect(filtrosFeedSchema.safeParse({ usuarioId: 'abc' }).success).toBe(false);
  });
});
