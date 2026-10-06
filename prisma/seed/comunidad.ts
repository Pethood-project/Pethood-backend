// Campañas y donaciones (dashboards), reseñas (valoración del perfil), reportes de
// moderación y reportes de animales perdidos.
import type { TipoReporte } from '@prisma/client';
import {
  enDias,
  foto,
  FOTOS_GATO,
  FOTOS_PERRO,
  haceDias,
  haceMeses,
  id,
  log,
  prisma,
  type Catalogos,
} from './comun';
import type { Mascotas } from './mascotas';
import type { Actores } from './usuarios';

/** MENSAJE no está: no tiene baja lógica y el seed no reporta mensajes. */
type TipoReporteSeed = Exclude<TipoReporte, 'MENSAJE'>;

type Donante = 'ana' | 'carla' | 'martin' | 'elena' | 'lucia';

interface DefCampania {
  titulo: string;
  descripcion: string;
  refugio: 'patitas' | 'huellitas';
  estado: 'Activa' | 'Finalizada' | 'Cancelada' | 'Inactiva';
  objetivo: number;
  inicioHaceMeses: number;
  finEnDias: number;
  imagen?: string;
  /** Datos para transferir (spec 021). */
  alias?: string;
  cbu?: string;
  /** Repartidas en varios meses para poblar donacionesPorMes. Sin estado → Realizada. */
  donaciones: {
    usuario: Donante;
    monto: number;
    haceMeses: number;
    estado?: 'Pendiente' | 'Realizada' | 'Cancelada';
    motivo?: 'NO_RECIBIDA' | 'MONTO_NO_COINCIDE';
  }[];
}

const CAMPANIAS: DefCampania[] = [
  {
    titulo: 'Castraciones de primavera',
    descripcion:
      'Queremos castrar 80 animales del barrio antes de que arranque la temporada de celo. ' +
      'Cada castración cuesta $3.000 con la veterinaria amiga del refugio.',
    refugio: 'patitas',
    estado: 'Activa',
    objetivo: 250000,
    inicioHaceMeses: 5,
    finEnDias: 60,
    imagen: foto('photo-1548199973-03cce0bbc87b'),
    alias: 'patitas.castra.mp',
    cbu: '0000003100012345678901',
    donaciones: [
      { usuario: 'ana', monto: 5000, haceMeses: 5 },
      { usuario: 'carla', monto: 8000, haceMeses: 3 },
      { usuario: 'lucia', monto: 15000, haceMeses: 2 },
      { usuario: 'martin', monto: 12000, haceMeses: 1 },
      { usuario: 'elena', monto: 6000, haceMeses: 0 },
      { usuario: 'ana', monto: 4000, haceMeses: 0 },
      { usuario: 'carla', monto: 3500, haceMeses: 0, estado: 'Pendiente' },
      { usuario: 'lucia', monto: 2500, haceMeses: 0, estado: 'Pendiente' },
      {
        usuario: 'martin',
        monto: 20000,
        haceMeses: 1,
        estado: 'Cancelada',
        motivo: 'MONTO_NO_COINCIDE',
      },
    ],
  },
  {
    titulo: 'Techo nuevo para los caniles',
    descripcion:
      'Las chapas de los caniles del fondo se volaron con el Zonda. Necesitamos reponerlas ' +
      'antes del invierno.',
    refugio: 'patitas',
    estado: 'Finalizada',
    objetivo: 400000,
    inicioHaceMeses: 10,
    finEnDias: -120,
    imagen: foto('photo-1587300003388-59208cc962cb'),
    alias: 'patitas.techo.mp',
    donaciones: [
      { usuario: 'ana', monto: 80000, haceMeses: 6 },
      { usuario: 'martin', monto: 120000, haceMeses: 5 },
      { usuario: 'carla', monto: 50000, haceMeses: 5 },
    ],
  },
  {
    titulo: 'Rifa solidaria de fin de año',
    descripcion:
      'Rifa con premios donados por comercios de la zona. Se suspendió por falta de premios.',
    refugio: 'patitas',
    estado: 'Cancelada',
    objetivo: 90000,
    inicioHaceMeses: 8,
    finEnDias: -200,
    alias: 'patitas.rifa.mp',
    donaciones: [],
  },
  {
    titulo: 'Alimento para el invierno',
    descripcion:
      'Bolsas de alimento balanceado para los 40 perros del refugio durante junio y julio.',
    refugio: 'huellitas',
    estado: 'Activa',
    objetivo: 120000,
    inicioHaceMeses: 2,
    finEnDias: 30,
    cbu: '2850590940090418135201',
    donaciones: [
      { usuario: 'ana', monto: 10000, haceMeses: 1 },
      { usuario: 'elena', monto: 7000, haceMeses: 0 },
      { usuario: 'martin', monto: 5000, haceMeses: 0, estado: 'Pendiente' },
    ],
  },
];

