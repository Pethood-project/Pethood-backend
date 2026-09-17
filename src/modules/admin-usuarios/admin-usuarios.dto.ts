/**
 * Entrada/salida de la gestión admin de usuarios y refugios (spec 002). Las reglas
 * genéricas (trim, longitudes) salen de `shared/validation`; acá solo se compone lo
 * propio del módulo.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, textoOpcionalSchema, textoSchema } from '../../shared/validation/schemas';
import { ESTADO_USUARIO, ROL_API } from '../../shared/roles';
import { emailSchema, telefonoSchema } from '../auth/auth.dto';

export const PAGINA_LIMITE_POR_DEFECTO = 20;
export const PAGINA_LIMITE_MAXIMO = 50;

const paginacionSchema = {
  page: z.coerce.number().int().positive('La página no es válida').optional().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(PAGINA_LIMITE_MAXIMO)
    .optional()
    .default(PAGINA_LIMITE_POR_DEFECTO),
};

/** `'true'`/`'false'` en query string; ausente = sin filtro. */
const banderaOpcionalSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((valor) => (valor === undefined ? undefined : valor === 'true'));

export const filtrosUsuariosSchema = z.object({
  q: z.string().trim().min(1).optional(),
  rol: z.enum([ROL_API.ADOPTANTE, ROL_API.MIEMBRO_REFUGIO, ROL_API.ADMIN]).optional(),
  estado: z
    .enum([
      ESTADO_USUARIO.PENDIENTE,
      ESTADO_USUARIO.ACTIVO,
      ESTADO_USUARIO.SUSPENDIDO,
      ESTADO_USUARIO.INACTIVO,
    ])
    .optional(),
  verificado: banderaOpcionalSchema,
  ...paginacionSchema,
});

export type FiltrosUsuarios = z.infer<typeof filtrosUsuariosSchema>;

export const ESTADOS_REFUGIO = [
  'Pendiente_Verificacion',
  'Activo',
  'Suspendido',
  'Inactivo',
] as const;

export const filtrosRefugiosSchema = z.object({
  q: z.string().trim().min(1).optional(),
  estado: z.enum(ESTADOS_REFUGIO).optional(),
  verificado: banderaOpcionalSchema,
  ...paginacionSchema,
});

export type FiltrosRefugios = z.infer<typeof filtrosRefugiosSchema>;

export const motivoBodySchema = z.object({
  motivo: textoSchema({ ...LIMITES.admin.motivo, etiqueta: 'El motivo' }),
});

export type MotivoBody = z.infer<typeof motivoBodySchema>;

/**
 * `agregar`/`quitar` no pueden compartir un rol (ambiguo, HU-2.1) y agregar MIEMBRO_REFUGIO
 * exige `refugioId` — un miembro sin refugio es un estado inválido del modelo.
 */
export const rolesBodySchema = z
  .object({
    agregar: z
      .array(z.enum([ROL_API.ADOPTANTE, ROL_API.MIEMBRO_REFUGIO, ROL_API.ADMIN]))
      .default([]),
    quitar: z
      .array(z.enum([ROL_API.ADOPTANTE, ROL_API.MIEMBRO_REFUGIO, ROL_API.ADMIN]))
      .default([]),
    refugioId: idSchema('El refugio').optional(),
  })
  .refine((body) => body.agregar.length > 0 || body.quitar.length > 0, {
    message: 'Indicá al menos un rol para agregar o quitar.',
  })
  .refine((body) => !body.agregar.some((rol) => body.quitar.includes(rol)), {
    message: 'Un rol no puede agregarse y quitarse a la vez.',
  })
  .refine(
    (body) => !body.agregar.includes(ROL_API.MIEMBRO_REFUGIO) || body.refugioId !== undefined,
    {
      message: 'Para agregar el rol de refugio indicá a qué refugio pertenece.',
    },
  );

export type RolesBody = z.infer<typeof rolesBodySchema>;

export const altaRefugioBodySchema = z.object({
  nombre: textoSchema({ ...LIMITES.refugio.nombre, etiqueta: 'El nombre' }),
  direccion: textoSchema({ ...LIMITES.refugio.direccion, etiqueta: 'La dirección' }),
  telefono: telefonoSchema.optional(),
  email: emailSchema.optional(),
  descripcion: textoOpcionalSchema({
    max: LIMITES.refugio.descripcion.max,
    etiqueta: 'La descripción',
  }),
});

export type AltaRefugioBody = z.infer<typeof altaRefugioBodySchema>;
