/**
 * Perfil propio del refugio (spec 017): lo que ve y edita un miembro desde la vista de
 * refugio. Mismos límites que el alta del admin (spec 002), para que un refugio no pueda
 * quedar con un dato que el admin no hubiera podido cargar.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoOpcionalSchema,
  textoOpcionalSchema,
  textoSchema,
  urlSchema,
  vacioComoNuloSchema,
} from '../../shared/validation/schemas';
import { emailSchema, telefonoSchema } from '../auth/auth.dto';

/** Viajan todos los campos siempre (multipart): borrar uno opcional llega como vacío. */
export const actualizarPerfilRefugioBodySchema = z.object({
  nombre: textoSchema({ ...LIMITES.refugio.nombre, etiqueta: 'El nombre del refugio' }),
  // Dirección estructurada que se geocodifica (node-geocoder). Opcional: sin los tres campos
  // completos no se toca la ubicación ni las coordenadas del refugio.
  provincia: textoOpcionalSchema({
    max: LIMITES.refugio.provincia.max,
    etiqueta: 'La provincia',
  }),
  localidad: textoOpcionalSchema({
    max: LIMITES.refugio.localidad.max,
    etiqueta: 'La localidad',
  }),
  calleAltura: textoOpcionalSchema({
    max: LIMITES.refugio.calleAltura.max,
    etiqueta: 'La calle y altura',
  }),
  telefono: vacioComoNuloSchema(telefonoSchema),
  email: vacioComoNuloSchema(emailSchema),
  descripcion: textoOpcionalSchema({
    max: LIMITES.refugio.descripcion.max,
    etiqueta: 'La descripción',
  }),
  // Lo manda el cliente cuando el refugio confirmó el pin en Datos del refugio.
  ubicacionVerificada: booleanoOpcionalSchema(),
});

export type ActualizarPerfilRefugioBody = z.infer<typeof actualizarPerfilRefugioBodySchema>;

/**
 * Preview del link de Google Maps del refugio: geocodifica la dirección estructurada SIN
 * guardarla, para que Datos del refugio muestre el link y el miembro lo verifique.
 */
export const previewUbicacionRefugioBodySchema = z.object({
  provincia: textoSchema({ max: LIMITES.refugio.provincia.max, etiqueta: 'La provincia' }),
  localidad: textoSchema({ max: LIMITES.refugio.localidad.max, etiqueta: 'La localidad' }),
  calleAltura: textoSchema({
    max: LIMITES.refugio.calleAltura.max,
    etiqueta: 'La calle y altura',
  }),
});

export type PreviewUbicacionRefugioBody = z.infer<typeof previewUbicacionRefugioBodySchema>;

export interface UbicacionGeocodificadaRefugioDto {
  mapaUrl: string;
  latitud: number;
  longitud: number;
}

/**
 * Edición manual del link de Google Maps del refugio (el lápiz de "Ubicación" en Mi Refugio).
 * El service parsea las coordenadas y actualiza latitud/longitud.
 */
export const actualizarUbicacionRefugioBodySchema = z.object({
  mapaUrl: urlSchema('El link del mapa', LIMITES.refugio.mapaUrl.max),
});

export type ActualizarUbicacionRefugioBody = z.infer<typeof actualizarUbicacionRefugioBodySchema>;

export interface PerfilRefugio {
  id: number;
  nombre: string;
  /** Dirección estructurada del refugio (para geocodificar). */
  provincia: string | null;
  localidad: string | null;
  calleAltura: string | null;
  /** URL de Google Maps y coordenadas geocodificadas de la dirección. */
  mapaUrl: string | null;
  latitud: number | null;
  longitud: number | null;
  /** Si el refugio confirmó que el link de Maps apunta a su dirección real. */
  ubicacionVerificada: boolean;
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