async function seedCampanias(catalogos: Catalogos, actores: Actores) {
  let nuevas = 0;

  for (const def of CAMPANIAS) {
    const refugio = actores[def.refugio];
    // Quien la carga es el operador del refugio.
    const operador = def.refugio === 'patitas' ? actores.bruno : actores.nico;

    let campania = await prisma.campania.findFirst({
      where: { titulo: def.titulo, refugioId: refugio.id, fechaBaja: null },
    });

    if (!campania) {
      campania = await prisma.campania.create({
        data: {
          titulo: def.titulo,
          descripcion: def.descripcion,
          objetivo: def.objetivo,
          fechaInicio: haceMeses(def.inicioHaceMeses, 1),
          fechaFin: enDias(def.finEnDias),
          imagenUrl: def.imagen ?? null,
          alias: def.alias ?? null,
          cbu: def.cbu ?? null,
          refugioId: refugio.id,
          estadoCampaniaId: id(catalogos.estadosCampania, def.estado),
          usuarioAlta: operador.id,
          fechaAlta: haceMeses(def.inicioHaceMeses, 1),
        },
      });
      nuevas += 1;
    }

    // Campañas sembradas antes de la spec 021: sin datos para transferir no se puede donar.
    if (campania.alias === null && campania.cbu === null && (def.alias || def.cbu)) {
      campania = await prisma.campania.update({
        where: { id: campania.id },
        data: { alias: def.alias ?? null, cbu: def.cbu ?? null },
      });
    }

    for (const donacion of def.donaciones) {
      const donante = actores[donacion.usuario];
      const existente = await prisma.donacion.findFirst({
        where: { campaniaId: campania.id, usuarioId: donante.id, monto: donacion.monto },
      });
      if (existente) continue;

      await prisma.donacion.create({
        data: {
          monto: donacion.monto,
          campaniaId: campania.id,
          usuarioId: donante.id,
          estadoDonacionId: id(catalogos.estadosDonacion, donacion.estado ?? 'Realizada'),
          motivoRechazo: donacion.motivo ?? null,
          usuarioAlta: donante.id,
          fechaAlta: haceMeses(donacion.haceMeses),
        },
      });
    }
  }

  const donaciones = CAMPANIAS.reduce((n, c) => n + c.donaciones.length, 0);
  log(`💰 Campañas: ${CAMPANIAS.length} (${nuevas} nuevas), ${donaciones} donaciones`);
}

interface DefResena {
  autor: keyof Actores;
  usuario?: 'ana' | 'carla' | 'martin';
  refugio?: 'patitas' | 'huellitas';
  puntuacion: number;
  comentario: string;
  diasAtras: number;
}

const RESENAS: DefResena[] = [
  {
    autor: 'bruno',
    usuario: 'ana',
    puntuacion: 5,
    comentario: 'Adoptó a Estrella hace dos años y sigue mandando fotos. Una adoptante ejemplar.',
    diasAtras: 800,
  },
  {
    autor: 'bruno',
    usuario: 'ana',
    puntuacion: 5,
    comentario: 'Con Bimba cumplió todos los seguimientos a tiempo.',
    diasAtras: 40,
  },
  {
    autor: 'nico',
    usuario: 'ana',
    puntuacion: 4,
    comentario: 'Muy comprometida, vino a conocer a Greta antes de solicitar.',
    diasAtras: 2,
  },
  {
    autor: 'bruno',
    usuario: 'carla',
    puntuacion: 5,
    comentario: 'Donó para el techo de los caniles y ayudó a colocarlo.',
    diasAtras: 140,
  },
  {
    autor: 'ana',
    refugio: 'patitas',
    puntuacion: 5,
    comentario: 'Transparentes y muy atentos. Responden el chat enseguida.',
    diasAtras: 90,
  },
  {
    autor: 'carla',
    refugio: 'patitas',
    puntuacion: 4,
    comentario: 'Buena atención, aunque la visita se demoró un poco.',
    diasAtras: 20,
  },
  {
    autor: 'martin',
    refugio: 'huellitas',
    puntuacion: 3,
    comentario: 'Tardaron una semana en responder la solicitud.',
    diasAtras: 50,
  },
];

