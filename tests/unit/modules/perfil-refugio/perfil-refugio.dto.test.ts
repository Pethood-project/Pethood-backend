import { describe, expect, it } from 'vitest';
import { actualizarPerfilRefugioBodySchema } from '../../../../src/modules/perfil-refugio/perfil-refugio.dto';

const VALIDO = {
  nombre: '  Refugio Esperanza ',
  direccion: 'Av. Santa Fe 1234, Palermo, CABA',
  telefono: '+54 11 4444-5678',
  email: 'Esperanza@Refugio.com',
  descripcion: 'Rescate y adopción responsable.',
};

describe('actualizarPerfilRefugioBodySchema', () => {
  it('normaliza los datos válidos', () => {
    expect(actualizarPerfilRefugioBodySchema.parse(VALIDO)).toEqual({
      nombre: 'Refugio Esperanza',
      direccion: 'Av. Santa Fe 1234, Palermo, CABA',
      telefono: '+541144445678',
      email: 'esperanza@refugio.com',
      descripcion: 'Rescate y adopción responsable.',
    });
  });

  it('deja en null los opcionales que llegan vacíos (así se borran)', () => {
    const resultado = actualizarPerfilRefugioBodySchema.parse({
      ...VALIDO,
      telefono: '',
      email: '   ',
      descripcion: '',
    });

    expect(resultado).toMatchObject({ telefono: null, email: null, descripcion: null });
  });

  it('valida el teléfono y el correo cuando traen algo', () => {
    expect(
      actualizarPerfilRefugioBodySchema.safeParse({ ...VALIDO, telefono: '123' }).success,
    ).toBe(false);
    expect(
      actualizarPerfilRefugioBodySchema.safeParse({ ...VALIDO, email: 'sin-arroba' }).success,
    ).toBe(false);
  });

  it('exige nombre y dirección', () => {
    expect(actualizarPerfilRefugioBodySchema.safeParse({ ...VALIDO, nombre: ' ' }).success).toBe(
      false,
    );
    expect(actualizarPerfilRefugioBodySchema.safeParse({ ...VALIDO, direccion: '' }).success).toBe(
      false,
    );
  });
});
