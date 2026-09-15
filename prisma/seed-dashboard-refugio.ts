// Fixtures operativos para probar las agregaciones del dashboard REFUGIO (spec 010, Fase 12).
// Para el dashboard admin ver prisma/seed-dashboard-admin.ts (spec 009) — mismo criterio.
//
// Deliberadamente separado de seed.ts: este repo lo tocan varias personas y prisma.seed
// (npx prisma db seed / migrate reset) corre seed.ts automáticamente para todos. Estos datos
// son solo para desarrollar/probar el dashboard — no deben imponerse a quien está trabajando
// otra fase. Se corre a mano, después de `npm run seed`: npx tsx prisma/seed-dashboard-refugio.ts
//
// Reutiliza el mismo Refugio (id=1) y usuario refugio@pethood.test que crea seed.ts — así
// alcanza con este único seed para poblar el dashboard de ese refugio sin duplicar cuentas.
// Idempotente igual que seed.ts (findFirst + create) aunque Mascota/Solicitud/Campania no
// tengan clave única natural para un upsert real.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Fechas distribuidas en los últimos 6 meses, para poblar donacionesPorMes y solicitudesPorEstado. */
function haceMeses(cantidad: number, dia = 15): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() - cantidad, dia);
}

/** Para poblar publicacionesPorAntiguedad (spec 010 §7) con sus 4 buckets, no solo "0-15 días". */
function haceDias(cantidad: number): Date {
  return new Date(Date.now() - cantidad * 86_400_000);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('⏭️  NODE_ENV=production: seed-dashboard-refugio no corre (son datos de prueba).');
    return;
  }

  const sistema = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'sistema@pethood.internal' },
  });
  const adoptante = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'adoptante@pethood.test' },
  });
  const usuarioRefugio = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'refugio@pethood.test' },
  });
  const refugio = await prisma.refugio.findUniqueOrThrow({ where: { id: 1 } });
  const raza = await prisma.raza.findFirstOrThrow({ where: { nombre: 'Mestizo' } });
  const tipoAdopcion = await prisma.tipoSolicitud.findUniqueOrThrow({
    where: { nombre: 'Adopcion' },
  });

  const usuarioAlta = sistema.id;

  const mascotas = await seedMascotas(usuarioAlta, refugio.id, usuarioRefugio.id, raza.id);
  const publicables = mascotas.filter((m) =>
    ['Disponible', 'En_Tratamiento', 'En_Transito', 'Adoptado'].includes(m.estadoNombre),
  );
  const publicaciones = await seedPublicaciones(usuarioAlta, usuarioRefugio.id, publicables);
  await seedSolicitudes(usuarioAlta, adoptante.id, tipoAdopcion.id, publicaciones);
  await seedCampaniaYDonaciones(usuarioAlta, refugio.id, adoptante.id);

  console.log('🔑 Cuenta refugio de prueba: refugio@pethood.test — Pethood123');
  console.log('✅ seed-dashboard-refugio completo.');
}

async function seedMascotas(
  usuarioAlta: number,
  refugioId: number,
  usuarioId: number,
  razaId: number,
) {
  const estados = await prisma.estadoMascota.findMany();
  const estadoIdPorNombre = new Map(estados.map((e) => [e.nombre, e.id]));

  const definiciones = [
    { nombre: 'Dashboard Refugio Kiwi', estadoNombre: 'Disponible', diasAtras: 3 },
    { nombre: 'Dashboard Refugio Manchas', estadoNombre: 'Disponible', diasAtras: 20 },
    { nombre: 'Dashboard Refugio Simba', estadoNombre: 'En_Tratamiento', diasAtras: 45 },
    { nombre: 'Dashboard Refugio Coco', estadoNombre: 'En_Transito', diasAtras: 75 },
    { nombre: 'Dashboard Refugio Pipo', estadoNombre: 'Adoptado', diasAtras: 10 },
    { nombre: 'Dashboard Refugio Estrella', estadoNombre: 'Adoptado', diasAtras: 5 },
  ];

  const resultado: { id: number; estadoNombre: string; diasAtras: number }[] = [];

  for (const def of definiciones) {
    let mascota = await prisma.mascota.findFirst({ where: { nombre: def.nombre } });
    if (!mascota) {
      mascota = await prisma.mascota.create({
        data: {
          nombre: def.nombre,
          genero: 'HEMBRA',
          razaId,
          refugioId,
          usuarioId,
          usuarioAlta,
        },
      });
      await prisma.mascotaEstado.create({
        data: {
          mascotaId: mascota.id,
          estadoMascotaId: estadoIdPorNombre.get(def.estadoNombre)!,
          usuarioAlta,
          fechaAlta: haceDias(def.diasAtras),
        },
      });
    }
    resultado.push({ id: mascota.id, estadoNombre: def.estadoNombre, diasAtras: def.diasAtras });
  }

  return resultado;
}

