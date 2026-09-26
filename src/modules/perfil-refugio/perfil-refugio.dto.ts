/**
 * Perfil propio del refugio (spec 017): lo que ve y edita un miembro desde la vista de
 * refugio. Mismos límites que el alta del admin (spec 002), para que un refugio no pueda
 * quedar con un dato que el admin no hubiera podido cargar.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  textoOpcionalSchema,
  textoSchema,
  vacioComoNuloSchema,
} from '../../shared/validation/schemas';
import { emailSchema, telefonoSchema } from '../auth/auth.dto';

/** Viajan todos los campos siempre (multipart): borrar uno opcional llega como vacío. */
export const actualizarPerfilRefugioBodySchema = z.object({
  nombre: textoSchema({ ...LIMITES.refugio.nombre, etiqueta: 'El nombre del refugio' }),
  direccion: textoSchema({ ...LIMITES.refugio.direccion, etiqueta: 'La dirección' }),
  telefono: vacioComoNuloSchema(telefonoSchema),
  email: vacioComoNuloSchema(emailSchema),
  descripcion: textoOpcionalSchema({
    max: LIMITES.refugio.descripcion.max,
    etiqueta: 'La descripción',
  }),
});

export type ActualizarPerfilRefugioBody = z.infer<typeof actualizarPerfilRefugioBodySchema>;

export interface PerfilRefugio {
  id: number;
  nombre: string;
  direccion: string;
  telefono: string | null;
  email: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  verificado: boolean;
  estado: string;
  estadisticas: {
    /** Mascotas vigentes que siguen en el refugio: Disponible, En_Tratamiento o En_Transito. */
    enRefugio: number;
    /** Mascotas del refugio cuyo estado vigente es Adoptado. */
    adopciones: number;
    /** Solicitudes sobre mascotas del refugio en Pendiente o En_Revision. */
    solicitudesAbiertas: number;
  };
  valoracion: { promedio: number | null; cantidad: number };
  /**
   * Si quien consulta puede editar los datos. Hoy cualquier miembro puede: el permiso por
   * rol dentro del refugio está pendiente (DEUDA_TECNICA.md, ítem 17). El front ya decide
   * con este campo si muestra los lápices, así el día que cambie no hay que tocarlo.
   */
  puedeEditar: boolean;
}
