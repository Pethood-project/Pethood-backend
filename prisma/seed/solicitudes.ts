// Hogares, solicitudes de adopción/tránsito y seguimiento post-adopción.
//
// Cubre los cinco Estado_Solicitud, los dos tipos, el versionado de hogar (HU-7.1), una
// pendiente vencida para el cron de HU-7.6 y adopciones aprobadas en distintos tramos de la
// secuencia de seguimiento (HU-9.x): recién aprobada, con pedidos vencidos, a mitad de camino
// y con la secuencia agotada.
import type { Hogar } from '@prisma/client';
import {
  pedidosExigiblesA,
  plazoDeRespuesta,
  type TipoFlujo,
} from '../../src/modules/seguimiento/seguimiento.secuencia';
import {
  enDias,
  foto,
  FOTOS_GATO,
  FOTOS_PERRO,
  haceDias,
  HORA,
  id,
  log,
  prisma,
  type Catalogos,
} from './comun';
import type { Mascotas } from './mascotas';
import type { Actores } from './usuarios';

type Solicitante = 'ana' | 'carla' | 'martin' | 'elena' | 'lucia';

// ─────────────── Hogares ───────────────

interface DefHogar {
  clave: string;
  usuario: Solicitante;
  direccion: string;
  tipoVivienda: 'Casa' | 'Departamento' | 'Otro';
  espacioExterior: 'Balcon' | 'Patio' | 'Jardin' | 'Ninguno';
  tieneNinios: boolean;
  tieneMascotas: boolean;
  detalleMascotas?: string;
  experienciaPrevia: boolean;
  horasSolo: 4 | 8 | 12;
  descripcion?: string;
  diasAtras: number;
  /** Versión reemplazada: el usuario se mudó o corrigió sus respuestas después. */
  bajaHaceDias?: number;
}

const HOGARES: DefHogar[] = [
  {
    clave: 'anaAnterior',
    usuario: 'ana',
    direccion: 'Tiburcio Benegas 850, 3° B, Godoy Cruz',
    tipoVivienda: 'Departamento',
    espacioExterior: 'Balcon',
    tieneNinios: false,
    tieneMascotas: true,
    detalleMascotas: 'Olivia, gata castrada de 4 años',
    experienciaPrevia: true,
    horasSolo: 8,
    descripcion: 'Departamento luminoso, balcón con red.',
    diasAtras: 16,
    bajaHaceDias: 5,
  },
  {
    clave: 'ana',
    usuario: 'ana',
    direccion: 'Perito Moreno 1420, Godoy Cruz',
    tipoVivienda: 'Casa',
    espacioExterior: 'Jardin',
    tieneNinios: false,
    tieneMascotas: true,
    detalleMascotas: 'Olivia (gata) y Thor (labrador), ambos castrados',
    experienciaPrevia: true,
    horasSolo: 8,
    descripcion: 'Casa con jardín cercado. Trabajo medio día desde casa.',
    diasAtras: 5,
  },
  {
    clave: 'carla',
    usuario: 'carla',
    direccion: 'Bandera de los Andes 2300, Guaymallén',
    tipoVivienda: 'Casa',
    espacioExterior: 'Patio',
    tieneNinios: true,
    tieneMascotas: true,
    detalleMascotas: 'Canela, perrita mestiza chica',
    experienciaPrevia: true,
    horasSolo: 4,
    diasAtras: 30,
  },
  {
    clave: 'martin',
    usuario: 'martin',
    direccion: 'Roque Sáenz Peña 480, 5° A, Luján de Cuyo',
    tipoVivienda: 'Departamento',
    espacioExterior: 'Ninguno',
    tieneNinios: false,
    tieneMascotas: false,
    experienciaPrevia: true,
    horasSolo: 8,
    descripcion: 'Departamento chico pero con plaza a una cuadra.',
    diasAtras: 4,
  },
  {
    clave: 'elena',
    usuario: 'elena',
    direccion: 'Independencia 1200, Las Heras',
    tipoVivienda: 'Casa',
    espacioExterior: 'Jardin',
    tieneNinios: true,
    tieneMascotas: false,
    experienciaPrevia: false,
    horasSolo: 12,
    diasAtras: 95,
  },
  {
    clave: 'lucia',
    usuario: 'lucia',
    direccion: 'Ozamis 300, 2° C, Maipú',
    tipoVivienda: 'Departamento',
    espacioExterior: 'Balcon',
    tieneNinios: false,
    tieneMascotas: false,
    experienciaPrevia: false,
    horasSolo: 8,
    diasAtras: 120,
  },
];