async function seedResenas(actores: Actores) {
  let nuevas = 0;

  for (const def of RESENAS) {
    const autor = actores[def.autor];
    const usuarioReportadoId = def.usuario ? actores[def.usuario].id : null;
    const refugioReportadoId = def.refugio ? actores[def.refugio].id : null;

    const existente = await prisma.resena.findFirst({
      where: {
        usuarioAutorId: autor.id,
        usuarioReportadoId,
        refugioReportadoId,
        comentario: def.comentario,
      },
    });
    if (existente) continue;

    await prisma.resena.create({
      data: {
        puntuacion: def.puntuacion,
        comentario: def.comentario,
        usuarioAutorId: autor.id,
        usuarioReportadoId,
        refugioReportadoId,
        usuarioAlta: autor.id,
        fechaAlta: haceDias(def.diasAtras),
      },
    });
    nuevas += 1;
  }

  log(`⭐ Reseñas: ${RESENAS.length} (${nuevas} nuevas)`);
}

interface DefReporte {
  tipo: TipoReporteSeed;
  /** Posición (0-based) del objeto entre los activos de su tipo, ordenados por id. */
  objeto: number;
  motivo: string;
  respuesta?: string;
  diasAtras: number;
}

const REPORTES: DefReporte[] = [
  {
    tipo: 'PUBLICACION',
    objeto: 0,
    motivo: 'Publicación con fotos que no corresponden a la mascota',
    diasAtras: 1,
  },
  { tipo: 'USUARIO', objeto: 5, motivo: 'Usuario con lenguaje ofensivo en el chat', diasAtras: 4 },
  {
    tipo: 'REFUGIO',
    objeto: 0,
    motivo: 'Refugio pide dinero por adelantado para la adopción',
    diasAtras: 9,
  },
  {
    tipo: 'RESENA',
    objeto: 0,
    motivo: 'Reseña falsa sobre Refugio Cuatro Patas',
    respuesta: 'Se verificó que la cuenta no tuvo contacto con el refugio. Reseña dada de baja.',
    diasAtras: 30,
  },
  {
    tipo: 'PUBLICACION',
    objeto: 1,
    motivo: 'Mascota publicada dos veces por dos usuarios distintos',
    respuesta: 'Era la misma persona con dos cuentas. Se unificaron.',
    diasAtras: 60,
  },
];

/** Id del n-ésimo objeto activo del tipo, para que el seed apunte a filas que existen. */
async function idObjetoReportado(tipo: TipoReporteSeed, posicion: number): Promise<number | null> {
  const opciones = {
    where: { fechaBaja: null },
    orderBy: { id: 'asc' },
    skip: posicion,
    select: { id: true },
  } as const;
  const fila = await {
    PUBLICACION: () => prisma.publicacion.findFirst(opciones),
    USUARIO: () => prisma.usuario.findFirst(opciones),
    REFUGIO: () => prisma.refugio.findFirst(opciones),
    RESENA: () => prisma.resena.findFirst(opciones),
    ANIMAL_PERDIDO: () => prisma.animalPerdido.findFirst(opciones),
    CAMPANIA: () => prisma.campania.findFirst(opciones),
  }[tipo]();
  return fila?.id ?? null;
}

async function seedReportes(actores: Actores) {
  let nuevos = 0;

  for (const def of REPORTES) {
    const existente = await prisma.reporteProblema.findFirst({ where: { motivo: def.motivo } });
    if (existente) continue;

    const objetoId = await idObjetoReportado(def.tipo, def.objeto);
    if (objetoId === null) continue;

    const resuelto = def.respuesta !== undefined;

    await prisma.reporteProblema.create({
      data: {
        motivo: def.motivo,
        tipo: def.tipo,
        objetoId,
        resuelto,
        respuesta: def.respuesta ?? null,
        usuarioAlta: actores.carla.id,
        fechaAlta: haceDias(def.diasAtras),
        ...(resuelto
          ? {
              usuarioModificacion: actores.admin.id,
              fechaModificacion: haceDias(def.diasAtras - 1),
            }
          : {}),
      },
    });
    nuevos += 1;
  }

  log(`🚩 Reportes de moderación: ${REPORTES.length} (${nuevos} nuevos)`);
}

