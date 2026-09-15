// Revierte lo que crea prisma/seed-solicitudes.ts. Borra en orden inverso a la creación
// (hijos antes que padres) para no romper FKs. DELETE físico a propósito: son datos de
// prueba de un fixture, no datos de negocio reales (no aplica la regla de baja lógica).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOMBRES_MASCOTAS_FIXTURE = [
  'Solicitudes Fixture Toby',
  'Solicitudes Fixture Nina',
  'Solicitudes Fixture Rocky',
  'Solicitudes Fixture Luna',
  'Solicitudes Fixture Rex',
  'Solicitudes Fixture Mia (personal)',
];

const EMAILS_USUARIOS_FIXTURE = [
  'solicitudes-fixture-publicador@pethood.test',
  'solicitudes-fixture-solicitante@pethood.test',
];

async function main() {
  const mascotas = await prisma.mascota.findMany({
    where: { nombre: { in: NOMBRES_MASCOTAS_FIXTURE } },
    select: { id: true },
  });
  const mascotaIds = mascotas.map((m) => m.id);

  const publicaciones = await prisma.publicacion.findMany({
    where: { mascotaId: { in: mascotaIds } },
    select: { id: true },
  });
  const publicacionIds = publicaciones.map((p) => p.id);

  const solicitudes = await prisma.solicitud.findMany({
    where: { publicacionId: { in: publicacionIds } },
    select: { id: true },
  });
  const solicitudIds = solicitudes.map((s) => s.id);

  const usuariosFixture = await prisma.usuario.findMany({
    where: { email: { in: EMAILS_USUARIOS_FIXTURE } },
    select: { id: true },
  });
  const usuarioIds = usuariosFixture.map((u) => u.id);

  const { count: countSeguimiento } = await prisma.seguimiento.deleteMany({
    where: { solicitudId: { in: solicitudIds } },
  });
  const { count: countSolicitudEstado } = await prisma.solicitudEstado.deleteMany({
    where: { solicitudId: { in: solicitudIds } },
  });
  const { count: countSolicitud } = await prisma.solicitud.deleteMany({
    where: { id: { in: solicitudIds } },
  });
  const { count: countPublicacion } = await prisma.publicacion.deleteMany({
    where: { id: { in: publicacionIds } },
  });
  const { count: countFavorito } = await prisma.favorito.deleteMany({
    where: { mascotaId: { in: mascotaIds } },
  });
  const { count: countMascotaEstado } = await prisma.mascotaEstado.deleteMany({
    where: { mascotaId: { in: mascotaIds } },
  });
  const { count: countMascota } = await prisma.mascota.deleteMany({
    where: { id: { in: mascotaIds } },
  });
  const { count: countRolUsuario } = await prisma.rolUsuario.deleteMany({
    where: { usuarioId: { in: usuarioIds } },
  });
  const { count: countUsuario } = await prisma.usuario.deleteMany({
    where: { id: { in: usuarioIds } },
  });

  console.log('🧹 Borrado de fixtures de seed-solicitudes:');
  console.log(`  seguimiento: ${countSeguimiento}`);
  console.log(`  solicitud_estado: ${countSolicitudEstado}`);
  console.log(`  solicitud: ${countSolicitud}`);
  console.log(`  publicacion: ${countPublicacion}`);
  console.log(`  favorito: ${countFavorito}`);
  console.log(`  mascota_estado: ${countMascotaEstado}`);
  console.log(`  mascota: ${countMascota}`);
  console.log(`  rol_usuario: ${countRolUsuario}`);
  console.log(`  usuario: ${countUsuario}`);
  console.log('✅ Listo.');
}

main()
  .catch((err) => {
    console.error('❌ Error corriendo clean-seed-solicitudes:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
