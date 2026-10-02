// Catálogos base (Fase 0 — ROADMAP.md) + usuario SISTEMA. Corre también en producción.
//
// El usuario SISTEMA se siembra primero porque es el usuario_alta de todo lo demás y el
// autor de las bajas automáticas de los cron jobs. Tiene que quedar con id=1
// (src/shared/auditoria.ts USUARIO_SISTEMA_ID): por eso solo Estado_Usuario va antes.
import bcrypt from 'bcrypt';
import { prisma, SISTEMA_EMAIL, type Catalogos } from './comun';

type CatalogoSimple =
  | 'estadoUsuario'
  | 'estadoRefugio'
  | 'estadoMascota'
  | 'estadoPublicacion'
  | 'estadoSolicitud'
  | 'estadoCampania'
  | 'estadoAnimalPerdido'
  | 'rol';

/** Todos los catálogos de estado comparten la misma forma: nombre único + auditoría. */
async function upsertPorNombre(catalogo: CatalogoSimple, nombres: string[], usuarioAlta: number) {
  for (const nombre of nombres) {
    const args = { where: { nombre }, update: {}, create: { nombre, usuarioAlta } };
    switch (catalogo) {
      case 'estadoUsuario':
        await prisma.estadoUsuario.upsert(args);
        break;
      case 'estadoRefugio':
        await prisma.estadoRefugio.upsert(args);
        break;
      case 'estadoMascota':
        await prisma.estadoMascota.upsert(args);
        break;
      case 'estadoPublicacion':
        await prisma.estadoPublicacion.upsert(args);
        break;
      case 'estadoSolicitud':
        await prisma.estadoSolicitud.upsert(args);
        break;
      case 'estadoCampania':
        await prisma.estadoCampania.upsert(args);
        break;
      case 'estadoAnimalPerdido':
        await prisma.estadoAnimalPerdido.upsert(args);
        break;
      case 'rol':
        await prisma.rol.upsert(args);
        break;
    }
  }
}

async function seedUsuarioSistema(estadoActivoId: number): Promise<number> {
  const sistema = await prisma.usuario.upsert({
    where: { email: SISTEMA_EMAIL },
    update: {},
    create: {
      nombre: 'Sistema',
      apellido: 'PetHood',
      email: SISTEMA_EMAIL,
      // Nunca se usa para login real.
      contrasena: await bcrypt.hash(`sistema-${crypto.randomUUID()}`, 10),
      dni: '00000000',
      verificado: true,
      estadoId: estadoActivoId,
      usuarioAlta: 1,
    },
  });

  return sistema.id;
}

async function seedTiposSolicitud(usuarioAlta: number) {
  // secuenciaDias = ventana de cancelación automática de pendientes (HU-7.6): 6 meses.
  for (const nombre of ['Adopcion', 'Transito']) {
    await prisma.tipoSolicitud.upsert({
      where: { nombre },
      update: {},
      create: { nombre, secuenciaDias: 180, usuarioAlta },
    });
  }
}

/** Primer pedido automático de todo seguimiento, siempre el mismo (spec 011 §6.3). */
export const PREGUNTA_INICIAL_SEGUIMIENTO = '¿Qué tal estuvo la primera noche en casa?';

/**
 * Catálogo del que se sortea el resto de los pedidos (spec 011, HU-9.2). Aplica igual a
 * adopción y a tránsito: ninguna pregunta es exclusiva de un flujo.
 */
const PREGUNTAS_SEGUIMIENTO = [
  '¿Está comiendo bien y con qué frecuencia?',
  '¿Ha tenido cambios de peso notorios o problemas estomacales?',
  '¿Toma suficiente agua a lo largo del día?',
  '¿Tiene el plato de comida en un lugar tranquilo y fácil de acceder?',
  '¿Cómo se ha comportado durante sus visitas al veterinario?',
  '¿Cómo se lleva con otros animales en el hogar o durante los paseos?',
  '¿Cómo reacciona ante la presencia de desconocidos o visitas?',
  '¿Ha mostrado convivencia o interés por niños en la casa?',
  '¿Han notado algún comportamiento tímido, temeroso o reactivo?',
  '¿Está rompiendo muebles, ropa, zapatos u otros objetos en casa?',
  '¿Hace sus necesidades en el lugar correcto o han tenido accidentes?',
  '¿Cómo reacciona cuando se le imponen límites o reglas básicas?',
  '¿Qué tal responde al entrenamiento o a los comandos que le enseñan?',
  '¿Ladra, maúlla o se vocaliza mucho cuando se queda solo?',
  '¿Sufre o muestra señales de ansiedad por separación al salir ustedes?',
  '¿Tiene juguetes adecuados para entretenerse y morder o rascar?',
  '¿Sale a pasear con regularidad y a qué horas del día?',
  '¿Cómo camina con la correa durante los paseos?',
  '¿Cuenta con una placa de identificación puesta en su collar todo el tiempo?',
  '¿Tiene acceso a un espacio seguro, limpio y resguardado para dormir?',
  '¿Es un espacio 100% seguro a prueba de escapes (patio cerrado, mallas)?',
  '¿Qué actividades de juego o estimulación mental hacen a diario?',
  '¿Disfruta del contacto físico y los mimos de la familia?',
  '¿Tiene acceso permitido a la mayoría de las áreas comunes de la casa?',
  '¿Se ajustó bien la rutina diaria del hogar a las necesidades del animal?',
];

