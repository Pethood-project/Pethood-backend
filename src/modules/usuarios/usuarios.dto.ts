import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { textoSchema } from '../../shared/validation/schemas';
import { nombrePersonaSchema, emailSchema, passwordSchema, telefonoSchema } from '../auth/auth.dto';

export const actualizarPerfilBodySchema = z.object({
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  email: emailSchema,
  telefono: telefonoSchema,
  ubicacion: textoSchema({
    max: LIMITES.usuario.ubicacion.max,
    etiqueta: 'El barrio / ciudad',
  }),
});

export type ActualizarPerfilBody = z.infer<typeof actualizarPerfilBodySchema>;

export const cambiarPasswordBodySchema = z.object({
  passwordActual: z.string().min(1, 'La contraseña actual es obligatoria.').optional(),
  passwordNueva: passwordSchema,
});

export type CambiarPasswordBody = z.infer<typeof cambiarPasswordBodySchema>;

export interface PerfilPropio {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  ubicacion: string | null;
  imagenUrl: string | null;
  roles: string[];
  tienePassword: boolean;
  mascotas: number;
  favoritos: number;
  valoracion: number | null;
}
