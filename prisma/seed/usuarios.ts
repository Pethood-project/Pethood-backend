// Cuentas y refugios de demo. Todas las contraseñas son `Pethood123`.
//
// Los actores principales (Ana, Bruno, Nico...) protagonizan el resto del seed: favoritos,
// solicitudes, chats, campañas. El lote masivo del final (24 refugios + 24 vecinos) existe
// solo para que el panel admin tenga paginación y filtros con algo real que recortar.
import type { Refugio, Usuario } from '@prisma/client';
import {
  asignarRol,
  foto,
  FOTOS_PERSONA,
  hashContrasena,
  id,
  log,
  nacioHace,
  prisma,
  type Catalogos,
} from './comun';

export interface Actores {
  admin: Usuario;
  /** Adoptante principal: es la cuenta con la que se recorre toda la app mobile. */
  ana: Usuario;
  /** Operador de Refugio Patitas: la cuenta con la que se recorre el lado refugio. */
  bruno: Usuario;
  nico: Usuario;
  sofia: Usuario;
  carla: Usuario;
  diego: Usuario;
  elena: Usuario;
  martin: Usuario;
  lucia: Usuario;
  multirol: Usuario;
  patitas: Refugio;
  huellitas: Refugio;
  cuatroPatas: Refugio;
}

interface DatosUsuario {
  nombre: string;
  apellido: string;
  email: string;
  telefono?: string | null;
  dni?: string | null;
  fechaNacimiento?: Date;
  verificado?: boolean;
  imagenUrl?: string;
  ubicacion?: string;
  refugioId?: number;
  estado?: string;
  roles: string[];
  /** Baja lógica: la cuenta existe pero está inactiva. */
  baja?: boolean;
}

async function crearUsuario(catalogos: Catalogos, datos: DatosUsuario): Promise<Usuario> {
  const { sistemaId } = catalogos;

  const usuario = await prisma.usuario.upsert({
    where: { email: datos.email },
    update: {},
    create: {
      nombre: datos.nombre,
      apellido: datos.apellido,
      email: datos.email,
      contrasena: await hashContrasena(),
      telefono: datos.telefono ?? null,
      dni: datos.dni ?? null,
      fechaNacimiento: datos.fechaNacimiento ?? null,
      verificado: datos.verificado ?? true,
      imagenUrl: datos.imagenUrl ?? null,
      ubicacion: datos.ubicacion ?? null,
      refugioId: datos.refugioId ?? null,
      estadoId: id(catalogos.estadosUsuario, datos.estado ?? 'Activo'),
      usuarioAlta: sistemaId,
      ...(datos.baja ? { usuarioBaja: sistemaId, fechaBaja: new Date() } : {}),
    },
  });

  for (const rol of datos.roles) {
    await asignarRol(usuario.id, id(catalogos.roles, rol), sistemaId);
  }

  return usuario;
}

interface DatosRefugio {
  nombre: string;
  direccion: string;
  telefono?: string;
  email?: string;
  descripcion?: string;
  imagenUrl?: string;
  verificado?: boolean;
  estado?: string;
}

/** Refugio no tiene clave natural única: el nombre hace las veces de upsert. */
async function crearRefugio(catalogos: Catalogos, datos: DatosRefugio): Promise<Refugio> {
  const existente = await prisma.refugio.findFirst({
    where: { nombre: datos.nombre, fechaBaja: null },
  });
  if (existente) return existente;

  return prisma.refugio.create({
    data: {
      nombre: datos.nombre,
      direccion: datos.direccion,
      telefono: datos.telefono ?? null,
      email: datos.email ?? null,
      descripcion: datos.descripcion ?? null,
      imagenUrl: datos.imagenUrl ?? null,
      verificado: datos.verificado ?? true,
      estadoId: id(catalogos.estadosRefugio, datos.estado ?? 'Activo'),
      usuarioAlta: catalogos.sistemaId,
    },
  });
}