/**
 * Preguntas del seguimiento post-adopción (spec 011, HU-9.2). `esAdopcion` separa los dos
 * flujos; `posicion` es solo el orden del catálogo (la inicial va en 0), el sistema sortea
 * una por pedido. Solo toca el catálogo (`solicitudId` null): las preguntas que escribe un
 * refugio para una solicitud puntual no son del seed.
 *
 * Es idempotente y además da de baja lógica las preguntas de catálogos anteriores que ya no
 * están en la lista, para que dejen de sortearse. Los pedidos viejos que las usaron las
 * siguen mostrando: la baja no rompe la FK.
 */
async function seedPreguntasSeguimiento(usuarioAlta: number) {
  const catalogo = [
    { texto: PREGUNTA_INICIAL_SEGUIMIENTO, esInicial: true },
    ...PREGUNTAS_SEGUIMIENTO.map((texto) => ({ texto, esInicial: false })),
  ];

  for (const esAdopcion of [true, false]) {
    for (const [posicion, { texto, esInicial }] of catalogo.entries()) {
      const existente = await prisma.preguntaSeguimiento.findFirst({
        where: { texto, esAdopcion, solicitudId: null },
      });

      if (existente) {
        await prisma.preguntaSeguimiento.update({
          where: { id: existente.id },
          data: { posicion, esInicial, usuarioBaja: null, fechaBaja: null },
        });
        continue;
      }

      await prisma.preguntaSeguimiento.create({
        data: { texto, posicion, esAdopcion, esInicial, usuarioAlta },
      });
    }
  }

  await prisma.preguntaSeguimiento.updateMany({
    where: {
      solicitudId: null,
      fechaBaja: null,
      texto: { notIn: catalogo.map((pregunta) => pregunta.texto) },
    },
    data: { usuarioBaja: usuarioAlta, fechaBaja: new Date() },
  });
}

async function seedEspeciesYRazas(usuarioAlta: number) {
  const especies: Record<string, string[]> = {
    Perro: [
      'Mestizo',
      'Labrador',
      'Caniche',
      'Bulldog',
      'Golden Retriever',
      'Beagle',
      'Border Collie',
      'Salchicha',
    ],
    Gato: ['Mestizo', 'Siames', 'Persa', 'Maine Coon'],
  };

  for (const [nombreEspecie, razas] of Object.entries(especies)) {
    const especie = await prisma.especie.upsert({
      where: { nombre: nombreEspecie },
      update: {},
      create: { nombre: nombreEspecie, usuarioAlta },
    });

    for (const nombre of razas) {
      await prisma.raza.upsert({
        where: { nombre_especieId: { nombre, especieId: especie.id } },
        update: {},
        create: { nombre, especieId: especie.id, usuarioAlta },
      });
    }
  }
}

export async function seedCatalogos(): Promise<number> {
  await upsertPorNombre(
    'estadoUsuario',
    ['Pendiente_Verificacion', 'Activo', 'Suspendido', 'Inactivo'],
    1,
  );
  const activo = await prisma.estadoUsuario.findUniqueOrThrow({ where: { nombre: 'Activo' } });

  const sistemaId = await seedUsuarioSistema(activo.id);

  await upsertPorNombre(
    'estadoRefugio',
    ['Pendiente_Verificacion', 'Activo', 'Suspendido', 'Inactivo'],
    sistemaId,
  );
  // "Perdido" NO es un estado propio de Mascota: se rastrea aparte vía AnimalPerdido.
  await upsertPorNombre(
    'estadoMascota',
    ['Disponible', 'En_Tratamiento', 'Adoptado', 'Fallecido', 'En_Transito'],
    sistemaId,
  );
  // Estado del aviso, no de la mascota (ver EstadoPublicacion en schema.prisma).
  await upsertPorNombre('estadoPublicacion', ['Activa', 'Pausada', 'Finalizada'], sistemaId);
  await upsertPorNombre(
    'estadoSolicitud',
    ['Pendiente', 'En_Revision', 'Aprobada', 'Rechazada', 'Cancelada'],
    sistemaId,
  );
  await upsertPorNombre(
    'estadoCampania',
    ['Inactiva', 'Activa', 'Finalizada', 'Cancelada'],
    sistemaId,
  );
  await upsertPorNombre('estadoAnimalPerdido', ['Perdido', 'Encontrado', 'Resuelto'], sistemaId);
  await upsertPorNombre('rol', ['Administrador', 'Refugio', 'Adoptante'], sistemaId);
  await seedTiposSolicitud(sistemaId);
  await seedPreguntasSeguimiento(sistemaId);
  await seedEspeciesYRazas(sistemaId);

  return sistemaId;
}

function mapaPorNombre(filas: { id: number; nombre: string }[]): Map<string, number> {
  return new Map(filas.map((fila) => [fila.nombre, fila.id]));
}

export async function cargarCatalogos(sistemaId: number): Promise<Catalogos> {
  const razas = await prisma.raza.findMany({ include: { especie: true } });

  return {
    sistemaId,
    estadosUsuario: mapaPorNombre(await prisma.estadoUsuario.findMany()),
    estadosRefugio: mapaPorNombre(await prisma.estadoRefugio.findMany()),
    estadosMascota: mapaPorNombre(await prisma.estadoMascota.findMany()),
    estadosPublicacion: mapaPorNombre(await prisma.estadoPublicacion.findMany()),
    estadosSolicitud: mapaPorNombre(await prisma.estadoSolicitud.findMany()),
    estadosCampania: mapaPorNombre(await prisma.estadoCampania.findMany()),
    estadosAnimalPerdido: mapaPorNombre(await prisma.estadoAnimalPerdido.findMany()),
    roles: mapaPorNombre(await prisma.rol.findMany()),
    tiposSolicitud: mapaPorNombre(await prisma.tipoSolicitud.findMany()),
    razas: new Map(razas.map((raza) => [`${raza.especie.nombre}/${raza.nombre}`, raza.id])),
  };
}