async function seedHogares(actores: Actores): Promise<Map<string, Hogar>> {
  const hogares = new Map<string, Hogar>();

  for (const def of HOGARES) {
    const usuario = actores[def.usuario];

    let hogar = await prisma.hogar.findFirst({
      where: { usuarioId: usuario.id, direccion: def.direccion },
    });

    if (!hogar) {
      hogar = await prisma.hogar.create({
        data: {
          usuarioId: usuario.id,
          direccion: def.direccion,
          tipoVivienda: def.tipoVivienda,
          espacioExterior: def.espacioExterior,
          tienePatio: def.espacioExterior === 'Patio' || def.espacioExterior === 'Jardin',
          tieneNinios: def.tieneNinios,
          tieneMascotas: def.tieneMascotas,
          detalleMascotas: def.detalleMascotas ?? null,
          experienciaPrevia: def.experienciaPrevia,
          horasSolo: def.horasSolo,
          descripcion: def.descripcion ?? null,
          usuarioAlta: usuario.id,
          fechaAlta: haceDias(def.diasAtras),
          ...(def.bajaHaceDias === undefined
            ? {}
            : { usuarioBaja: usuario.id, fechaBaja: haceDias(def.bajaHaceDias) }),
        },
      });
    }

    hogares.set(def.clave, hogar);
  }

  return hogares;
}

// ─────────────── Solicitudes ───────────────

interface DefSolicitud {
  mascota: string;
  solicitante: Solicitante;
  /** null = solicitud anterior a HU-7.1, sin hogar declarado. */
  hogar: string | null;
  tipo: TipoFlujo;
  motivacion: string;
  /** Histórico de estados, del más viejo al vigente: [estado, hace cuántos días]. */
  historial: [string, number][];
  /** Respuesta del refugio al aceptar/rechazar (HU-7.4). */
  comentario?: string;
  transito?: { duracionDias: number };
  /** Índices (0-based) de los pedidos de seguimiento ya exigibles que el adoptante NO respondió. */
  seguimientoSinResponder?: number[];
}