async function seedActoresPrincipales(catalogos: Catalogos): Promise<Actores> {
  const admin = await crearUsuario(catalogos, {
    nombre: 'Admin',
    apellido: 'PetHood',
    email: 'admin@pethood.test',
    telefono: '2610000000',
    dni: '20000000',
    roles: ['Administrador'],
  });

  // ── Refugios ──
  const patitas = await crearRefugio(catalogos, {
    nombre: 'Refugio Patitas',
    direccion: 'Av. San Martín 1234, Mendoza',
    telefono: '2612222222',
    email: 'contacto@patitas.test',
    descripcion:
      'Refugio de perros y gatos en la ciudad de Mendoza desde 2015. Trabajamos con ' +
      'hogares de tránsito, castraciones a bajo costo y adopciones responsables.',
    imagenUrl: foto('photo-1548199973-03cce0bbc87b'),
  });

  // Nombre largo a propósito: prueba el truncado con elipsis en los listados.
  const huellitas = await crearRefugio(catalogos, {
    nombre: 'Asociación Civil Huellitas del Sur de Mendoza',
    direccion: 'Av. Las Heras 500, Mendoza',
    telefono: '2614444444',
    email: 'hola@huellitasdelsur.test',
    descripcion: 'Rescate y rehabilitación de animales en situación de calle en el sur provincial.',
    imagenUrl: foto('photo-1587300003388-59208cc962cb'),
  });

  const cuatroPatas = await crearRefugio(catalogos, {
    nombre: 'Refugio Cuatro Patas',
    direccion: 'Ruta 60 km 12, Maipú',
    telefono: '2615555555',
    email: 'info@cuatropatas.test',
    descripcion: 'Refugio rural con espacio para perros grandes.',
  });

  // ── Adoptantes ──
  const ana = await crearUsuario(catalogos, {
    nombre: 'Ana',
    apellido: 'Gomez',
    email: 'adoptante@pethood.test',
    telefono: '2611111111',
    dni: '30111222',
    fechaNacimiento: nacioHace(31),
    imagenUrl: foto(FOTOS_PERSONA[0]!),
    ubicacion: 'Godoy Cruz, Mendoza',
    roles: ['Adoptante'],
  });

  const carla = await crearUsuario(catalogos, {
    nombre: 'Carla',
    apellido: 'Ruiz',
    email: 'carla@pethood.test',
    telefono: '2617000001',
    dni: '31222333',
    fechaNacimiento: nacioHace(27),
    imagenUrl: foto(FOTOS_PERSONA[2]!),
    ubicacion: 'Guaymallén, Mendoza',
    roles: ['Adoptante'],
  });

  const martin = await crearUsuario(catalogos, {
    nombre: 'Martín',
    apellido: 'Sosa',
    email: 'martin@pethood.test',
    telefono: '2617000002',
    dni: '33444555',
    fechaNacimiento: nacioHace(35),
    imagenUrl: foto(FOTOS_PERSONA[3]!),
    ubicacion: 'Luján de Cuyo, Mendoza',
    roles: ['Adoptante'],
  });

  const elena = await crearUsuario(catalogos, {
    nombre: 'Elena',
    apellido: 'Martinez',
    email: 'elena@pethood.test',
    telefono: '2617000003',
    dni: '31444555',
    fechaNacimiento: nacioHace(42),
    ubicacion: 'Las Heras, Mendoza',
    roles: ['Adoptante'],
  });

  const lucia = await crearUsuario(catalogos, {
    nombre: 'Lucía',
    apellido: 'Pereyra',
    email: 'lucia@pethood.test',
    telefono: '2617000004',
    dni: '38555666',
    fechaNacimiento: nacioHace(24),
    ubicacion: 'Maipú, Mendoza',
    roles: ['Adoptante'],
  });

  // Cuenta dada de baja: sus chats tienen que seguir visibles con el contacto inactivo.
  const diego = await crearUsuario(catalogos, {
    nombre: 'Diego',
    apellido: 'Fernandez',
    email: 'diego@pethood.test',
    telefono: '2617000005',
    dni: '31333444',
    roles: ['Adoptante'],
    baja: true,
  });

  // ── Operadores de refugio ──
  const bruno = await crearUsuario(catalogos, {
    nombre: 'Bruno',
    apellido: 'Diaz',
    email: 'refugio@pethood.test',
    telefono: '2613333333',
    dni: '28444555',
    fechaNacimiento: nacioHace(38),
    imagenUrl: foto(FOTOS_PERSONA[1]!),
    ubicacion: 'Ciudad de Mendoza',
    refugioId: patitas.id,
    roles: ['Refugio'],
  });

  const nico = await crearUsuario(catalogos, {
    nombre: 'Nico',
    apellido: 'Peralta',
    email: 'huellitas@pethood.test',
    telefono: '2617000006',
    dni: '31555666',
    refugioId: huellitas.id,
    roles: ['Refugio'],
  });

  const sofia = await crearUsuario(catalogos, {
    nombre: 'Sofia',
    apellido: 'Lopez',
    email: 'cuatropatas@pethood.test',
    telefono: '2617000007',
    dni: '31666777',
    refugioId: cuatroPatas.id,
    roles: ['Refugio'],
  });

  // Adoptante que además pertenece a un refugio: prueba la gestión de roles múltiples (HU-2.1).
  const multirol = await crearUsuario(catalogos, {
    nombre: 'Bruna',
    apellido: 'Salvatierra',
    email: 'multirol@pethood.test',
    telefono: '2617777777',
    dni: '39999999',
    refugioId: huellitas.id,
    roles: ['Adoptante', 'Refugio'],
  });

  return {
    admin,
    ana,
    bruno,
    nico,
    sofia,
    carla,
    diego,
    elena,
    martin,
    lucia,
    multirol,
    patitas,
    huellitas,
    cuatroPatas,
  };
}