interface DefAnimalPerdido {
  reportante: 'ana' | 'bruno' | 'carla' | 'elena' | 'lucia' | 'martin' | 'nico' | 'sofia';
  mascota?: string;
  /** Obligatorio en un aviso "Perdido"; en uno "Encontrado" puede faltar (HU-13.1). */
  nombre?: string;
  especie: 'Perro' | 'Gato';
  /** Del catálogo de georef, como la dirección del perfil (spec 020). Por defecto, Mendoza. */
  provincia?: string;
  /** Tiene que existir en el catálogo de esa provincia (`constants/Provincias.ts` del front). */
  localidad: string;
  /** El aclaratorio libre y opcional del lugar. */
  referencia?: string;
  descripcion: string;
  /** De 1 a 5, en el orden de la galería: la primera es la portada. */
  imagenes: string[];
  latitud: number;
  longitud: number;
  estado: 'Perdido' | 'Encontrado' | 'Resuelto';
  diasAtras: number;
}

/** Coordenadas aproximadas de cada departamento del Gran Mendoza. */
const COORDENADAS = {
  godoyCruz: { latitud: -32.9264, longitud: -68.8447 },
  guaymallen: { latitud: -32.8947, longitud: -68.7972 },
  lasHeras: { latitud: -32.8503, longitud: -68.8262 },
  maipu: { latitud: -32.9833, longitud: -68.7833 },
  capital: { latitud: -32.8895, longitud: -68.8458 },
  lujan: { latitud: -33.0333, longitud: -68.8833 },
  sanJuan: { latitud: -31.5375, longitud: -68.5364 },
};

/**
 * Avisos del portal de perdidos (GUI-06). Variados a propósito en estado, especie, provincia,
 * localidad, reportante y antigüedad, para poder probar el orden, el cursor y cada filtro de
 * verdad (el de San Juan está para probar el filtro por provincia y la cercanía: queda a unos
 * 150 km del Gran Mendoza).
 *
 * El seed no puede llamar al geocoder (no hay red garantizada), así que el lugar geocodificado
 * se siembra con las mismas coordenadas aproximadas del departamento.
 */
