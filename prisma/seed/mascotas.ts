// Mascotas con su histórico de estados, publicaciones e historia clínica.
//
// Están pensadas como un conjunto: las "Disponible" con publicación alimentan el feed de
// adopción; las de Ana en favoritos son las que muestran los distintos badges de estado; las
// "Adoptado"/"En_Transito" son las que tienen solicitud aprobada y seguimiento; las de Ana a
// título personal son las de "Mis mascotas" con historia clínica. Los estados están variados
// para que los dashboards tengan algo en cada bucket.
import type { GeneroMascota, Mascota, Publicacion, TamanioMascota } from '@prisma/client';
import {
  foto,
  FOTOS_GATO,
  FOTOS_PERRO,
  haceDias,
  id,
  log,
  nacioHace,
  prisma,
  type Catalogos,
} from './comun';
import type { Actores } from './usuarios';

type Duenio = 'bruno' | 'nico' | 'sofia' | 'ana' | 'carla';
type RefugioClave = 'patitas' | 'huellitas' | 'cuatroPatas';

interface DefPublicacion {
  /** ≤ 50 caracteres (LIMITES.publicacion.descripcion). */
  tagline: string;
  requisitos: string[];
  personalidad: string[];
  vacunas: string;
  desparasitado?: boolean;
  /** Antigüedad de la publicación: cubre los 4 buckets del dashboard (0-15/15-30/30-60/+60). */
  diasAtras: number;
  /** Publicación cerrada (baja lógica) por el refugio, ej. después de concretar la adopción. */
  cerradaHaceDias?: number;
}

interface DefHistoriaClinica {
  titulo: string;
  descripcion: string;
  diasAtras: number;
  proximaEnDias?: number;
  requiereRevision?: boolean;
  vacunacion?: boolean;
}

interface DefMascota {
  clave: string;
  nombre: string;
  duenio: Duenio;
  refugio?: RefugioClave;
  raza: string;
  genero: GeneroMascota;
  tamanio: TamanioMascota;
  peso: number;
  edad: { anios: number; meses?: number };
  castrado: boolean;
  descripcion: string;
  fotos: string[];
  /** Histórico de estados, del más viejo al vigente: [estado, hace cuántos días]. */
  historial: [string, number][];
  publicacion?: DefPublicacion;
  historiaClinica?: DefHistoriaClinica[];
}

const perro = (i: number) => FOTOS_PERRO[i % FOTOS_PERRO.length]!;
const gato = (i: number) => FOTOS_GATO[i % FOTOS_GATO.length]!;