const NOMBRES = [
  'Lucía',
  'Martín',
  'Sofía',
  'Diego',
  'Camila',
  'Javier',
  'Valentina',
  'Andrés',
  'Micaela',
  'Facundo',
  'Julieta',
  'Gonzalo',
  'Rocío',
  'Nicolás',
  'Agustina',
  'Emiliano',
];
const APELLIDOS = [
  'Fernández',
  'Rodríguez',
  'Sosa',
  'Pereyra',
  'Aguirre',
  'Molina',
  'Castro',
  'Ortega',
];
const PREFIJOS_REFUGIO = [
  'Huellitas',
  'Garritas',
  'Colitas',
  'Amigos de Cuatro Patas',
  'El Hogar de Tomás',
  'Vida Animal',
  'Segunda Oportunidad',
  'Corazón Mendoza',
  'La Casita de Fierro',
  'Puertas Abiertas',
  'Manada Feliz',
  'Despertar Animal',
];
const LOCALIDADES = ['Mendoza', 'Maipú', 'Luján de Cuyo', 'Godoy Cruz'];

const CANTIDAD_REFUGIOS = 24;
const CANTIDAD_VECINOS = 24;

/**
 * Escenarios por índice, ciclando para que cualquier página del listado mezcle casos:
 * Activo verificado | Activo sin verificar | Pendiente con datos completos (se puede
 * verificar desde la API) | Pendiente sin teléfono (DATOS_INCOMPLETOS) | Suspendido.
 */
function escenarioVecino(i: number) {
  switch (i % 5) {
    case 1:
      return { estado: 'Activo', verificado: false, sinTelefono: false };
    case 2:
      return { estado: 'Pendiente_Verificacion', verificado: false, sinTelefono: false };
    case 3:
      return { estado: 'Pendiente_Verificacion', verificado: false, sinTelefono: true };
    case 4:
      return { estado: 'Suspendido', verificado: true, sinTelefono: false };
    default:
      return { estado: 'Activo', verificado: true, sinTelefono: false };
  }
}

function escenarioRefugio(i: number) {
  switch (i % 4) {
    case 1:
      return { estado: 'Activo', verificado: false };
    case 2:
      return { estado: 'Pendiente_Verificacion', verificado: false };
    case 3:
      return { estado: 'Suspendido', verificado: i % 8 === 3 };
    default:
      return { estado: 'Activo', verificado: true };
  }
}

/** Lote para el panel admin: >20 filas por listado, con todos los estados que se filtran. */
async function seedLoteAdmin(catalogos: Catalogos) {
  for (let i = 1; i <= CANTIDAD_REFUGIOS; i += 1) {
    const prefijo = PREFIJOS_REFUGIO[i % PREFIJOS_REFUGIO.length]!;
    const localidad = LOCALIDADES[Math.floor(i / PREFIJOS_REFUGIO.length)]!;
    const escenario = escenarioRefugio(i);

    const refugio = await crearRefugio(catalogos, {
      nombre: `${prefijo} de ${localidad}`,
      direccion: `Calle ${i * 37} ${100 + i}, ${localidad}`,
      telefono: `2614${String(500000 + i * 137).slice(0, 6)}`,
      email: `contacto${i}@refugios.test`,
      descripcion: `Refugio barrial de ${localidad}.`,
      verificado: escenario.verificado,
      estado: escenario.estado,
    });

    // Operador: siempre Activo y verificado, como quedaría tras el alta desde el panel.
    await crearUsuario(catalogos, {
      nombre: NOMBRES[i % NOMBRES.length]!,
      apellido: APELLIDOS[i % APELLIDOS.length]!,
      email: `operador${i}@pethood.test`,
      telefono: `2615${String(600000 + i * 91).slice(0, 6)}`,
      dni: String(42000000 + i * 17),
      refugioId: refugio.id,
      roles: ['Refugio'],
    });
  }

  for (let i = 1; i <= CANTIDAD_VECINOS; i += 1) {
    const escenario = escenarioVecino(i);

    await crearUsuario(catalogos, {
      nombre: NOMBRES[(i * 3) % NOMBRES.length]!,
      apellido: APELLIDOS[(i * 5) % APELLIDOS.length]!,
      email: `vecino${i}@pethood.test`,
      telefono: escenario.sinTelefono ? null : `2616${String(700000 + i * 53).slice(0, 6)}`,
      dni: String(35000000 + i * 23),
      verificado: escenario.verificado,
      estado: escenario.estado,
      roles: ['Adoptante'],
    });
  }
}

export async function seedUsuarios(catalogos: Catalogos): Promise<Actores> {
  const actores = await seedActoresPrincipales(catalogos);
  await seedLoteAdmin(catalogos);

  log(
    `👥 Usuarios: 11 cuentas principales + ${CANTIDAD_REFUGIOS} operadores + ${CANTIDAD_VECINOS} vecinos; ` +
      `${3 + CANTIDAD_REFUGIOS} refugios`,
  );

  return actores;
}
