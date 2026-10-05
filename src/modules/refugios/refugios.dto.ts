/** Perfil público de un refugio (spec 023, GUI-26). Solo salida: la entrada es el `:id` de la ruta. */

export interface PerfilPublicoRefugioDto {
  id: number;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  /** Siempre `true` hoy: solo se muestran refugios activos, o sea ya verificados. */
  verificado: boolean;
  provincia: string | null;
  localidad: string | null;
  calleAltura: string | null;
  mapaUrl: string | null;
  fechaAlta: string;
  resumen: {
    publicacionesActivas: number;
    resenas: { promedio: number | null; cantidad: number };
  };
  /** Quien consulta pertenece a este refugio: la app oculta «Reportar». */
  esMiembro: boolean;
}
