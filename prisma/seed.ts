// Seed único de PetHood: `npm run seed` (también corre con `prisma db seed` / `migrate reset`).
//
// Deja la base lista para recorrer TODA la app con datos coherentes: catálogos, cuentas,
// refugios, mascotas con historia clínica, feed de adopción, favoritos, solicitudes en todos
// los estados con hogar y seguimiento post-adopción, chats, campañas con donaciones, reseñas,
// reportes de moderación y animales perdidos.
//
// Idempotente: se puede correr N veces sin duplicar filas (cada módulo busca por su clave
// natural antes de crear). En producción solo se siembran catálogos y el usuario SISTEMA.
//
// Cuentas (contraseña `Pethood123` para todas):
//   admin@pethood.test       Administrador — panel web-admin
//   adoptante@pethood.test   Ana Gomez — adoptante con favoritos, solicitudes, seguimientos, chats
//   refugio@pethood.test     Bruno Diaz — operador de Refugio Patitas (dashboard refugio)
//   huellitas@pethood.test   Nico Peralta — operador de Huellitas del Sur
//   carla@ / martin@ / elena@ / lucia@pethood.test — otros adoptantes con solicitudes
//   multirol@pethood.test    Adoptante + Refugio (gestión de roles múltiples)
import { cargarCatalogos, seedCatalogos } from './seed/catalogos';
import { seedChats } from './seed/chats';
import { CONTRASENA_PRUEBA, esProduccion, log, prisma } from './seed/comun';
import { seedComunidad } from './seed/comunidad';
import { seedFavoritos } from './seed/favoritos';
import { seedMascotas } from './seed/mascotas';
import { seedSolicitudes } from './seed/solicitudes';
import { seedSoporte } from './seed/soporte';
import { seedUsuarios } from './seed/usuarios';

async function main() {
  const sistemaId = await seedCatalogos();
  log(`📚 Catálogos listos. Usuario SISTEMA id=${sistemaId}`);

  if (esProduccion) {
    log('⏭️  NODE_ENV=production: se omiten los datos de demo.');
    return;
  }

  const catalogos = await cargarCatalogos(sistemaId);

  // El orden importa: cada paso referencia lo que creó el anterior.
  const actores = await seedUsuarios(catalogos);
  const mascotas = await seedMascotas(catalogos, actores);
  await seedFavoritos(actores, mascotas);
  await seedSolicitudes(catalogos, actores, mascotas);
  await seedChats(sistemaId, actores);
  await seedComunidad(catalogos, actores, mascotas);
  await seedSoporte(sistemaId);

  log('');
  log('✅ Seed completo.');
  log(`🔑 Contraseña de todas las cuentas: ${CONTRASENA_PRUEBA}`);
  log('   Mobile:    adoptante@pethood.test (Ana) · refugio@pethood.test (Bruno, Patitas)');
  log('   Web-admin: admin@pethood.test (admin) · refugio@pethood.test (dashboard refugio)');
}

main()
  .catch((err) => {
    console.error('❌ Error corriendo el seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
