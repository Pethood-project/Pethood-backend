import { describe, expect, it } from 'vitest';
import { consultaBodySchema, faqPatchSchema } from '../../../../src/modules/soporte/soporte.dto';

const valida = {
  nombreCompleto: '  Ana Pérez ',
  email: 'ANA@Correo.com',
  asunto: 'No puedo subir fotos',
  mensaje: 'La foto no carga al publicar.',
};

describe('consultaBodySchema', () => {
  it('acepta datos válidos, con trim y email en minúsculas', () => {
    const res = consultaBodySchema.parse(valida);
    expect(res.nombreCompleto).toBe('Ana Pérez');
    expect(res.email).toBe('ana@correo.com');
  });

  it.each(['nombreCompleto', 'email', 'asunto', 'mensaje'] as const)(
    'rechaza si falta %s',
    (campo) => {
      const { [campo]: _omitido, ...resto } = valida;
      expect(consultaBodySchema.safeParse(resto).success).toBe(false);
    },
  );

  it('rechaza un nombre con números', () => {
    expect(consultaBodySchema.safeParse({ ...valida, nombreCompleto: 'Ana 3' }).success).toBe(
      false,
    );
  });

  it.each(['ana.correo.com', 'ana@', 'ana@correo'])('rechaza el correo %s', (email) => {
    expect(consultaBodySchema.safeParse({ ...valida, email }).success).toBe(false);
  });

  it('rechaza un mensaje que supera el límite', () => {
    expect(consultaBodySchema.safeParse({ ...valida, mensaje: 'a'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('rechaza un asunto de solo espacios', () => {
    expect(consultaBodySchema.safeParse({ ...valida, asunto: '        ' }).success).toBe(false);
  });
});

describe('faqPatchSchema', () => {
  it('rechaza un cuerpo vacío', () => {
    expect(faqPatchSchema.safeParse({}).success).toBe(false);
  });

  it('acepta editar solo el orden', () => {
    expect(faqPatchSchema.parse({ orden: '3' })).toEqual({ orden: 3 });
  });
});
