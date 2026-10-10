import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { dniSchema, textoOpcionalSchema, textoSchema } from '../../shared/validation/schemas';
import { ROL_API } from '../../shared/roles';

export const nombrePersonaSchema = z
  .string()
  .trim()
  .min(1, 'Este campo es obligatorio. Completalo para poder continuar.')
  .max(50, 'El nombre es demasiado largo.')
  .regex(/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/, 'El nombre solo puede tener letras.');

export const emailSchema = z
  .string()
  .trim()
  .email('El correo no es válido. Asegurate de incluir el "@" y un dominio correcto.')
  .transform((valor) => valor.toLowerCase());

export const telefonoSchema = z
  .string()
  .trim()
  .min(1, 'El teléfono es obligatorio. Completalo para poder continuar.')
  .transform((valor) => {
    const conMas = valor.startsWith('+');
    const digitos = valor.replace(/\D/g, '');
    return conMas ? `+${digitos}` : digitos;
  })
  .refine((valor) => {
    const digitos = valor.replace(/\D/g, '');
    return digitos.length >= 8 && digitos.length <= 15 && /^\+?\d+$/.test(valor);
  }, 'Ingresá un teléfono válido.');

export const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.');

export const registroBodySchema = z.object({
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  email: emailSchema,
  password: passwordSchema,
  fechaNacimiento: z
    .string()
    .trim()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'La fecha de nacimiento debe tener el formato DD/MM/AAAA.'),
  telefono: telefonoSchema,
  // Obligatorio (HU-1.1): es la identidad que valida el admin y la que confirma las
  // donaciones por Mercado Pago (spec 027).
  dni: dniSchema(),
  // Dirección estructurada opcional que se geocodifica al crear la cuenta (node-geocoder).
  provincia: textoOpcionalSchema({
    max: LIMITES.usuario.provincia.max,
    etiqueta: 'La provincia',
  }),
  localidad: textoOpcionalSchema({
    max: LIMITES.usuario.localidad.max,
    etiqueta: 'La localidad',
  }),
  calleAltura: textoOpcionalSchema({
    max: LIMITES.usuario.calleAltura.max,
    etiqueta: 'La calle y altura',
  }),
  rol: z.enum([ROL_API.ADOPTANTE, ROL_API.MIEMBRO_REFUGIO]).default(ROL_API.ADOPTANTE),
});

export type RegistroBody = z.infer<typeof registroBodySchema>;

/** Un campo opcional de formulario multipart llega como '' cuando está vacío: se trata como ausente. */
const vacioAUndefined = (valor: unknown) => (valor === '' ? undefined : valor);

/**
 * Alta pública de refugio desde la landing de web-admin (HU-1.1 / HU-2.4): crea a la persona
 * que lo gestiona y al refugio, que nace sin verificar hasta que el admin lo apruebe (HU-2.2).
 */
export const registroRefugioBodySchema = z.object({
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  email: emailSchema,
  password: passwordSchema,
  refugioNombre: textoSchema({ ...LIMITES.refugio.nombre, etiqueta: 'El nombre del refugio' }),
  provincia: textoSchema({ max: LIMITES.refugio.provincia.max, etiqueta: 'La provincia' }),
  localidad: textoSchema({ max: LIMITES.refugio.localidad.max, etiqueta: 'La localidad' }),
  calleAltura: textoSchema({
    max: LIMITES.refugio.calleAltura.max,
    etiqueta: 'La calle y altura',
  }),
  refugioTelefono: z.preprocess(vacioAUndefined, telefonoSchema.optional()),
  refugioEmail: z.preprocess(vacioAUndefined, emailSchema.optional()),
  refugioDescripcion: textoOpcionalSchema({
    max: LIMITES.refugio.descripcion.max,
    etiqueta: 'La descripción',
  }),
});

export type RegistroRefugioBody = z.infer<typeof registroRefugioBodySchema>;

export interface RespuestaRegistroRefugio {
  mensaje: string;
  refugio: { id: number; nombre: string; estado: string };
}

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es obligatoria.'),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const googleIdTokenBodySchema = z.object({
  idToken: z.string().min(1, 'Falta el token de Google.'),
});

export const recuperarBodySchema = z.object({
  email: emailSchema,
});

export type RecuperarBody = z.infer<typeof recuperarBodySchema>;

export const resetearBodySchema = z.object({
  email: emailSchema,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
  password: passwordSchema,
});

export type ResetearBody = z.infer<typeof resetearBodySchema>;

export interface RespuestaRecuperar {
  mensaje: string;
  /** Solo en development/test, para poder probar el flujo sin SMTP. */
  codigo?: string;
}

export type GoogleIdTokenBody = z.infer<typeof googleIdTokenBodySchema>;

/**
 * El refugio en el que trabaja la persona, o `null` si no pertenece a ninguno.
 *
 * Viaja en la sesión y no como un pedido aparte porque define qué ve la app apenas entra:
 * la cabecera de GUI-31 lo nombra, y el chat ya distinguía al refugio del adoptante con un
 * dato que el cliente no tenía.
 */
export const refugioDeSesionSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  /** Estado del refugio (`Activo`, `Pendiente_Verificacion`, `Suspendido`, `Inactivo`). */
  estado: z.string(),
});

export const usuarioPublicoSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  apellido: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  imagenUrl: z.string().nullable(),
  telefono: z.string().nullable().optional(),
  refugio: refugioDeSesionSchema.nullable(),
});

export const respuestaAuthSchema = z.object({
  usuario: usuarioPublicoSchema,
  token: z.string(),
});

export type RespuestaAuth = z.infer<typeof respuestaAuthSchema>;
