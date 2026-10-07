import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoOpcionalSchema,
  dniSchema,
  textoOpcionalSchema,
  textoSchema,
  urlSchema,
} from '../../shared/validation/schemas';
import { nombrePersonaSchema, emailSchema, passwordSchema, telefonoSchema } from '../auth/auth.dto';

export const actualizarPerfilBodySchema = z.object({
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  email: emailSchema,
  telefono: telefonoSchema,
  // Dirección estructurada que se geocodifica (node-geocoder). Opcional: sin los tres campos
  // completos no se toca la ubicación ni las coordenadas del perfil.
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
  // Lo manda el cliente cuando el usuario confirmó el pin en Datos personales.
  ubicacionVerificada: booleanoOpcionalSchema(),
});

export type ActualizarPerfilBody = z.infer<typeof actualizarPerfilBodySchema>;

/** Carga única del DNI (spec 027 §6.11). */
export const cargarDniBodySchema = z.object({ dni: dniSchema() });

export type CargarDniBody = z.infer<typeof cargarDniBodySchema>;

/**
 * Preview del link de Google Maps: geocodifica la dirección estructurada SIN guardarla, para
 * que Datos personales muestre el link generado y el usuario lo verifique antes de guardar.
 */
export const previewUbicacionBodySchema = z.object({
  provincia: textoSchema({ max: LIMITES.usuario.provincia.max, etiqueta: 'La provincia' }),
  localidad: textoSchema({ max: LIMITES.usuario.localidad.max, etiqueta: 'La localidad' }),
  calleAltura: textoSchema({ max: LIMITES.usuario.calleAltura.max, etiqueta: 'La calle y altura' }),
});

export type PreviewUbicacionBody = z.infer<typeof previewUbicacionBodySchema>;

export interface UbicacionGeocodificadaDto {
  mapaUrl: string;
  latitud: number;
  longitud: number;
}

/**
 * Edición manual del link de Google Maps (el lápiz de "Ubicación" en Mi Perfil). El service
 * parsea las coordenadas del link y actualiza latitud/longitud, así el pin queda donde el
 * usuario lo pegó.
 */
export const actualizarUbicacionBodySchema = z.object({
  mapaUrl: urlSchema('El link del mapa', LIMITES.usuario.mapaUrl.max),
});

export type ActualizarUbicacionBody = z.infer<typeof actualizarUbicacionBodySchema>;

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
  /** Se carga una sola vez; `null` en cuentas viejas y de Google (spec 027). */
  dni: string | null;
  /** Dirección estructurada del perfil (para geocodificar). */
  provincia: string | null;
  localidad: string | null;
  calleAltura: string | null;
  /** URL de Google Maps y coordenadas geocodificadas de la dirección. */
  mapaUrl: string | null;
  latitud: number | null;
  longitud: number | null;
  /** Si el usuario confirmó que el link de Maps apunta a su dirección real. */
  ubicacionVerificada: boolean;
  imagenUrl: string | null;
  roles: string[];
  /** El refugio al que pertenece, o `null` en un adoptante. Igual que en el login. */
  refugio: { id: number; nombre: string; estado: string } | null;
  tienePassword: boolean;
  /** Del perfil con el que se consulta: las personales o las del refugio. */
  mascotas: number;
  favoritos: number;
  valoracion: number | null;
}

/** Perfil público de otra persona (spec 023). Nunca expone datos de contacto ni la dirección. */
export interface PerfilPublicoUsuarioDto {
  id: number;
  nombre: string;
  apellido: string;
  imagenUrl: string | null;
  verificado: boolean;
  provincia: string | null;
  localidad: string | null;
  fechaAlta: string;
  /** Es el perfil de quien consulta: la app oculta «Reportar». */
  esPropio: boolean;
}
