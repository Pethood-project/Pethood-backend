import { describe, expect, it } from 'vitest';
import { editarMascotaSchema } from '../../../src/modules/mascotas/mascotas.dto';

/** Atajo: parsea y devuelve los datos, asumiendo que el schema aceptó la entrada. */
function parsear(entrada: unknown) {
  const resultado = editarMascotaSchema.safeParse(entrada);

  if (!resultado.success) {
    throw new Error(`Se esperaba una entrada válida: ${resultado.error.issues[0]?.message}`);
  }

  return resultado.data;
}

function primerError(entrada: unknown): string | undefined {
  const resultado = editarMascotaSchema.safeParse(entrada);

  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('editarMascotaSchema — campos ausentes', () => {
  it('un campo que no llegó queda undefined y no se escribe', () => {
    expect(parsear({ nombre: 'Fido' })).toEqual({ nombre: 'Fido' });
  });

  it('castrado ausente NO colapsa a false', () => {
    expect(parsear({ nombre: 'Fido' }).castrado).toBeUndefined();
  });

  it('castrado sí se lee cuando llega como texto del multipart', () => {
    expect(parsear({ castrado: 'true' }).castrado).toBe(true);
    expect(parsear({ castrado: 'false' }).castrado).toBe(false);
  });

  it('una descripción vacía se guarda como null para limpiar la columna', () => {
    expect(parsear({ descripcion: '' }).descripcion).toBeNull();
  });
});

describe('editarMascotaSchema — raza y especie', () => {
  it('acepta que no venga ninguna de las dos', () => {
    expect(primerError({ nombre: 'Fido' })).toBeUndefined();
  });

  it('acepta el par completo', () => {
    expect(primerError({ razaId: 2, especieId: 1 })).toBeUndefined();
  });

  it('rechaza la raza sin su especie', () => {
    expect(primerError({ razaId: 2 })).toBe(
      'Para cambiar la raza tenés que indicar también la especie',
    );
  });

  it('rechaza la especie sin su raza', () => {
    expect(primerError({ especieId: 1 })).toBe(
      'Para cambiar la raza tenés que indicar también la especie',
    );
  });
});

describe('editarMascotaSchema — validaciones heredadas del alta', () => {
  it('aplica el mínimo de longitud del nombre', () => {
    expect(primerError({ nombre: 'A' })).toContain('El nombre');
  });

  it('acepta el peso escrito con coma', () => {
    expect(parsear({ peso: '12,5' }).peso).toBe(12.5);
  });

  it('rechaza una fecha de nacimiento futura', () => {
    const futura = new Date(Date.now() + 86_400_000).toISOString();

    expect(primerError({ fechaNacimiento: futura })).toContain('La fecha de nacimiento');
  });

  it('rechaza un sexo que no está en el enum', () => {
    expect(primerError({ genero: 'OTRO' })).toBe('El sexo no es válido');
  });
});
