/**
 * Entrada y salida de Favoritos: alta (HU-7.2) y listado (HU-6.6). Las reglas genéricas
 * salen de `shared/validation`; acá sólo se compone lo propio de Favorito.
 */
import { z } from 'zod';
import { idSchema } from '../../shared/validation/schemas';

// La etiqueta es "El id de la mascota" y no "La mascota" por dos razones: `idSchema` arma
// el mensaje con "es obligatorio"/"no es válido" en masculino, y así el texto coincide
// exactamente con el que devuelve el DELETE cuando el id viene mal en la URL.
export const agregarFavoritoSchema = z.object({
  mascotaId: idSchema('El id de la mascota'),
});

export type AgregarFavoritoDto = z.infer<typeof agregarFavoritoSchema>;

/**
 * Una tarjeta de la grilla de GUI-12. Trae lo justo para renderizarla: foto, nombre,
 * fecha de nacimiento y el estado vigente para el badge.
 *
 * La edad NO viene calculada: el backend devuelve `fechaNacimiento` y el cliente la
 * convierte con `edadEnTexto`, igual que en el resto del proyecto.
 */
export interface MascotaFavoritaDto {
  id: number;
  nombre: string | null;
  fechaNacimiento: string | null;
  imagenUrl: string | null;
  especie: { id: number; nombre: string };
  raza: { id: number; nombre: string };
  /** Estado ACTUAL de la mascota, no el que tenía al guardarla (HU-6.6). */
  estado: { id: number; nombre: string };
  /**
   * Publicación activa de la mascota, o `null` si ya no está publicada. Es lo que habilita
   * el botón "Solicitar" de la tarjeta (HU-7.1): sin publicación no hay qué solicitar.
   */
  publicacionId: number | null;
  /**
   * Solicitud viva que este usuario ya tiene sobre esa publicación. Con valor, la tarjeta
   * muestra "Solicitud enviada" en lugar del botón.
   */
  solicitudAbiertaId: number | null;
  /** Momento en que se guardó: define el orden por defecto del listado. */
  fechaAgregado: string;
}

/**
 * `total` alimenta el contador del header ("3 animales guardados").
 *
 * Hoy es siempre `favoritos.length` porque el listado no pagina — viaja como campo aparte
 * para que, si algún día se agrega paginación, el contrato no cambie de forma y el
 * contador pueda seguir siendo el total real y no el de la página.
 */
export interface ListaFavoritosDto {
  total: number;
  favoritos: MascotaFavoritaDto[];
}

/** Respuesta del alta: al swipe le alcanza con saber que quedó guardada. */
export interface FavoritoAgregadoDto {
  id: number;
  mascotaId: number;
  fechaAgregado: string;
}