/**
 * fechaAlta de cada publicación = mismo diasAtras que su MascotaEstado (variedad ya pensada para
 * cubrir los 4 buckets de mascotasPorAntiguedad), así también cubre los 4 buckets nuevos de
 * publicacionesPorAntiguedad (0-15/15-30/30-60/+60 días) sin fixtures separados.
 */
async function seedPublicaciones(
  usuarioAlta: number,
  usuarioId: number,
  mascotas: { id: number; diasAtras: number }[],
) {
  const publicaciones = [];
  for (const mascota of mascotas) {
    let publicacion = await prisma.publicacion.findFirst({ where: { mascotaId: mascota.id } });
    if (!publicacion) {
      publicacion = await prisma.publicacion.create({
        data: {
          titulo: `Dashboard refugio — mascota ${mascota.id}`,
          mascotaId: mascota.id,
          usuarioId,
          usuarioAlta,
          fechaAlta: haceDias(mascota.diasAtras),
        },
      });
    }
    publicaciones.push(publicacion);
  }
  return publicaciones;
}

/**
 * 5 solicitudes cubriendo los 5 EstadoSolicitud, con fechaAlta escalonada en los últimos meses
 * (no todas "hoy") para que el filtro por período del dashboard tenga algo real que recortar.
 */
async function seedSolicitudes(
  usuarioAlta: number,
  usuarioId: number,
  tipoSolicitudId: number,
  publicaciones: { id: number }[],
) {
  const estados = await prisma.estadoSolicitud.findMany();
  const definiciones = [
    { nombreEstado: 'Aprobada', mesesAtras: 4 },
    { nombreEstado: 'Aprobada', mesesAtras: 1 },
    { nombreEstado: 'Pendiente', mesesAtras: 0 },
    { nombreEstado: 'En_Revision', mesesAtras: 2 },
    { nombreEstado: 'Rechazada', mesesAtras: 3 },
  ];

  for (let i = 0; i < definiciones.length && i < publicaciones.length; i++) {
    const publicacionId = publicaciones[i].id;
    const def = definiciones[i]!;
    let solicitud = await prisma.solicitud.findFirst({ where: { publicacionId, usuarioId } });
    if (!solicitud) {
      const fechaAlta = haceMeses(def.mesesAtras);
      solicitud = await prisma.solicitud.create({
        data: {
          motivacion:
            'Fixture de dashboard refugio para probar agregaciones (seed-dashboard-refugio.ts).',
          publicacionId,
          usuarioId,
          tipoSolicitudId,
          usuarioAlta,
          fechaAlta,
        },
      });
      const estadoId = estados.find((e) => e.nombre === def.nombreEstado)!.id;
      await prisma.solicitudEstado.create({
        data: {
          solicitudId: solicitud.id,
          estadoSolicitudId: estadoId,
          usuarioAlta,
          fechaAlta,
        },
      });
    }
  }
}

/** Una campaña activa con donaciones repartidas en varios meses, para poblar donacionesPorMes. */
async function seedCampaniaYDonaciones(usuarioAlta: number, refugioId: number, donanteId: number) {
  const estadoActiva = await prisma.estadoCampania.findUniqueOrThrow({
    where: { nombre: 'Activa' },
  });

  let campania = await prisma.campania.findFirst({
    where: { titulo: 'Dashboard Refugio Campaña' },
  });
  if (!campania) {
    const hoy = new Date();
    const enDosMeses = new Date(hoy);
    enDosMeses.setMonth(enDosMeses.getMonth() + 2);
    campania = await prisma.campania.create({
      data: {
        titulo: 'Dashboard Refugio Campaña',
        descripcion: 'Fixture de dashboard refugio (seed-dashboard-refugio.ts).',
        objetivo: 60000,
        fechaInicio: haceMeses(5),
        fechaFin: enDosMeses,
        refugioId,
        estadoCampaniaId: estadoActiva.id,
        usuarioAlta,
      },
    });
  }

  const definiciones = [
    { mesesAtras: 5, monto: 5000 },
    { mesesAtras: 3, monto: 8000 },
    { mesesAtras: 1, monto: 12000 },
    { mesesAtras: 0, monto: 6000 },
  ];

  for (const def of definiciones) {
    const fechaAlta = haceMeses(def.mesesAtras);
    const existente = await prisma.donacion.findFirst({
      where: { campaniaId: campania.id, usuarioId: donanteId, fechaAlta },
    });
    if (!existente) {
      await prisma.donacion.create({
        data: {
          monto: def.monto,
          campaniaId: campania.id,
          usuarioId: donanteId,
          usuarioAlta,
          fechaAlta,
        },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error('❌ Error corriendo seed-dashboard-refugio:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
