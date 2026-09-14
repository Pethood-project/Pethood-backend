/**
 * Límites de longitud y rango de los campos del dominio, en un solo lugar.
 *
 * ⚠️ ESPEJO MANUAL de `pethood-frontend/apps/mobile/shared/validation/limits.ts`.
 * Son repos separados: si cambiás un número acá, cambialo allá.
 */
export const LIMITES = {
  mascota: {
    nombre: { min: 2, max: 25 },
    /** El techo de 999.9 es lo que entra en `Decimal(4,1)`, no una regla de negocio. */
    peso: { min: 0.1, max: 999.9, decimales: 1 },
    /** Opcional. No confundir con la descripción de la publicación, que va aparte y es ≤50. */
    descripcion: { max: 2000 },
  },

  publicacion: {
    descripcion: { max: 50 },
    requisito: { max: 25 },
    ubicacion: { max: 50 },
    personalidad: { max: 25 },
    vacunas: { max: 200 },
    imagenes: { max: 5 },
  },

  usuario: {
    nombre: { min: 1, max: 50 },
    apellido: { min: 1, max: 50 },
    ubicacion: { max: 80 },
  },

  refugio: {
    nombre: { min: 2, max: 100 },
    direccion: { min: 2, max: 150 },
    descripcion: { max: 1000 },
  },

  /** Solo web-admin (spec 002) — no hay contraparte en la app mobile, no se mirrorea. */
  admin: {
    motivo: { min: 1, max: 500 },
  },

  fecha: { anioMinimo: 1900 },

  imagen: {
    tamanioMaximoBytes: 5 * 1024 * 1024,
    formatos: ['image/jpeg', 'image/png', 'image/webp'],
  },

  /** Comprobante de historia clínica: además de imagen, admite pdf (REQUISITOS.md §4). */
  documento: {
    tamanioMaximoBytes: 5 * 1024 * 1024,
    formatos: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },

  /** Sin spec de diseño que fije el número exacto todavía — valores conservadores. */
  historiaClinica: {
    titulo: { min: 1, max: 100 },
    descripcion: { min: 1, max: 1000 },
  },

  solicitud: {
    /** El comentario del refugio al aceptar/rechazar (HU-7.4). */
    comentario: { max: 500 },
    /**
     * Paso 3 de GUI-7.1.1. El mínimo de 20 es de esta HU: la columna es NOT NULL y un
     * "quiero adoptarlo" de tres palabras no le sirve al refugio para decidir.
     */
    motivacion: { min: 20, max: 500 },
  },

  /** Paso 2 de GUI-7.1.1: las respuestas sobre el hogar del solicitante. */
  hogar: {
    direccion: { min: 5, max: 150 },
    /** Solo se pide cuando respondió que sí tiene otras mascotas. */
    detalleMascotas: { max: 200 },
    descripcion: { max: 300 },
  },
  /**
   * Seguimiento post-adopción (spec 011). La HU-9.1 pide "descripción larga" sin fijar el
   * número; 1000 es el mismo techo que la descripción de historia clínica, que es el campo
   * largo más parecido del dominio.
   */
  seguimiento: {
    descripcion: { min: 1, max: 1000 },
  },

  /**
   * Mensaje de chat (HU-5.2). REQUISITOS.md no fija un largo máximo, así que 1000 es una
   * decisión de esta HU: alcanza de sobra para una conversación de coordinación y evita que
   * un solo mensaje reviente el preview del listado (HU-5.1) o la celda de la sala.
   *
   * `min: 0` a propósito: un mensaje puede ser SOLO foto. El service exige que venga texto
   * o imagen, pero esa es una regla del par de campos y no del largo de uno solo.
   */
  mensaje: {
    contenido: { min: 0, max: 1000 },
    /** Tamaño de página del historial y su techo. Ver "Paginación" en docs/api-chat-sala.md. */
    pagina: { porDefecto: 30, maximo: 50 },
  },
} as const;
