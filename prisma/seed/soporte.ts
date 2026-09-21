// FAQs de soporte (spec 015, HU-15.3). Parten del contenido que tenía el mock del web-admin
// (sin categorías, por eso se agruparon por tema), corregido contra REQUISITOS.md y las specs.
// Los textos son provisorios: el admin los edita desde web-admin.
import { log, prisma } from './comun';

interface DefCategoria {
  nombre: string;
  descripcion: string;
  faqs: { pregunta: string; respuesta: string }[];
}

const CATEGORIAS: DefCategoria[] = [
  {
    nombre: 'General',
    descripcion: 'Qué es PetHood y cómo funcionan las donaciones',
    faqs: [
      {
        pregunta: '¿Qué es PetHood?',
        respuesta:
          'Una plataforma que conecta adoptantes, refugios y ONGs, y les da un lugar común para publicar mascotas, gestionar solicitudes y hacer el seguimiento posterior.',
      },
      {
        pregunta: '¿Cómo funcionan las donaciones?',
        respuesta:
          'Los refugios crean campañas de donación y aportar es voluntario. El monto que declarás recién suma a la campaña cuando el refugio confirma que recibió tu donación.',
      },
    ],
  },
  {
    nombre: 'Refugios y ONGs',
    descripcion: 'Registro y verificación de refugios',
    faqs: [
      {
        pregunta: '¿Cómo registro mi refugio u ONG?',
        respuesta:
          'Registrate desde la app y elegí el rol Refugio. Tu cuenta queda pendiente de verificación hasta que el equipo de administración la apruebe.',
      },
      {
        pregunta: '¿Cuánto tarda la verificación?',
        respuesta:
          'No hay un plazo fijo: depende de que el equipo de administración revise tus datos. Mientras tanto podés completar el perfil, pero no publicar mascotas.',
      },
    ],
  },
  {
    nombre: 'Adopciones',
    descripcion: 'Cómo adoptar y el seguimiento posterior',
    faqs: [
      {
        pregunta: '¿Cómo adopto una mascota?',
        respuesta:
          'Desde la app móvil buscás una mascota, enviás la solicitud al refugio y coordinás por el chat. Para solicitar tenés que tener tu cuenta verificada y no podés tener más de 5 solicitudes pendientes a la vez. Después de adoptar, hacés el seguimiento con pruebas de vida.',
      },
      {
        pregunta: '¿Qué es una prueba de vida?',
        respuesta:
          'Una foto tomada en el momento con la cámara de la app (no se puede subir desde la galería), que confirma cómo está la mascota durante el seguimiento post-adopción.',
      },
    ],
  },
  {
    nombre: 'Comunidad y seguridad',
    descripcion: 'Mascotas perdidas y moderación',
    faqs: [
      {
        pregunta: '¿Puedo reportar una mascota perdida o encontrada?',
        respuesta:
          'Sí. Cargás la publicación con la provincia y localidad, y otras personas pueden verla y contactarte.',
      },
      {
        pregunta: '¿Cómo denuncio una publicación o a un usuario?',
        respuesta:
          'Desde cada publicación, perfil o reseña hay una opción de reportar. El equipo de administración modera los reportes.',
      },
    ],
  },
];

/**
 * Idempotente: la categoría se busca por nombre y cada FAQ por (categoría, orden), y si ya
 * existe se le actualiza el texto. Es seed de demo: volver a correrlo pisa lo editado en web-admin.
 */
export async function seedSoporte(sistemaId: number) {
  let faqsNuevas = 0;

  for (const def of CATEGORIAS) {
    const categoria =
      (await prisma.faqCategoria.findFirst({ where: { nombre: def.nombre, fechaBaja: null } })) ??
      (await prisma.faqCategoria.create({
        data: { nombre: def.nombre, descripcion: def.descripcion, usuarioAlta: sistemaId },
      }));

    for (const [indice, faq] of def.faqs.entries()) {
      const orden = indice + 1;
      const existente = await prisma.faq.findFirst({
        where: { faqCategoriaId: categoria.id, orden, fechaBaja: null },
      });

      if (existente) {
        await prisma.faq.update({
          where: { id: existente.id },
          data: { ...faq, usuarioModificacion: sistemaId, fechaModificacion: new Date() },
        });
        continue;
      }

      await prisma.faq.create({
        data: { ...faq, orden, faqCategoriaId: categoria.id, usuarioAlta: sistemaId },
      });
      faqsNuevas += 1;
    }
  }

  const total = CATEGORIAS.reduce((suma, c) => suma + c.faqs.length, 0);
  log(`❓ FAQs: ${total} en ${CATEGORIAS.length} categorías (${faqsNuevas} nuevas)`);
}
