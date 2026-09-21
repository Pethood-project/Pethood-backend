import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import type { CategoriaBody, CategoriaPatch, FaqBody, FaqPatch } from './soporte.dto';

// ─────────────── Consultas ───────────────

export function crearConsulta(
  usuarioId: number,
  datos: { nombreCompleto: string; email: string; asunto: string; mensaje: string },
) {
  return prisma.consultaSoporte.create({ data: { ...datos, ...datosAlta(usuarioId) } });
}

export function listarConsultas(resuelta?: boolean) {
  return prisma.consultaSoporte.findMany({
    where: { fechaBaja: null, ...(resuelta !== undefined ? { resuelta } : {}) },
    orderBy: { id: 'desc' },
  });
}

export function buscarConsulta(id: number) {
  return prisma.consultaSoporte.findFirst({ where: { id, fechaBaja: null } });
}

export function resolverConsulta(id: number, usuarioId: number) {
  return prisma.consultaSoporte.update({
    where: { id },
    data: { resuelta: true, ...datosModificacion(usuarioId) },
  });
}

export function darDeBajaConsulta(id: number, usuarioId: number) {
  return prisma.consultaSoporte.update({ where: { id }, data: datosBaja(usuarioId) });
}

// ─────────────── Categorías ───────────────

export function listarCategorias() {
  return prisma.faqCategoria.findMany({ where: { fechaBaja: null }, orderBy: { nombre: 'asc' } });
}

/** Solo lo que ve el público: categorías y FAQs sin baja, ordenadas. */
export function listarCategoriasConFaqsActivas() {
  return prisma.faqCategoria.findMany({
    where: { fechaBaja: null },
    orderBy: { nombre: 'asc' },
    include: {
      faqs: { where: { fechaBaja: null }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
    },
  });
}

export function buscarCategoria(id: number) {
  return prisma.faqCategoria.findFirst({ where: { id, fechaBaja: null } });
}

export function contarFaqsActivasDeCategoria(faqCategoriaId: number) {
  return prisma.faq.count({ where: { faqCategoriaId, fechaBaja: null } });
}

export function crearCategoria(usuarioId: number, datos: CategoriaBody) {
  return prisma.faqCategoria.create({ data: { ...datos, ...datosAlta(usuarioId) } });
}

export function editarCategoria(id: number, usuarioId: number, datos: CategoriaPatch) {
  return prisma.faqCategoria.update({
    where: { id },
    data: { ...datos, ...datosModificacion(usuarioId) },
  });
}

export function darDeBajaCategoria(id: number, usuarioId: number) {
  return prisma.faqCategoria.update({ where: { id }, data: datosBaja(usuarioId) });
}

// ─────────────── FAQs ───────────────

export function buscarFaq(id: number) {
  return prisma.faq.findFirst({ where: { id, fechaBaja: null } });
}

export function crearFaq(usuarioId: number, datos: FaqBody) {
  return prisma.faq.create({ data: { ...datos, ...datosAlta(usuarioId) } });
}

export function editarFaq(id: number, usuarioId: number, datos: FaqPatch) {
  return prisma.faq.update({ where: { id }, data: { ...datos, ...datosModificacion(usuarioId) } });
}

export function darDeBajaFaq(id: number, usuarioId: number) {
  return prisma.faq.update({ where: { id }, data: datosBaja(usuarioId) });
}