const CATALOGO: DefMascota[] = [
  // ─────────────── Refugio Patitas: feed de adopción (Disponible, sin favoritos de Ana) ───────────────
  {
    clave: 'nala',
    nombre: 'Nala',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Labrador',
    genero: 'HEMBRA',
    tamanio: 'GRANDE',
    peso: 28.5,
    edad: { anios: 2 },
    castrado: true,
    descripcion:
      'Nala llegó al refugio hace ocho meses después de que la encontraran sola en la ruta. ' +
      'Es una labradora enorme y torpe que todavía no entiende que ya no entra en ninguna falda. ' +
      'Aprende rapidísimo, ya sabe sentarse y dar la pata, y se lleva bien con todos los chicos ' +
      'que la visitan.',
    fotos: [perro(0), perro(1), perro(2), perro(3)],
    historial: [['Disponible', 3]],
    publicacion: {
      tagline: 'Labradora joven, ideal para familia con chicos',
      requisitos: ['Casa con patio', 'Paseos diarios'],
      personalidad: ['Juguetón', 'Cariñoso', 'Bueno con chicos'],
      vacunas: 'Rabia, Parvovirus, Moquillo',
      diasAtras: 3,
    },
    historiaClinica: [
      {
        titulo: 'Vacuna antirrábica',
        descripcion: 'Dosis anual aplicada sin reacciones. Próxima en 12 meses.',
        diasAtras: 40,
        proximaEnDias: 325,
        vacunacion: true,
      },
      {
        titulo: 'Control general de ingreso',
        descripcion:
          'Ingresó desnutrida (22 kg). Se indicó plan de alimentación reforzado y desparasitación.',
        diasAtras: 240,
      },
    ],
  },
  {
    clave: 'pipo',
    nombre: 'Pipo',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Caniche',
    genero: 'MACHO',
    tamanio: 'PEQUENO',
    peso: 6.2,
    edad: { anios: 8 },
    castrado: true,
    descripcion:
      'Pipo es un señor mayor que ya hizo todo lo que tenía que hacer en la vida y ahora solo ' +
      'quiere un sillón cerca de una ventana. Duerme la mayor parte del día, camina despacio y ' +
      'convive sin problema con otros perros y con gatos. Busca una casa donde envejecer tranquilo.',
    fotos: [perro(4), perro(5), perro(6)],
    historial: [['Disponible', 20]],
    publicacion: {
      tagline: 'Caniche senior, tranquilo y de sillón',
      requisitos: ['Ambiente tranquilo'],
      personalidad: ['Tranquilo', 'Cariñoso', 'Bueno con otras mascotas'],
      vacunas: 'Rabia, Quíntuple',
      diasAtras: 20,
    },
  },
  {
    clave: 'simba',
    nombre: 'Simba',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Gato/Siames',
    genero: 'MACHO',
    tamanio: 'PEQUENO',
    peso: 3.8,
    edad: { anios: 1 },
    castrado: false,
    descripcion:
      'Simba tiene un año y la energía de tres gatos juntos. Se trepa a todo, abre puertas de ' +
      'placard y ya rompió dos macetas. Necesita una casa con ventanas protegidas y gente que le ' +
      'siga el ritmo. A cambio duerme sobre tu cabeza todas las noches.',
    fotos: [gato(0), gato(1), gato(2), gato(3), gato(4)],
    historial: [['Disponible', 40]],
    publicacion: {
      tagline: 'Siamés joven con mucha energía',
      requisitos: ['Balcón con red'],
      personalidad: ['Activo', 'Independiente', 'Juguetón'],
      vacunas: 'Triple felina',
      diasAtras: 40,
    },
  },
  {
    clave: 'coco',
    nombre: 'Coco',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Mestizo',
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 17.0,
    edad: { anios: 4 },
    castrado: true,
    descripcion:
      'Coco es el perro más equilibrado del refugio: ni tímido ni desbordado. Camina bien con ' +
      'correa, saluda a todo el mundo y se acuesta solo cuando ve que bajás el ritmo. Convive con ' +
      'perros, gatos y chicos sin que haya que explicarle nada.',
    fotos: [perro(7), perro(8), perro(9)],
    historial: [['Disponible', 75]],
    publicacion: {
      tagline: 'Mestizo mediano, equilibrado y sociable',
      requisitos: ['Experiencia con perros'],
      personalidad: ['Sociable', 'Protector', 'Bueno con chicos', 'Bueno con otras mascotas'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 75,
    },
  },
  {
    clave: 'kira',
    nombre: 'Kira',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Gato/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 4.1,
    edad: { anios: 5 },
    castrado: true,
    descripcion:
      'Kira tarda en confiar, pero cuando lo hace no se despega. Prefiere una casa sin perros y ' +
      'sin demasiado movimiento. Le gusta mirar por la ventana durante horas y pide upa solo ' +
      'cuando ella lo decide.',
    fotos: [gato(4), gato(3), gato(0)],
    historial: [['Disponible', 10]],
    publicacion: {
      tagline: 'Gata tranquila para casa sin perros',
      requisitos: ['Casa sin perros'],
      personalidad: ['Tranquilo', 'Independiente'],
      vacunas: 'Triple felina, Rabia',
      diasAtras: 10,
    },
  },
  {
    clave: 'rocco',
    nombre: 'Rocco',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Bulldog',
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 9.5,
    edad: { anios: 0, meses: 7 },
    castrado: false,
    descripcion:
      'Rocco tiene siete meses y todavía está aprendiendo todo. Muerde lo que encuentra, se ' +
      'emociona con cada visita y duerme profundo apenas se cansa. Necesita una familia con ' +
      'paciencia para acompañarlo en el primer año, que es el que más trabajo da.',
    fotos: [perro(9), perro(3), perro(1), perro(2), perro(7)],
    historial: [['Disponible', 1]],
    publicacion: {
      tagline: 'Cachorro bulldog de 7 meses',
      requisitos: ['Tiempo para un cachorro', 'Control veterinario'],
      personalidad: ['Juguetón', 'Activo', 'Bueno con chicos'],
      vacunas: 'Primera dosis aplicada',
      diasAtras: 1,
    },
  },
  {
    clave: 'rex',
    nombre: 'Rex',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Border Collie',
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 19.0,
    edad: { anios: 3 },
    castrado: true,
    descripcion:
      'Rex necesita correr todos los días. Es un border collie con toda la inteligencia de la ' +
      'raza: si no tiene qué hacer, inventa. Ideal para alguien que haga deporte o tenga campo.',
    fotos: [perro(6), perro(0)],
    historial: [['Disponible', 210]],
    publicacion: {
      tagline: 'Border collie, necesita mucha actividad',
      requisitos: ['Actividad física diaria', 'Espacio amplio'],
      personalidad: ['Activo', 'Inteligente', 'Protector'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 210,
    },
  },

  // ─────────────── Refugio Patitas: favoritos de Ana (badges de estado variados) ───────────────
  {
    clave: 'max',
    nombre: 'Max',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Golden Retriever',
    genero: 'MACHO',
    tamanio: 'GRANDE',
    peso: 30.0,
    edad: { anios: 2 },
    castrado: true,
    descripcion:
      'Max es un golden clásico: quiere a todo el mundo y no sabe estar solo. Le encanta el ' +
      'agua y traer la pelota hasta que no le quedan fuerzas.',
    fotos: [perro(0), perro(2)],
    historial: [['Disponible', 25]],
    publicacion: {
      tagline: 'Golden joven, cariñoso y familiero',
      requisitos: ['Casa con patio', 'Compañía durante el día'],
      personalidad: ['Cariñoso', 'Juguetón', 'Bueno con chicos'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 25,
    },
  },
  {
    clave: 'luna',
    nombre: 'Luna',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 7.4,
    edad: { anios: 1 },
    castrado: true,
    descripcion:
      'Luna es chiquita, rápida y muy despierta. Aprendió a sentarse en dos días. Se lleva bien ' +
      'con gatos y le tiene un poco de miedo a los perros grandes.',
    fotos: [perro(3), perro(5)],
    historial: [['Disponible', 18]],
    publicacion: {
      tagline: 'Perrita chica, ideal para departamento',
      requisitos: ['Paseos diarios'],
      personalidad: ['Activo', 'Cariñoso', 'Bueno con otras mascotas'],
      vacunas: 'Rabia, Quíntuple',
      diasAtras: 18,
    },
  },
  {
    clave: 'toby',
    nombre: 'Toby',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Beagle',
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 12.3,
    edad: { anios: 4 },
    castrado: true,
    descripcion:
      'Toby está en tránsito mientras termina un tratamiento de piel. Es un beagle glotón y ' +
      'cariñoso que se adapta a cualquier casa mientras haya comida y alguien que lo rasque.',
    fotos: [perro(8), perro(4)],
    historial: [
      ['Disponible', 45],
      ['En_Transito', 10],
    ],
    publicacion: {
      tagline: 'Beagle en tránsito, busca familia definitiva',
      requisitos: ['Control veterinario'],
      personalidad: ['Cariñoso', 'Glotón', 'Tranquilo'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 45,
    },
    historiaClinica: [
      {
        titulo: 'Dermatitis alérgica',
        descripcion:
          'Lesiones en lomo y abdomen. Se indicó baño medicado semanal y antihistamínico por 30 días.',
        diasAtras: 12,
        proximaEnDias: 18,
        requiereRevision: true,
      },
    ],
  },
  {
    clave: 'rocky',
    nombre: 'Rocky',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Mestizo',
    genero: 'MACHO',
    tamanio: 'GRANDE',
    peso: 26.0,
    edad: { anios: 6 },
    castrado: true,
    descripcion:
      'Rocky fue atropellado y está en recuperación de una fractura de cadera. Es un perro ' +
      'noble, paciente y muy agradecido. Cuando termine el tratamiento va a estar listo para adoptar.',
    fotos: [perro(1), perro(6)],
    historial: [
      ['Disponible', 90],
      ['En_Tratamiento', 30],
    ],
    publicacion: {
      tagline: 'En recuperación, busca hogar paciente',
      requisitos: ['Sin escaleras', 'Control veterinario'],
      personalidad: ['Tranquilo', 'Noble', 'Cariñoso'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 90,
    },
    historiaClinica: [
      {
        titulo: 'Fractura de cadera — cirugía',
        descripcion:
          'Osteosíntesis de cadera derecha. Reposo absoluto 3 semanas, luego fisioterapia.',
        diasAtras: 30,
        requiereRevision: true,
      },
      {
        titulo: 'Control post-quirúrgico',
        descripcion: 'Buena consolidación. Comienza fisioterapia dos veces por semana.',
        diasAtras: 9,
        proximaEnDias: 21,
        requiereRevision: true,
      },
      {
        titulo: 'Desparasitación interna',
        descripcion: 'Dosis según peso. Repetir en 90 días.',
        diasAtras: 30,
        proximaEnDias: 60,
      },
    ],
  },
  {
    clave: 'mia',
    nombre: 'Mia',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Gato/Persa',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 3.5,
    edad: { anios: 3 },
    castrado: true,
    descripcion:
      'Mia es una persa mimosa que pide cepillado todos los días. Fue adoptada hace poco por ' +
      'Ana y está en seguimiento.',
    fotos: [gato(1), gato(2)],
    historial: [
      ['Disponible', 60],
      ['Adoptado', 3],
    ],
    publicacion: {
      tagline: 'Persa mimosa, adoptada recientemente',
      requisitos: ['Cepillado diario'],
      personalidad: ['Tranquilo', 'Cariñoso'],
      vacunas: 'Triple felina, Rabia',
      diasAtras: 60,
    },
  },

  // ─────────────── Refugio Patitas: adopciones ya en seguimiento ───────────────
  {
    clave: 'bimba',
    nombre: 'Bimba',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'MEDIANO',
    peso: 14.0,
    edad: { anios: 2 },
    castrado: true,
    descripcion: 'Bimba fue adoptada por Ana hace unos meses y va por la mitad del seguimiento.',
    fotos: [perro(9), perro(7)],
    historial: [
      ['Disponible', 130],
      ['Adoptado', 100],
    ],
    publicacion: {
      tagline: 'Mestiza mediana, ya adoptada',
      requisitos: [],
      personalidad: ['Sociable', 'Juguetón'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 130,
      cerradaHaceDias: 99,
    },
  },
  {
    clave: 'estrella',
    nombre: 'Estrella',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Gato/Siames',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 3.9,
    edad: { anios: 5 },
    castrado: true,
    descripcion: 'Estrella fue adoptada por Ana hace más de dos años: seguimiento finalizado.',
    fotos: [gato(3), gato(0)],
    historial: [
      ['Disponible', 930],
      ['Adoptado', 900],
    ],
    publicacion: {
      tagline: 'Siamesa adulta, ya adoptada',
      requisitos: [],
      personalidad: ['Independiente', 'Tranquilo'],
      vacunas: 'Triple felina',
      diasAtras: 930,
      cerradaHaceDias: 899,
    },
  },

  // ─────────────── Refugio Patitas: sin publicación ───────────────
  {
    clave: 'manchas',
    nombre: 'Manchas',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Perro/Mestizo',
    genero: 'MACHO',
    tamanio: 'GRANDE',
    peso: 24.0,
    edad: { anios: 12 },
    castrado: true,
    descripcion: 'Manchas vivió sus últimos años en el refugio. Falleció de viejo, acompañado.',
    fotos: [perro(5)],
    historial: [
      ['Disponible', 400],
      ['En_Tratamiento', 120],
      ['Fallecido', 50],
    ],
  },
  {
    clave: 'olaf',
    nombre: 'Olaf',
    duenio: 'bruno',
    refugio: 'patitas',
    raza: 'Gato/Maine Coon',
    genero: 'MACHO',
    tamanio: 'MEDIANO',
    peso: 6.8,
    edad: { anios: 2 },
    castrado: false,
    descripcion: 'Olaf ingresó con una infección respiratoria. Todavía no está para publicar.',
    fotos: [gato(2)],
    historial: [['En_Tratamiento', 5]],
    historiaClinica: [
      {
        titulo: 'Infección respiratoria alta',
        descripcion: 'Secreción nasal y estornudos. Antibiótico 10 días y nebulizaciones.',
        diasAtras: 5,
        proximaEnDias: 6,
        requiereRevision: true,
      },
    ],
  },

  // ─────────────── Otros refugios (aparecen en el feed de Ana) ───────────────
  {
    clave: 'greta',
    nombre: 'Greta',
    duenio: 'nico',
    refugio: 'huellitas',
    raza: 'Perro/Salchicha',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 5.9,
    edad: { anios: 3 },
    castrado: true,
    descripcion:
      'Greta es una salchicha con carácter: manda en la casa y duerme abajo de las frazadas. ' +
      'Ideal para gente que trabaja desde casa.',
    fotos: [perro(2), perro(4)],
    historial: [['Disponible', 12]],
    publicacion: {
      tagline: 'Salchicha con carácter, compañera de home office',
      requisitos: ['Compañía durante el día'],
      personalidad: ['Independiente', 'Cariñoso'],
      vacunas: 'Rabia, Quíntuple',
      diasAtras: 12,
    },
  },
  {
    clave: 'chispa',
    nombre: 'Chispa',
    duenio: 'nico',
    refugio: 'huellitas',
    raza: 'Gato/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 2.1,
    edad: { anios: 0, meses: 5 },
    castrado: false,
    descripcion: 'Chispa es una gatita de cinco meses rescatada con sus hermanos. Muy juguetona.',
    fotos: [gato(0), gato(4)],
    historial: [['Disponible', 8]],
    publicacion: {
      tagline: 'Gatita de 5 meses, muy juguetona',
      requisitos: ['Balcón con red'],
      personalidad: ['Juguetón', 'Activo', 'Cariñoso'],
      vacunas: 'Primera dosis triple felina',
      diasAtras: 8,
    },
  },
  {
    clave: 'pelusa',
    nombre: 'Pelusa',
    duenio: 'sofia',
    refugio: 'cuatroPatas',
    raza: 'Perro/Mestizo',
    genero: 'MACHO',
    tamanio: 'GRANDE',
    peso: 32.0,
    edad: { anios: 5 },
    castrado: true,
    descripcion:
      'Pelusa es enorme y peludo, ideal para una casa con terreno. Guardián tranquilo, no ladra ' +
      'de más.',
    fotos: [perro(6), perro(1)],
    historial: [['Disponible', 33]],
    publicacion: {
      tagline: 'Perro grande de campo, guardián tranquilo',
      requisitos: ['Espacio amplio'],
      personalidad: ['Tranquilo', 'Protector'],
      vacunas: 'Rabia, Séxtuple',
      diasAtras: 33,
    },
  },

  // ─────────────── Mascotas propias de Ana ("Mis mascotas", con historia clínica) ───────────────
  {
    clave: 'olivia',
    nombre: 'Olivia',
    duenio: 'ana',
    raza: 'Gato/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 4.4,
    edad: { anios: 4 },
    castrado: true,
    descripcion: 'Olivia es la gata de Ana desde cachorra. Tranquila, casera y algo gordita.',
    fotos: [gato(4), gato(1)],
    historial: [['Adoptado', 500]],
    historiaClinica: [
      {
        titulo: 'Vacuna triple felina',
        descripcion: 'Refuerzo anual. Sin reacciones.',
        diasAtras: 20,
        proximaEnDias: 345,
        vacunacion: true,
      },
      {
        titulo: 'Control de peso',
        descripcion: 'Pesa 4,4 kg, un poco por encima del ideal. Se indicó alimento light.',
        diasAtras: 20,
        proximaEnDias: 70,
        requiereRevision: true,
      },
      {
        titulo: 'Castración',
        descripcion: 'Ovariohisterectomía sin complicaciones. Retiro de puntos a los 10 días.',
        diasAtras: 400,
      },
    ],
  },
  {
    clave: 'thor',
    nombre: 'Thor',
    duenio: 'ana',
    raza: 'Perro/Labrador',
    genero: 'MACHO',
    tamanio: 'GRANDE',
    peso: 31.0,
    edad: { anios: 6 },
    castrado: true,
    descripcion: 'Thor es el labrador de Ana. Se escapó del patio la semana pasada.',
    fotos: [perro(0)],
    historial: [['Adoptado', 700]],
    historiaClinica: [
      {
        titulo: 'Vacuna antirrábica',
        descripcion: 'Dosis anual aplicada.',
        diasAtras: 100,
        proximaEnDias: 265,
        vacunacion: true,
      },
    ],
  },

  // ─────────────── Mascota publicada por un adoptante particular ───────────────
  {
    clave: 'canela',
    nombre: 'Canela',
    duenio: 'carla',
    raza: 'Perro/Mestizo',
    genero: 'HEMBRA',
    tamanio: 'PEQUENO',
    peso: 8.0,
    edad: { anios: 1 },
    castrado: true,
    descripcion:
      'Canela apareció en la puerta de Carla y ya no se fue. Carla no puede quedársela por ' +
      'la alergia de su hijo y le busca familia.',
    fotos: [perro(5), perro(8)],
    historial: [['Disponible', 6]],
    publicacion: {
      tagline: 'Perrita rescatada, la publica una vecina',
      requisitos: ['Paseos diarios'],
      personalidad: ['Cariñoso', 'Tranquilo'],
      vacunas: 'Rabia, Quíntuple',
      diasAtras: 6,
    },
  },
];

export interface MascotaSembrada {
  mascota: Mascota;
  publicacion: Publicacion | null;
}

export type Mascotas = Map<string, MascotaSembrada>;

async function crearHistorialEstados(
  catalogos: Catalogos,
  mascotaId: number,
  historial: [string, number][],
) {
  for (const [indice, [estado, diasAtras]] of historial.entries()) {
    const siguiente = historial[indice + 1];
    const fechaAlta = haceDias(diasAtras);

    // Invariante del backend: una sola fila de estado activa por mascota.
    await prisma.mascotaEstado.create({
      data: {
        mascotaId,
        estadoMascotaId: id(catalogos.estadosMascota, estado),
        usuarioAlta: catalogos.sistemaId,
        fechaAlta,
        ...(siguiente
          ? { usuarioBaja: catalogos.sistemaId, fechaBaja: haceDias(siguiente[1]) }
          : {}),
      },
    });
  }
}

/** Misma regla que `estadoPublicacionSegunMascota` en publicaciones.service.ts. */
function estadoPublicacionSegun(estadoMascota: string): string {
  if (estadoMascota === 'Disponible') return 'Activa';
  if (estadoMascota === 'Adoptado' || estadoMascota === 'Fallecido') return 'Finalizada';
  return 'Pausada';
}

/**
 * Histórico de estados de la publicación, derivado del de la mascota desde que se publicó:
 * arranca con el estado que tenía la mascota ese día y sigue cada cambio posterior,
 * salteando los que no cambian el estado del aviso (En_Tratamiento → En_Transito sigue
 * siendo "Pausada").
 */
async function crearHistorialEstadosPublicacion(
  catalogos: Catalogos,
  publicacionId: number,
  historialMascota: [string, number][],
  publicadaHaceDias: number,
) {
  // [estado del aviso, días atrás] — el primero es el vigente al publicar.
  const vigenteAlPublicar = historialMascota.filter(([, dias]) => dias >= publicadaHaceDias).at(-1);
  const tramos: [string, number][] = [
    [estadoPublicacionSegun(vigenteAlPublicar?.[0] ?? 'Disponible'), publicadaHaceDias],
  ];

  for (const [estadoMascota, dias] of historialMascota) {
    if (dias >= publicadaHaceDias) continue;
    const estado = estadoPublicacionSegun(estadoMascota);
    if (estado !== tramos.at(-1)![0]) tramos.push([estado, dias]);
  }

  for (const [indice, [estado, diasAtras]] of tramos.entries()) {
    const siguiente = tramos[indice + 1];

    // Invariante del backend: una sola fila de estado activa por publicación.
    await prisma.publicacionEstado.create({
      data: {
        publicacionId,
        estadoPublicacionId: id(catalogos.estadosPublicacion, estado),
        usuarioAlta: catalogos.sistemaId,
        fechaAlta: haceDias(diasAtras),
        ...(siguiente
          ? { usuarioBaja: catalogos.sistemaId, fechaBaja: haceDias(siguiente[1]) }
          : {}),
      },
    });
  }
}

async function crearHistoriaClinica(
  usuarioAlta: number,
  mascotaId: number,
  registros: DefHistoriaClinica[],
) {
  for (const registro of registros) {
    const existente = await prisma.historiaClinica.findFirst({
      where: { mascotaId, titulo: registro.titulo, fechaBaja: null },
    });
    if (existente) continue;

    const fechaVisita = haceDias(registro.diasAtras);
    await prisma.historiaClinica.create({
      data: {
        mascotaId,
        titulo: registro.titulo,
        descripcion: registro.descripcion,
        fechaVisita,
        fechaProxima:
          registro.proximaEnDias === undefined
            ? null
            : new Date(fechaVisita.getTime() + registro.proximaEnDias * 86_400_000),
        requiereRevision: registro.requiereRevision ?? false,
        vacunacion: registro.vacunacion ?? false,
        usuarioAlta,
        fechaAlta: fechaVisita,
      },
    });
  }
}

export async function seedMascotas(catalogos: Catalogos, actores: Actores): Promise<Mascotas> {
  const resultado: Mascotas = new Map();
  let mascotasNuevas = 0;
  let publicacionesNuevas = 0;

  for (const def of CATALOGO) {
    const duenio = actores[def.duenio];
    const refugioId = def.refugio ? actores[def.refugio].id : null;
    const imagenes = def.fotos.map(foto);
    const primerEstado = def.historial[0]!;

    // Mascota no tiene clave natural única: se busca por (nombre, dueño).
    let mascota = await prisma.mascota.findFirst({
      where: { nombre: def.nombre, usuarioId: duenio.id, fechaBaja: null },
    });

    if (!mascota) {
      mascota = await prisma.mascota.create({
        data: {
          nombre: def.nombre,
          fechaNacimiento: nacioHace(def.edad.anios, def.edad.meses),
          genero: def.genero,
          tamanio: def.tamanio,
          peso: def.peso,
          castrado: def.castrado,
          descripcion: def.descripcion,
          imagenUrl: imagenes[0],
          razaId: id(catalogos.razas, def.raza),
          refugioId,
          usuarioId: duenio.id,
          usuarioAlta: duenio.id,
          fechaAlta: haceDias(primerEstado[1]),
        },
      });
      await crearHistorialEstados(catalogos, mascota.id, def.historial);
      mascotasNuevas += 1;
    }

    let publicacion: Publicacion | null = null;

    if (def.publicacion) {
      publicacion = await prisma.publicacion.findFirst({ where: { mascotaId: mascota.id } });

      if (!publicacion) {
        publicacion = await prisma.publicacion.create({
          data: {
            titulo: `${def.nombre} busca hogar`,
            descripcion: def.publicacion.tagline,
            ubicacion: def.refugio ? 'Mendoza' : (duenio.ubicacion ?? 'Mendoza'),
            requisitos: def.publicacion.requisitos,
            personalidad: def.publicacion.personalidad,
            desparasitado: def.publicacion.desparasitado ?? true,
            vacunas: def.publicacion.vacunas,
            imagenes,
            imagenUrl: imagenes[0],
            mascotaId: mascota.id,
            usuarioId: duenio.id,
            usuarioAlta: duenio.id,
            fechaAlta: haceDias(def.publicacion.diasAtras),
            ...(def.publicacion.cerradaHaceDias === undefined
              ? {}
              : { usuarioBaja: duenio.id, fechaBaja: haceDias(def.publicacion.cerradaHaceDias) }),
          },
        });
        await crearHistorialEstadosPublicacion(
          catalogos,
          publicacion.id,
          def.historial,
          def.publicacion.diasAtras,
        );
        publicacionesNuevas += 1;
      }
    }

    if (def.historiaClinica) {
      await crearHistoriaClinica(duenio.id, mascota.id, def.historiaClinica);
    }

    resultado.set(def.clave, { mascota, publicacion });
  }

  log(
    `🐾 Mascotas: ${CATALOGO.length} (${mascotasNuevas} nuevas), ` +
      `${CATALOGO.filter((d) => d.publicacion).length} publicaciones (${publicacionesNuevas} nuevas), ` +
      `${CATALOGO.reduce((n, d) => n + (d.historiaClinica?.length ?? 0), 0)} registros de historia clínica`,
  );

  return resultado;
}