const ANIMALES_PERDIDOS: DefAnimalPerdido[] = [
  {
    reportante: 'ana',
    mascota: 'thor',
    nombre: 'Thor',
    especie: 'Perro',
    localidad: 'Godoy Cruz',
    referencia: 'A dos cuadras de la plaza departamental',
    descripcion:
      'Thor, labrador dorado de 6 años, se escapó del patio en Godoy Cruz. Tiene collar azul ' +
      'con chapita. Es muy manso, se deja agarrar.',
    // Varias fotos, para probar la galería del detalle.
    imagenes: [foto('photo-1552053831-71594a27632d'), foto(FOTOS_PERRO[1]!), foto(FOTOS_PERRO[5]!)],
    ...COORDENADAS.godoyCruz,
    estado: 'Perdido',
    diasAtras: 6,
  },
  {
    reportante: 'carla',
    especie: 'Perro',
    localidad: 'Guaymallén',
    referencia: 'Plaza departamental',
    descripcion:
      'Encontré un perro mestizo marrón, mediano, sin collar, en la plaza de Guaymallén. ' +
      'Está bien alimentado, seguro tiene dueño. Lo tengo en casa.',
    imagenes: [foto('photo-1568572933382-74d440642117')],
    ...COORDENADAS.guaymallen,
    estado: 'Encontrado',
    diasAtras: 2,
  },
  {
    reportante: 'elena',
    nombre: 'Luna',
    especie: 'Gato',
    localidad: 'Las Heras',
    descripcion: 'Gata gris atigrada perdida en Las Heras. Ya apareció, gracias a todos.',
    imagenes: [foto('photo-1518791841217-8f162f1e1131')],
    ...COORDENADAS.lasHeras,
    estado: 'Resuelto',
    diasAtras: 25,
  },
  {
    reportante: 'martin',
    nombre: 'Rocco',
    especie: 'Perro',
    localidad: 'Maipú',
    descripcion:
      'Rocco, beagle tricolor de 3 años. Se asustó con la pirotecnia y saltó el paredón. ' +
      'Responde a su nombre y le encanta la pelota.',
    imagenes: [foto(FOTOS_PERRO[2]!)],
    ...COORDENADAS.maipu,
    estado: 'Perdido',
    diasAtras: 1,
  },
  {
    reportante: 'lucia',
    nombre: 'Michi',
    especie: 'Gato',
    localidad: 'Mendoza',
    referencia: 'Calle Belgrano',
    descripcion:
      'Gato naranja castrado de 4 años, con collar rojo y cascabel. Nunca sale a la calle, ' +
      'debe estar escondido y asustado cerca de calle Belgrano.',
    imagenes: [foto(FOTOS_GATO[0]!), foto(FOTOS_GATO[2]!)],
    ...COORDENADAS.capital,
    estado: 'Perdido',
    diasAtras: 3,
  },
  {
    reportante: 'sofia',
    especie: 'Gato',
    localidad: 'Chacras de Coria',
    referencia: 'Entrada de Chacras',
    descripcion:
      'Encontré una gatita tricolor muy chiquita, de unos 2 meses, en la entrada de Chacras. ' +
      'La tengo en casa con comida y abrigo.',
    imagenes: [foto(FOTOS_GATO[3]!)],
    ...COORDENADAS.lujan,
    estado: 'Encontrado',
    diasAtras: 0,
  },
  {
    reportante: 'nico',
    // El nombre sale de la chapita: un aviso "Encontrado" también puede tenerlo.
    nombre: 'Rocky',
    especie: 'Perro',
    localidad: 'Maipú',
    referencia: 'Ruta 60',
    descripcion:
      'Perro grande negro con una chapita que dice Rocky, sin teléfono. Andaba solo por la ' +
      'ruta 60. Lo tengo en el patio de casa.',
    imagenes: [foto(FOTOS_PERRO[4]!)],
    ...COORDENADAS.maipu,
    estado: 'Encontrado',
    diasAtras: 4,
  },
  {
    // Un miembro de refugio también puede publicar: el aviso es de la persona.
    reportante: 'bruno',
    especie: 'Perro',
    localidad: 'Las Heras',
    referencia: 'Frente al refugio Patitas',
    descripcion:
      'Perrita mestiza blanca con manchas marrones, muy dócil, apareció en la puerta del ' +
      'refugio. Está sana y la estamos cuidando hasta encontrar a su familia.',
    imagenes: [foto(FOTOS_PERRO[6]!)],
    ...COORDENADAS.lasHeras,
    estado: 'Encontrado',
    diasAtras: 9,
  },
  {
    reportante: 'carla',
    nombre: 'Pancho',
    especie: 'Perro',
    localidad: 'Godoy Cruz',
    referencia: 'Barrio Bombal',
    descripcion:
      'Caniche toy blanco de 10 años, un poco sordo. Se perdió en el barrio Bombal. Necesita ' +
      'su medicación para el corazón, cualquier dato sirve.',
    imagenes: [foto(FOTOS_PERRO[8]!)],
    ...COORDENADAS.godoyCruz,
    estado: 'Perdido',
    diasAtras: 12,
  },
  {
    reportante: 'ana',
    nombre: 'Nina',
    especie: 'Gato',
    localidad: 'Guaymallén',
    descripcion:
      'Gata negra de ojos verdes, se escapó por la ventana. ¡Ya volvió a casa, gracias por compartir!',
    imagenes: [foto(FOTOS_GATO[1]!)],
    ...COORDENADAS.guaymallen,
    estado: 'Resuelto',
    diasAtras: 35,
  },
  {
    reportante: 'elena',
    nombre: 'Toby',
    especie: 'Perro',
    localidad: 'Vistalba',
    descripcion:
      'Toby es un mestizo marrón de pelo corto, 5 años, con la oreja izquierda caída. Se ' +
      'perdió en Vistalba el domingo a la tarde.',
    imagenes: [foto(FOTOS_PERRO[9]!)],
    ...COORDENADAS.lujan,
    estado: 'Perdido',
    diasAtras: 18,
  },
  {
    reportante: 'martin',
    especie: 'Gato',
    localidad: 'Mendoza',
    referencia: 'Quinta Sección',
    descripcion:
      'Gato gris y blanco adulto, muy cariñoso, entró a mi departamento en la Quinta Sección. ' +
      'Parece que tiene dueño porque está castrado.',
    imagenes: [foto(FOTOS_GATO[4]!)],
    ...COORDENADAS.capital,
    estado: 'Encontrado',
    diasAtras: 22,
  },
  {
    reportante: 'lucia',
    especie: 'Perro',
    localidad: 'Coquimbito',
    descripcion: 'Encontramos un cachorro marrón en Coquimbito y ya apareció su familia. ¡Gracias!',
    imagenes: [foto(FOTOS_PERRO[3]!)],
    ...COORDENADAS.maipu,
    estado: 'Resuelto',
    diasAtras: 40,
  },
  {
    // Fuera de Mendoza, para el filtro por provincia y el de cercanía.
    reportante: 'sofia',
    nombre: 'Coco',
    especie: 'Perro',
    provincia: 'San Juan',
    localidad: 'Rivadavia',
    referencia: 'Cerca del parque de Mayo',
    descripcion:
      'Coco es un salchicha negro y fuego de 8 años. Se asustó con una tormenta mientras ' +
      'estábamos de visita en San Juan y salió corriendo.',
    imagenes: [foto(FOTOS_PERRO[7]!)],
    ...COORDENADAS.sanJuan,
    estado: 'Perdido',
    diasAtras: 5,
  },
];

