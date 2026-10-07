import { describe, expect, it } from 'vitest';
import { registroBodySchema } from '../../../../src/modules/auth/auth.dto';

const VALIDO = {
  nombre: 'Ana',
  apellido: 'Gómez',
  email: 'ana@mail.com',
  password: 'Secreta123!',
  fechaNacimiento: '20/05/1995',
  telefono: '+542615123456',
  dni: '30123456',
};

function primerError(datos: object): string | undefined {
  const resultado = registroBodySchema.safeParse(datos);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('registroBodySchema: DNI (HU-1.1, spec 027)', () => {
  it('es obligatorio', () => {
    const { dni: _dni, ...sinDni } = VALIDO;
    expect(primerError(sinDni)).toBe('El DNI es obligatorio.');
  });

  it('7 u 8 dígitos, sin puntos', () => {
    expect(primerError({ ...VALIDO, dni: '30.123.456' })).toBe(
      'El DNI debe tener 7 u 8 dígitos numéricos.',
    );
  });
});
