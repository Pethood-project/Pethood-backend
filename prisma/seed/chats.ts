// Conversaciones (HU-5.1/5.2). Cubren todos los casos del listado: chat con refugio y con
// otro adoptante, sala sin mensajes, contacto dado de baja, mensaje de solo foto, no leídos
// y nombres largos. Los mensajes se fechan relativo al momento de correr el seed, así los
// tramos de tiempo relativo ("Hace 3 min", "Ayer", "Hace 4 días") se ven siempre.
import { DIA, foto, hace, HORA, log, MINUTO, prisma } from './comun';
import type { Actores } from './usuarios';

/** Ayer a las 00:01: cae en el tramo "Ayer" sin importar la hora a la que se corra. */
function ayerTemprano(): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - 1);
  fecha.setHours(0, 1, 0, 0);
  return fecha;
}

interface Mensaje {
  /** Quién lo mandó: 'yo' es el primer participante, 'otro' la contraparte. */
  de: 'yo' | 'otro';
  contenido: string;
  fecha: Date;
  leido?: boolean;
  imagenUrl?: string;
}

interface DefChat {
  yo: keyof Actores;
  otro: keyof Actores;
  /** Contraparte institucional: define nombre e imagen que ve el adoptante. */
  refugio?: 'patitas' | 'huellitas' | 'cuatroPatas';
  mensajes: Mensaje[];
  /** Para la sala sin mensajes, que se ordena por su propia fecha de alta. */
  fechaAlta?: Date;
}

function definirChats(): DefChat[] {
  return [
    {
      yo: 'ana',
      otro: 'bruno',
      refugio: 'patitas',
      mensajes: [
        {
          de: 'yo',
          contenido: '¡Hola! Vi a Max en la app, ¿sigue disponible?',
          fecha: hace(4 * HORA),
          leido: true,
        },
        {
          de: 'otro',
          contenido: 'Hola Ana, sí, sigue disponible',
          fecha: hace(3 * HORA),
          leido: true,
        },
        {
          de: 'yo',
          contenido: 'Genial, ya mandé la solicitud. ¿Puedo ir a conocerlo?',
          fecha: hace(2 * HORA),
          leido: true,
        },
        {
          de: 'otro',
          contenido: '¿Te queda cómodo venir el sábado a la mañana?',
          fecha: hace(8 * MINUTO),
        },
        {
          de: 'otro',
          contenido: 'Podés venir cuando quieras entre 10 y 13',
          fecha: hace(5 * MINUTO),
        },
        { de: 'otro', contenido: 'Dale, te espero el sábado a las 10', fecha: hace(3 * MINUTO) },
      ],
    },
    // Sin refugio: coordinación entre adoptantes por una mascota perdida (Thor).
    {
      yo: 'ana',
      otro: 'carla',
      mensajes: [
        {
          de: 'otro',
          contenido: 'Creo que vi a tu perro por el parque San Martín, cerca del lago',
          fecha: hace(3 * HORA),
          leido: true,
        },
        {
          de: 'yo',
          contenido: '¡Gracias! Voy para allá ahora',
          fecha: hace(2 * HORA),
          leido: true,
        },
      ],
    },
    // Varios no leídos + mensaje de solo foto.
    {
      yo: 'ana',
      otro: 'nico',
      refugio: 'huellitas',
      mensajes: [
        {
          de: 'yo',
          contenido: 'Hola, me interesa Greta. ¿Se lleva bien con otros perros?',
          fecha: hace(9 * HORA),
          leido: true,
        },
        { de: 'otro', contenido: 'Hola Ana, sí, convive con tres acá', fecha: hace(8 * HORA) },
        { de: 'otro', contenido: 'Es bastante mandona igual, te aviso', fecha: hace(7 * HORA) },
        { de: 'otro', contenido: 'Te mando una foto de hoy', fecha: hace(6 * HORA) },
        {
          de: 'otro',
          contenido: '',
          imagenUrl: foto('photo-1561037404-61cd46aa615b'),
          fecha: hace(5 * HORA),
        },
        {
          de: 'otro',
          contenido: '¿Te sirve pasar esta semana a conocerla?',
          fecha: hace(5 * HORA + 30 * MINUTO),
        },
      ],
    },
    // Contraparte dada de baja + tramo "Ayer".
    {
      yo: 'ana',
      otro: 'diego',
      mensajes: [
        {
          de: 'yo',
          contenido: '¿Seguís interesado en la gatita?',
          fecha: hace(3 * DIA),
          leido: true,
        },
        { de: 'otro', contenido: 'Sí, te confirmo mañana', fecha: ayerTemprano() },
      ],
    },
    // Sala abierta y todavía sin ningún mensaje.
    {
      yo: 'ana',
      otro: 'sofia',
      refugio: 'cuatroPatas',
      fechaAlta: hace(2 * DIA),
      mensajes: [],
    },
    // Tramo "Hace X días".
    {
      yo: 'ana',
      otro: 'elena',
      mensajes: [
        {
          de: 'otro',
          contenido: 'Perfecto, quedamos así entonces',
          fecha: hace(4 * DIA),
          leido: true,
        },
      ],
    },
    // Segunda conversación del refugio Patitas, para que Bruno vea más de una sala.
    {
      yo: 'carla',
      otro: 'bruno',
      refugio: 'patitas',
      mensajes: [
        {
          de: 'yo',
          contenido: 'Buenas, mandé la solicitud por Nala. Mis hijos están ansiosos',
          fecha: hace(20 * HORA),
          leido: true,
        },
        {
          de: 'otro',
          contenido: 'La vimos, Carla. La revisamos hoy y te contestamos',
          fecha: hace(18 * HORA),
          leido: true,
        },
        { de: 'yo', contenido: '¡Gracias!', fecha: hace(17 * HORA) },
      ],
    },
  ];
}

