import { z } from 'zod';
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
  dni: z
    .string()
    .trim()
    .regex(/^\d{7,8}$/, 'El DNI debe tener 7 u 8 dígitos numéricos.')
    .optional(),
  rol: z.enum([ROL_API.ADOPTANTE, ROL_API.MIEMBRO_REFUGIO]).default(ROL_API.ADOPTANTE),
});

export type RegistroBody = z.infer<typeof registroBodySchema>;

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

export const usuarioPublicoSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  apellido: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  imagenUrl: z.string().nullable(),
  telefono: z.string().nullable().optional(),
  ubicacion: z.string().nullable().optional(),
});

export const respuestaAuthSchema = z.object({
  usuario: usuarioPublicoSchema,
  token: z.string(),
});

export type RespuestaAuth = z.infer<typeof respuestaAuthSchema>;
