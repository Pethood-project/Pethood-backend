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

/**
 * Preguntas del seguimiento post-adopción (spec 011, HU-9.2). `esAdopcion` separa los dos
 * flujos; `posicion` es solo el orden del catálogo, el sistema sortea una por pedido.
 */
async function seedPreguntasSeguimiento(usuarioAlta: number) {
  const adopcion = [
    '¿Está comiendo bien? ¿Cambió algo en su alimentación?',
    '¿Cuánto está pesando?',
    '¿Cuántos días a la semana sale a pasear?',
    '¿Se está portando bien en casa?',
    '¿Se está acostumbrando al entorno y a la familia?',
    '¿Dónde y cómo está durmiendo?',
    '¿Cómo se lleva con otras mascotas?',
    '¿Cómo reacciona con las visitas y con los chicos?',
    '¿Tuvo alguna consulta veterinaria en este tiempo?',
    '¿Está al día con las vacunas y la desparasitación?',
    '¿Está activo y con ganas de jugar?',
    '¿Notaste algún cambio de conducta que te preocupe?',
  ];

  const transito = [
    '¿Está comiendo bien durante el tránsito?',
    '¿Cuánto está pesando?',
    '¿Cómo se está adaptando al hogar de tránsito?',
    '¿Cuántos días a la semana sale a pasear?',
    '¿Cómo se lleva con las otras mascotas de la casa?',
    '¿Está durmiendo tranquilo durante la noche?',
    '¿Tuvo alguna urgencia o consulta veterinaria?',
    '¿Sigue con la medicación o el tratamiento indicado?',
    '¿Se muestra sociable con las personas que lo visitan?',
    '¿Notaste algún cambio de conducta desde la última actualización?',
  ];

  const sembrar = async (textos: string[], esAdopcion: boolean) => {
    for (const [indice, texto] of textos.entries()) {
      const existente = await prisma.preguntaSeguimiento.findFirst({
        where: { texto, esAdopcion },
      });
      if (existente) continue;

      await prisma.preguntaSeguimiento.create({
        data: { texto, posicion: indice + 1, esAdopcion, usuarioAlta },
      });
    }
  };

  await sembrar(adopcion, true);
  await sembrar(transito, false);
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