/** La idempotencia va por la clave natural: los dos participantes activos más el refugio. */
function buscarChatExistente(yo: number, otro: number, refugioId: number | null) {
  return prisma.chat.findFirst({
    where: {
      refugioId,
      fechaBaja: null,
      AND: [
        { participantes: { some: { usuarioId: yo, fechaBaja: null } } },
        { participantes: { some: { usuarioId: otro, fechaBaja: null } } },
      ],
    },
  });
}

export async function seedChats(sistemaId: number, actores: Actores) {
  const chats = definirChats();
  let nuevos = 0;

  for (const def of chats) {
    const yo = actores[def.yo].id;
    const otro = actores[def.otro].id;
    const refugioId = def.refugio ? actores[def.refugio].id : null;

    if (await buscarChatExistente(yo, otro, refugioId)) continue;

    const chat = await prisma.chat.create({
      data: {
        refugioId,
        usuarioAlta: sistemaId,
        ...(def.fechaAlta ? { fechaAlta: def.fechaAlta } : {}),
      },
    });

    // Los DOS participantes llevan fila en UsuarioChat, incluido el miembro del refugio: es
    // la única tabla de pertenencia, sin su fila el refugio no vería la sala.
    await prisma.usuarioChat.createMany({
      data: [
        { chatId: chat.id, usuarioId: yo, usuarioAlta: sistemaId },
        { chatId: chat.id, usuarioId: otro, usuarioAlta: sistemaId },
      ],
    });

    if (def.mensajes.length > 0) {
      await prisma.mensaje.createMany({
        data: def.mensajes.map((mensaje) => {
          const emisor = mensaje.de === 'yo' ? yo : otro;
          return {
            chatId: chat.id,
            usuarioId: emisor,
            contenido: mensaje.contenido,
            imagenUrl: mensaje.imagenUrl,
            // Los propios nunca cuentan como no leídos; los ajenos sin `leido` alimentan el badge.
            leido: mensaje.leido ?? false,
            usuarioAlta: emisor,
            fechaAlta: mensaje.fecha,
          };
        }),
      });
    }

    nuevos += 1;
  }

  log(`💬 Chats: ${chats.length} (${nuevos} nuevos)`);
}