const SOLICITUDES: DefSolicitud[] = [
  // ── Ana (adoptante principal): una en cada estado ──
  {
    mascota: 'max',
    solicitante: 'ana',
    hogar: 'ana',
    tipo: 'Adopcion',
    motivacion:
      'Tenemos jardín cercado y un labrador que necesita compañía. Max sería el segundo perro ' +
      'de la casa y ya conversamos con la veterinaria sobre la adaptación.',
    historial: [['Pendiente', 2]],
  },
  {
    mascota: 'luna',
    solicitante: 'ana',
    hogar: 'ana',
    tipo: 'Adopcion',
    motivacion:
      'Busco una perrita chica que se lleve bien con mi gata. Luna parece ideal por el tamaño ' +
      'y el temperamento que describen.',
    historial: [
      ['Pendiente', 6],
      ['En_Revision', 5],
    ],
  },
  {
    mascota: 'rocky',
    solicitante: 'ana',
    hogar: 'anaAnterior',
    tipo: 'Adopcion',
    motivacion:
      'Me conmovió la historia de Rocky. Trabajo desde casa medio día y puedo acompañar la ' +
      'recuperación con los controles que hagan falta.',
    historial: [
      ['Pendiente', 15],
      ['Rechazada', 14],
    ],
    comentario:
      'Gracias Ana. Por ahora Rocky necesita una casa sin escaleras y en planta baja hasta que ' +
      'termine la fisioterapia; el departamento en un 3° no es compatible. Cuando esté de alta te avisamos.',
  },
  {
    mascota: 'mia',
    solicitante: 'ana',
    hogar: 'ana',
    tipo: 'Adopcion',
    motivacion:
      'Quiero una compañera para Olivia. Mia es tranquila y de interior, y ya tengo experiencia ' +
      'con gatos de pelo largo.',
    historial: [
      ['Pendiente', 5],
      ['Aprobada', 3],
    ],
    comentario: '¡Bienvenida Mia a su nueva familia! Cualquier duda nos escribís por el chat.',
    seguimientoSinResponder: [0],
  },
  {
    mascota: 'toby',
    solicitante: 'ana',
    hogar: 'ana',
    tipo: 'Transito',
    motivacion:
      'Puedo ofrecer tránsito por dos meses mientras Toby termina el tratamiento de piel. ' +
      'Tengo experiencia dando baños medicados.',
    historial: [
      ['Pendiente', 12],
      ['Aprobada', 10],
    ],
    comentario: 'Aprobado. Te pasamos el protocolo de baños por el chat.',
    transito: { duracionDias: 60 },
    seguimientoSinResponder: [2],
  },
  {
    mascota: 'bimba',
    solicitante: 'ana',
    hogar: null,
    tipo: 'Adopcion',
    motivacion:
      'Bimba fue la primera que vi en el refugio y volví tres veces a visitarla. Estamos listos ' +
      'para sumarla a la familia.',
    historial: [
      ['Pendiente', 103],
      ['Aprobada', 100],
    ],
    comentario: 'Aprobada. ¡Que sean muy felices!',
    seguimientoSinResponder: [8],
  },
  {
    mascota: 'estrella',
    solicitante: 'ana',
    hogar: null,
    tipo: 'Adopcion',
    motivacion:
      'Siempre quise una siamesa. Vivo sola, trabajo desde casa y tengo el departamento ' +
      'preparado con red en el balcón.',
    historial: [
      ['Pendiente', 905],
      ['Aprobada', 900],
    ],
    comentario: 'Aprobada.',
    seguimientoSinResponder: [5, 11],
  },
  {
    mascota: 'greta',
    solicitante: 'ana',
    hogar: 'ana',
    tipo: 'Adopcion',
    motivacion:
      'Greta me parece perfecta para acompañarme en el home office. Tengo jardín y otro perro ' +
      'muy tranquilo.',
    historial: [['Pendiente', 1]],
  },

  // ── Otros solicitantes sobre mascotas de Patitas ──
  {
    // 200 días > 180 de secuenciaDias: el cron de HU-7.6 la tiene que cancelar.
    mascota: 'rex',
    solicitante: 'carla',
    hogar: 'carla',
    tipo: 'Adopcion',
    motivacion:
      'Corro todas las mañanas y tengo patio grande. Rex tendría toda la actividad que necesita.',
    historial: [['Pendiente', 200]],
  },
  {
    mascota: 'nala',
    solicitante: 'carla',
    hogar: 'carla',
    tipo: 'Adopcion',
    motivacion:
      'Mis hijos se enamoraron de Nala en la visita del sábado. Tenemos patio y experiencia con ' +
      'perros grandes.',
    historial: [['Pendiente', 1]],
  },
  {
    mascota: 'coco',
    solicitante: 'elena',
    hogar: 'elena',
    tipo: 'Adopcion',
    motivacion:
      'Es nuestro primer perro y buscamos uno equilibrado y bueno con chicos como describen a Coco.',
    historial: [
      ['Pendiente', 95],
      ['Cancelada', 90],
    ],
  },
  {
    mascota: 'kira',
    solicitante: 'elena',
    hogar: 'elena',
    tipo: 'Adopcion',
    motivacion:
      'Queremos una gata tranquila para la casa. No tenemos otros animales y los chicos son ' +
      'cuidadosos.',
    historial: [
      ['Pendiente', 30],
      ['Rechazada', 28],
    ],
    comentario:
      'Kira se estresa mucho con chicos y con movimiento, no la vemos en una casa con niños. ' +
      'Les recomendamos conocer a Pipo.',
  },
  {
    mascota: 'pipo',
    solicitante: 'martin',
    hogar: 'martin',
    tipo: 'Adopcion',
    motivacion:
      'Vivo solo en un departamento tranquilo y busco un perro senior que quiera compañía y siesta.',
    historial: [['Pendiente', 4]],
  },
  {
    mascota: 'pipo',
    solicitante: 'lucia',
    hogar: 'lucia',
    tipo: 'Adopcion',
    motivacion:
      'Sería mi primer perro. Me gusta que Pipo sea tranquilo porque trabajo muchas horas afuera.',
    historial: [
      ['Pendiente', 62],
      ['Rechazada', 60],
    ],
    comentario: 'Pipo necesita alguien que esté más tiempo en casa. Gracias por postularte.',
  },
  {
    mascota: 'coco',
    solicitante: 'lucia',
    hogar: 'lucia',
    tipo: 'Adopcion',
    motivacion: 'Coco parece un perro fácil para alguien sin experiencia como yo.',
    historial: [
      ['Pendiente', 120],
      ['Rechazada', 118],
    ],
    comentario: 'Coco necesita paseos largos todos los días y el departamento no tiene espacio.',
  },
  {
    mascota: 'simba',
    solicitante: 'lucia',
    hogar: 'lucia',
    tipo: 'Adopcion',
    motivacion: 'Puse red en el balcón y quiero un gato activo que me haga compañía.',
    historial: [
      ['Pendiente', 8],
      ['En_Revision', 7],
    ],
  },

  // ── Mascota publicada por una particular (Carla) ──
  {
    mascota: 'canela',
    solicitante: 'martin',
    hogar: 'martin',
    tipo: 'Adopcion',
    motivacion:
      'Canela es del tamaño justo para mi departamento y la plaza queda a una cuadra para pasearla.',
    historial: [['Pendiente', 3]],
  },
];

