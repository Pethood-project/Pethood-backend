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

  /** Formulario de contacto público (spec 015, HU-15.2). */
  consultaSoporte: {
    nombreCompleto: { min: 2, max: 100 },
    email: { max: 100 },
    asunto: { min: 5, max: 100 },
    mensaje: { min: 10, max: 1000 },
  },

  /** Solo web-admin (spec 015, HU-15.3) — no hay contraparte en la app mobile, no se mirrorea. */
  faq: {
    pregunta: { min: 5, max: 200 },
    respuesta: { min: 5, max: 2000 },
    orden: { min: 1, max: 999 },
  },

  faqCategoria: {
    nombre: { min: 2, max: 50 },
    descripcion: { max: 200 },
  },

  fecha: { anioMinimo: 1900 },

  imagen: {
    tamanioMaximoBytes: 5 * 1024 * 1024,
    formatos: ['image/jpeg', 'image/png', 'image/webp'],
    /** Recorte (crop) mínimo aceptado antes de comprimir, para no guardar un recuadro casi vacío. */
    recorteMinimoPx: 10,
  },

  /**
   * Video adjunto de un mensaje de chat. Hoy es el ÚNICO lugar del proyecto que acepta
   * video: el resto de los módulos sigue siendo sólo imagen o pdf.
   *
   * **⚠️ EXCEPCIÓN EXPLÍCITA a los 5 MB de REQUISITOS.md §4.** Ese tope es la regla
   * transversal para imágenes y documentos, y **para video no alcanza**: un teléfono graba
   * 1080p a unos 13 Mbps, así que en 5 MB entran **3 segundos**. La duración útil que pidió
   * el equipo es 15 s, que a 1080p pesan ~25 MB; 30 MB deja margen sin habilitar un 4K de 15 s
   * (~84 MB), que se rechaza con un mensaje claro.
   *
   * Bajar el peso en vez de subir el tope **no es una opción disponible**: recomprimir en el
   * servidor necesita `ffmpeg` y hacerlo en el cliente necesita un módulo nativo de
   * transcodificación, que rompería las pruebas con Expo Go. `expo-image-picker` sólo deja
   * bajar la calidad de grabación en iOS, no en Android.
   *
   * **Las imágenes siguen con su tope de 5 MB**: este número es el techo de multer para el
   * request, y `validarTamanioAdjuntos` aplica el límite que corresponde a cada archivo.
   *
   * **`duracionMaximaSegundos` lo hace cumplir el CLIENTE, no el backend.** Medir la
   * duración en el servidor necesita `ffmpeg`. El backend hace cumplir lo que sí puede
   * verificar barato: formato y peso.
   *
   * Los tres formatos son los que producen los clientes reales: Android graba `mp4`, iOS
   * graba `mov` (`video/quicktime`) y el navegador suele dar `webm`.
   */
  video: {
    tamanioMaximoBytes: 30 * 1024 * 1024,
    duracionMaximaSegundos: 15,
    formatos: ['video/mp4', 'video/quicktime', 'video/webm'],
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
    /**
     * Cuántas fotos admite un mensaje. El artboard 37 muestra una grilla de dos miniaturas
     * con un "+3" encima de la segunda, o sea cinco: ese es el tope.
     */
    fotos: { maximo: 5 },
    /**
     * Cuántos videos admite un mensaje, y con qué puede convivir.
     *
     * Uno solo y sin mezclar con fotos: la grilla del artboard 37 tiene disposiciones
     * distintas para 1, 2, 3 y 4+ miniaturas, y meter un video en el medio obliga a
     * resolver el visor, la miniatura y la validación de un caso que ninguna HU pidió.
     * El día que haga falta, se levanta acá.
     */
    videos: { maximo: 1, mezclaConFotos: false },
    /** Tamaño de página del historial y su techo. Ver "Paginación" en docs/api-chat-sala.md. */
    pagina: { porDefecto: 30, maximo: 50 },
  },
} as const;
