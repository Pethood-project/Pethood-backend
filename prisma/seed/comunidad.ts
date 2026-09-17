// Campañas y donaciones (dashboards), reseñas (valoración del perfil), reportes de
// moderación y reportes de animales perdidos.
import { enDias, foto, haceDias, haceMeses, id, log, prisma, type Catalogos } from './comun';
import type { Mascotas } from './mascotas';
import type { Actores } from './usuarios';

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
  /** Repartidas en varios meses para poblar donacionesPorMes. */
  donaciones: { usuario: Donante; monto: number; haceMeses: number }[];
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
    donaciones: [
      { usuario: 'ana', monto: 5000, haceMeses: 5 },
      { usuario: 'carla', monto: 8000, haceMeses: 3 },
      { usuario: 'lucia', monto: 15000, haceMeses: 2 },
      { usuario: 'martin', monto: 12000, haceMeses: 1 },
      { usuario: 'elena', monto: 6000, haceMeses: 0 },
      { usuario: 'ana', monto: 4000, haceMeses: 0 },
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
    donaciones: [
      { usuario: 'ana', monto: 10000, haceMeses: 1 },
      { usuario: 'elena', monto: 7000, haceMeses: 0 },
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
          refugioId: refugio.id,
          estadoCampaniaId: id(catalogos.estadosCampania, def.estado),
          usuarioAlta: operador.id,
          fechaAlta: haceMeses(def.inicioHaceMeses, 1),
        },
      });
      nuevas += 1;
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
  motivo: string;
  respuesta?: string;
  diasAtras: number;
}

const REPORTES: DefReporte[] = [
  { motivo: 'Publicación con fotos que no corresponden a la mascota', diasAtras: 1 },
  { motivo: 'Usuario con lenguaje ofensivo en el chat', diasAtras: 4 },
  { motivo: 'Refugio pide dinero por adelantado para la adopción', diasAtras: 9 },
  {
    motivo: 'Reseña falsa sobre Refugio Cuatro Patas',
    respuesta: 'Se verificó que la cuenta no tuvo contacto con el refugio. Reseña dada de baja.',
    diasAtras: 30,
  },
  {
    motivo: 'Mascota publicada dos veces por dos usuarios distintos',
    respuesta: 'Era la misma persona con dos cuentas. Se unificaron.',
    diasAtras: 60,
  },
];

async function seedReportes(actores: Actores) {
  let nuevos = 0;

  for (const def of REPORTES) {
    const existente = await prisma.reporteProblema.findFirst({ where: { motivo: def.motivo } });
    if (existente) continue;

    const resuelto = def.respuesta !== undefined;

    await prisma.reporteProblema.create({
      data: {
        motivo: def.motivo,
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
  reportante: 'ana' | 'carla' | 'elena';
  mascota?: string;
  descripcion: string;
  imagen: string;
  latitud: number;
  longitud: number;
  estado: 'Perdido' | 'Encontrado' | 'Resuelto';
  diasAtras: number;
}

const ANIMALES_PERDIDOS: DefAnimalPerdido[] = [
  {
    reportante: 'ana',
    mascota: 'thor',
    descripcion:
      'Thor, labrador dorado de 6 años, se escapó del patio en Godoy Cruz. Tiene collar azul ' +
      'con chapita. Es muy manso, se deja agarrar.',
    imagen: foto('photo-1552053831-71594a27632d'),
    latitud: -32.9264,
    longitud: -68.8447,
    estado: 'Perdido',
    diasAtras: 6,
  },
  {
    reportante: 'carla',
    descripcion:
      'Encontré un perro mestizo marrón, mediano, sin collar, en la plaza de Guaymallén. ' +
      'Está bien alimentado, seguro tiene dueño. Lo tengo en casa.',
    imagen: foto('photo-1568572933382-74d440642117'),
    latitud: -32.8947,
    longitud: -68.7972,
    estado: 'Encontrado',
    diasAtras: 2,
  },
  {
    reportante: 'elena',
    descripcion: 'Gata gris atigrada perdida en Las Heras. Ya apareció, gracias a todos.',
    imagen: foto('photo-1518791841217-8f162f1e1131'),
    latitud: -32.8503,
    longitud: -68.8262,
    estado: 'Resuelto',
    diasAtras: 25,
  },
];

async function seedAnimalesPerdidos(catalogos: Catalogos, actores: Actores, mascotas: Mascotas) {
  let nuevos = 0;

  for (const def of ANIMALES_PERDIDOS) {
    const reportante = actores[def.reportante];

    const existente = await prisma.animalPerdido.findFirst({
      where: { usuarioReportanteId: reportante.id, descripcion: def.descripcion },
    });
    if (existente) continue;

    await prisma.animalPerdido.create({
      data: {
        descripcion: def.descripcion,
        imagenUrl: def.imagen,
        latitud: def.latitud,
        longitud: def.longitud,
        fechaResuelto: def.estado === 'Resuelto' ? haceDias(def.diasAtras - 3) : null,
        usuarioReportanteId: reportante.id,
        mascotaId: def.mascota ? mascotas.get(def.mascota)!.mascota.id : null,
        estadoAnimalPerdidoId: id(catalogos.estadosAnimalPerdido, def.estado),
        usuarioAlta: reportante.id,
        fechaAlta: haceDias(def.diasAtras),
      },
    });
    nuevos += 1;
  }

  log(`🔍 Animales perdidos: ${ANIMALES_PERDIDOS.length} (${nuevos} nuevos)`);
}

export async function seedComunidad(catalogos: Catalogos, actores: Actores, mascotas: Mascotas) {
  await seedCampanias(catalogos, actores);
  await seedResenas(actores);
  await seedReportes(actores);
  await seedAnimalesPerdidos(catalogos, actores, mascotas);
}