const RESPUESTAS_SEGUIMIENTO = [
  'Come muy bien, dos veces por día. Le cambiamos al alimento premium que recomendaron.',
  'Está pesando 300 g más que cuando llegó. La veterinaria dice que está en el peso ideal.',
  'Sale a pasear todas las mañanas y a la tarde jugamos en el jardín.',
  'Se porta muy bien, ya no muerde los almohadones. Duerme en su cama al lado de la nuestra.',
  'Se adaptó rapidísimo. Ya reconoce su nombre y viene cuando la llamamos.',
  'Duerme toda la noche de corrido, en su cucha en el living.',
  'Con Olivia al principio se bufaban, ahora duermen juntas al sol.',
  'Con las visitas es un poco tímida, pero después de un rato se acerca a que la acaricien.',
  'Fuimos al control de rutina, todo perfecto. Nos dieron la fecha de la próxima vacuna.',
  'Vacunas al día y desparasitada la semana pasada.',
  'Tiene mucha energía, juega con la pelota hasta que se cansa.',
  'No notamos ningún cambio raro, está contenta y tranquila.',
];

const FOTOS_SEGUIMIENTO = [...FOTOS_PERRO, ...FOTOS_GATO];

/**
 * Materializa los pedidos que ya serían exigibles, con la misma regla de fechas que usa
 * `seguimiento.service` (así lo que crea el seed y lo que crearía la app al leer coinciden).
 * Cada pedido queda completado, vencido (con su aviso al publicador) o pendiente según el
 * índice y el reloj.
 */
async function seedSeguimientos(
  catalogos: Catalogos,
  solicitud: { id: number; usuarioId: number },
  publicadorId: number,
  nombreMascota: string,
  aprobacion: Date,
  tipo: TipoFlujo,
  sinResponder: number[],
) {
  const existente = await prisma.seguimiento.findFirst({ where: { solicitudId: solicitud.id } });
  if (existente) return;

  const ahora = new Date();
  const preguntas = await prisma.preguntaSeguimiento.findMany({
    where: { esAdopcion: tipo === 'Adopcion', fechaBaja: null },
    orderBy: { posicion: 'asc' },
  });
  const pedidos = pedidosExigiblesA(aprobacion, tipo, ahora);
  const omitidos = new Set(sinResponder);

  for (const [indice, pedido] of pedidos.entries()) {
    const pregunta = preguntas[indice % preguntas.length]!;
    const plazo = plazoDeRespuesta(pedido.fecha);
    const respondido = !omitidos.has(indice);
    const vencido = !respondido && plazo.getTime() <= ahora.getTime();

    await prisma.seguimiento.create({
      data: {
        solicitudId: solicitud.id,
        preguntaSeguimientoId: pregunta.id,
        plazo,
        usuarioAlta: catalogos.sistemaId,
        fechaAlta: pedido.fecha,
        ...(respondido
          ? {
              descripcion: RESPUESTAS_SEGUIMIENTO[indice % RESPUESTAS_SEGUIMIENTO.length]!,
              fotoUrl: foto(FOTOS_SEGUIMIENTO[indice % FOTOS_SEGUIMIENTO.length]!),
              usuarioModificacion: solicitud.usuarioId,
              fechaModificacion: new Date(pedido.fecha.getTime() + 20 * HORA),
            }
          : {}),
        // Un vencido con fechaModificacion ya avisó al publicador: es la marca de idempotencia
        // del service, y acá se deja el aviso creado para que no lo genere al leer.
        ...(vencido ? { usuarioModificacion: catalogos.sistemaId, fechaModificacion: plazo } : {}),
      },
    });

    if (vencido) {
      await prisma.notificacion.create({
        data: {
          tipo: 'SEGUIMIENTO_VENCIDO',
          mensaje: `Actualización de seguimiento no enviado — ${nombreMascota}`,
          usuarioId: publicadorId,
          usuarioAlta: catalogos.sistemaId,
          fechaAlta: plazo,
        },
      });
    }
  }
}