/**
 * Día en que se perdió o se encontró: el anterior a la publicación, como pasa casi siempre.
 * Sólo el día, a medianoche local, igual que una fecha elegida en el formulario.
 */
function fechaSucesoDe(def: DefAnimalPerdido): Date {
  const fecha = haceDias(def.diasAtras + 1);
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

/**
 * El lugar del aviso. El "geocodificado" son las coordenadas aproximadas del departamento: el
 * seed no llama al geocoder.
 */
function lugarDe(def: DefAnimalPerdido) {
  return {
    provincia: def.provincia ?? 'Mendoza',
    localidad: def.localidad,
    referencia: def.referencia ?? null,
    lugarLatitud: def.latitud,
    lugarLongitud: def.longitud,
  };
}

async function seedAnimalesPerdidos(catalogos: Catalogos, actores: Actores, mascotas: Mascotas) {
  const especies = new Map(
    (await prisma.especie.findMany({ select: { id: true, nombre: true } })).map((especie) => [
      especie.nombre,
      especie.id,
    ]),
  );

  let nuevos = 0;
  let completados = 0;

  for (const def of ANIMALES_PERDIDOS) {
    const reportante = actores[def.reportante];
    const especieId = id(especies, def.especie);

    const existente = await prisma.animalPerdido.findFirst({
      where: { usuarioReportanteId: reportante.id, descripcion: def.descripcion },
      select: {
        id: true,
        nombre: true,
        provincia: true,
        especieId: true,
        fechaSuceso: true,
        imagenes: true,
      },
    });

    if (existente) {
      // Los avisos sembrados antes no tienen nombre, lugar estructurado, especie, fecha del
      // suceso o galería (según de qué versión vengan): se completan sin pisar lo que ya tenga
      // valor. El lugar se completa entero cuando falta la provincia: la migración que sacó el
      // texto libre sólo pudo conservar la localidad, y no siempre coincide con el catálogo.
      const faltanFotos = existente.imagenes.length < def.imagenes.length;
      const faltaLugar = existente.provincia === null;

      if (
        faltaLugar ||
        existente.especieId === null ||
        existente.fechaSuceso === null ||
        faltanFotos
      ) {
        await prisma.animalPerdido.update({
          where: { id: existente.id },
          data: {
            nombre: existente.nombre ?? def.nombre ?? null,
            ...(faltaLugar ? lugarDe(def) : {}),
            especieId: existente.especieId ?? especieId,
            fechaSuceso: existente.fechaSuceso ?? fechaSucesoDe(def),
            ...(faltanFotos ? { imagenes: def.imagenes, imagenUrl: def.imagenes[0]! } : {}),
          },
        });
        completados += 1;
      }
      continue;
    }

    await prisma.animalPerdido.create({
      data: {
        nombre: def.nombre ?? null,
        descripcion: def.descripcion,
        imagenUrl: def.imagenes[0]!,
        imagenes: def.imagenes,
        ...lugarDe(def),
        fechaSuceso: fechaSucesoDe(def),
        latitud: def.latitud,
        longitud: def.longitud,
        fechaResuelto: def.estado === 'Resuelto' ? haceDias(def.diasAtras - 3) : null,
        usuarioReportanteId: reportante.id,
        mascotaId: def.mascota ? mascotas.get(def.mascota)!.mascota.id : null,
        especieId,
        estadoAnimalPerdidoId: id(catalogos.estadosAnimalPerdido, def.estado),
        usuarioAlta: reportante.id,
        fechaAlta: haceDias(def.diasAtras),
      },
    });
    nuevos += 1;
  }

  log(
    `🔍 Animales perdidos: ${ANIMALES_PERDIDOS.length} (${nuevos} nuevos, ${completados} completados)`,
  );
}

export async function seedComunidad(catalogos: Catalogos, actores: Actores, mascotas: Mascotas) {
  await seedCampanias(catalogos, actores);
  await seedResenas(actores);
  await seedReportes(actores);
  await seedAnimalesPerdidos(catalogos, actores, mascotas);
}
