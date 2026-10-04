/**
 * Entrada y salida de la bandeja de notificaciones (spec 004). Las reglas genéricas de
 * paginación salen de `shared/validation`; acá sólo se compone lo propio del módulo.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, limitePaginaSchema } from '../../shared/validation/schemas';

/** Paginación por cursor de GET /notificaciones (mismo esquema que animales-perdidos/chat). */
export const listarNotificacionesQuerySchema = z.object({
  cursor: idSchema('El cursor').optional(),
  limite: limitePaginaSchema(LIMITES.notificacion.pagina),
});

export type ListarNotificacionesQuery = z.infer<typeof listarNotificacionesQuerySchema>;

export const registrarDispositivoSchema = z.object({
  expoPushToken: z.string().min(1, 'El token de push es obligatorio'),
  plataforma: z.enum(['ios', 'android'], {
    errorMap: () => ({ message: 'La plataforma tiene que ser "ios" o "android"' }),
  }),
});

export type RegistrarDispositivoDto = z.infer<typeof registrarDispositivoSchema>;

/** Un ítem de la bandeja (GUI de notificaciones). */
export interface NotificacionItemDto {
  id: number;
  tipo: string;
  mensaje: string;
  leido: boolean;
  entidadTipo: string | null;
  entidadId: number | null;
  fechaAlta: string;
}

export interface ListaNotificacionesDto {
  notificaciones: NotificacionItemDto[];
  hayMas: boolean;
  proximoCursor: number | null;
}

export interface ContadorNoLeidasDto {
  contador: number;
}