export async function seedSolicitudes(catalogos: Catalogos, actores: Actores, mascotas: Mascotas) {
  const hogares = await seedHogares(actores);
  let nuevas = 0;

  for (const def of SOLICITUDES) {
    const solicitante = actores[def.solicitante];
    const { mascota, publicacion } = mascotas.get(def.mascota)!;
    if (!publicacion) throw new Error(`La mascota "${def.mascota}" no tiene publicación`);

    const existente = await prisma.solicitud.findFirst({
      where: { publicacionId: publicacion.id, usuarioId: solicitante.id },
    });
    if (existente) continue;

    const [, diasAlta] = def.historial[0]!;
    const vigente = def.historial[def.historial.length - 1]!;
    const [estadoVigente, diasVigente] = vigente;
    const resuelta = estadoVigente === 'Aprobada' || estadoVigente === 'Rechazada';
    const cancelada = estadoVigente === 'Cancelada';
    const fechaAlta = haceDias(diasAlta);

    const solicitud = await prisma.solicitud.create({
      data: {
        motivacion: def.motivacion,
        comentario: def.comentario ?? null,
        fechaRespuesta: resuelta ? haceDias(diasVigente) : null,
        fechaInicioTransito: def.transito ? haceDias(diasVigente) : null,
        fechaFinTransito: def.transito ? enDias(def.transito.duracionDias - diasVigente) : null,
        publicacionId: publicacion.id,
        usuarioId: solicitante.id,
        tipoSolicitudId: id(catalogos.tiposSolicitud, def.tipo),
        hogarId: def.hogar ? hogares.get(def.hogar)!.id : null,
        usuarioAlta: solicitante.id,
        fechaAlta,
        ...(resuelta
          ? { usuarioModificacion: publicacion.usuarioId, fechaModificacion: haceDias(diasVigente) }
          : {}),
        // La cancelación automática (HU-7.6) es baja lógica de la solicitud + estado Cancelada.
        ...(cancelada
          ? { usuarioBaja: catalogos.sistemaId, fechaBaja: haceDias(diasVigente) }
          : {}),
      },
    });

    for (const [estado, dias] of def.historial) {
      const autor =
        estado === 'Pendiente'
          ? solicitante.id
          : estado === 'Cancelada'
            ? catalogos.sistemaId
            : publicacion.usuarioId;

      await prisma.solicitudEstado.create({
        data: {
          solicitudId: solicitud.id,
          estadoSolicitudId: id(catalogos.estadosSolicitud, estado),
          usuarioAlta: autor,
          fechaAlta: haceDias(dias),
        },
      });
    }

    if (estadoVigente === 'Aprobada') {
      await seedSeguimientos(
        catalogos,
        solicitud,
        publicacion.usuarioId,
        mascota.nombre ?? 'la mascota',
        haceDias(diasVigente),
        def.tipo,
        def.seguimientoSinResponder ?? [],
      );
    }

    nuevas += 1;
  }

  log(`📋 Solicitudes: ${SOLICITUDES.length} (${nuevas} nuevas), ${HOGARES.length} hogares`);
}
