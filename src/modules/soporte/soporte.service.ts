import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { registrarAuditoria } from '../../shared/logAuditoria';
import type {
  CategoriaBody,
  CategoriaPatch,
  ConsultaBody,
  FaqBody,
  FaqPatch,
  FiltrosConsultas,
} from './soporte.dto';
import * as repo from './soporte.repository';

type Consulta = NonNullable<Awaited<ReturnType<typeof repo.buscarConsulta>>>;
type Faq = NonNullable<Awaited<ReturnType<typeof repo.buscarFaq>>>;
type Categoria = NonNullable<Awaited<ReturnType<typeof repo.buscarCategoria>>>;

function aConsultaDto(c: Consulta) {
  return {
    id: c.id,
    nombreCompleto: c.nombreCompleto,
    email: c.email,
    asunto: c.asunto,
    mensaje: c.mensaje,
    resuelta: c.resuelta,
    fechaAlta: c.fechaAlta,
  };
}

function aCategoriaDto(c: Categoria) {
  return { id: c.id, nombre: c.nombre, descripcion: c.descripcion };
}

function aFaqDto(f: Faq) {
  return {
    id: f.id,
    pregunta: f.pregunta,
    respuesta: f.respuesta,
    orden: f.orden,
    faqCategoriaId: f.faqCategoriaId,
  };
}

async function consultaOFallar(id: number): Promise<Consulta> {
  const consulta = await repo.buscarConsulta(id);
  if (!consulta) throw new AppError('CONSULTA_NO_ENCONTRADA', 'No encontramos esa consulta.', 404);
  return consulta;
}

async function categoriaOFallar(id: number): Promise<Categoria> {
  const categoria = await repo.buscarCategoria(id);
  if (!categoria)
    throw new AppError('CATEGORIA_NO_ENCONTRADA', 'No encontramos esa categoría.', 404);
  return categoria;
}

async function faqOFallar(id: number): Promise<Faq> {
  const faq = await repo.buscarFaq(id);
  if (!faq) throw new AppError('FAQ_NO_ENCONTRADA', 'No encontramos esa pregunta frecuente.', 404);
  return faq;
}

// ─────────────── Consultas (HU-15.2) ───────────────

/** Sin sesión no hay autor: `usuario_alta` es SISTEMA (mismo criterio que los cron jobs). */
export async function enviarConsulta(datos: ConsultaBody): Promise<{ mensaje: string }> {
  await repo.crearConsulta(USUARIO_SISTEMA_ID, datos);
  return { mensaje: 'Su consulta ha sido enviada con éxito' };
}

export async function listarConsultas(filtros: FiltrosConsultas) {
  return (await repo.listarConsultas(filtros.resuelta)).map(aConsultaDto);
}

export async function resolverConsulta(adminId: number, id: number) {
  const consulta = await consultaOFallar(id);
  if (consulta.resuelta) {
    throw new AppError('CONSULTA_YA_RESUELTA', 'Esa consulta ya está resuelta.', 409);
  }

  const resuelta = await repo.resolverConsulta(id, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'RESOLVER_CONSULTA_SOPORTE',
    entidad: 'ConsultaSoporte',
    entidadId: id,
  });
  return aConsultaDto(resuelta);
}

export async function darDeBajaConsulta(adminId: number, id: number): Promise<void> {
  await consultaOFallar(id);
  await repo.darDeBajaConsulta(id, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_CONSULTA_SOPORTE',
    entidad: 'ConsultaSoporte',
    entidadId: id,
  });
}

// ─────────────── FAQs públicas (HU-15.1) ───────────────

export async function listarFaqsPublicas() {
  const categorias = await repo.listarCategoriasConFaqsActivas();
  return categorias
    .filter((c) => c.faqs.length > 0)
    .map((c) => ({
      ...aCategoriaDto(c),
      faqs: c.faqs.map((f) => ({
        id: f.id,
        pregunta: f.pregunta,
        respuesta: f.respuesta,
        orden: f.orden,
      })),
    }));
}

// ─────────────── Categorías (HU-15.3) ───────────────

export async function listarCategorias() {
  return (await repo.listarCategorias()).map(aCategoriaDto);
}

export async function crearCategoria(adminId: number, datos: CategoriaBody) {
  const categoria = await repo.crearCategoria(adminId, datos);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'ALTA_FAQ_CATEGORIA',
    entidad: 'FaqCategoria',
    entidadId: categoria.id,
  });
  return aCategoriaDto(categoria);
}

export async function editarCategoria(adminId: number, id: number, datos: CategoriaPatch) {
  await categoriaOFallar(id);
  const categoria = await repo.editarCategoria(id, adminId, datos);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'EDITAR_FAQ_CATEGORIA',
    entidad: 'FaqCategoria',
    entidadId: id,
  });
  return aCategoriaDto(categoria);
}

export async function darDeBajaCategoria(adminId: number, id: number): Promise<void> {
  await categoriaOFallar(id);
  if ((await repo.contarFaqsActivasDeCategoria(id)) > 0) {
    throw new AppError(
      'CATEGORIA_CON_FAQS',
      'La categoría tiene preguntas activas. Dalas de baja o movelas antes.',
      409,
    );
  }

  await repo.darDeBajaCategoria(id, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_FAQ_CATEGORIA',
    entidad: 'FaqCategoria',
    entidadId: id,
  });
}

// ─────────────── FAQs (HU-15.3) ───────────────

export async function crearFaq(adminId: number, datos: FaqBody) {
  await categoriaOFallar(datos.faqCategoriaId);
  const faq = await repo.crearFaq(adminId, datos);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'ALTA_FAQ',
    entidad: 'Faq',
    entidadId: faq.id,
  });
  return aFaqDto(faq);
}

export async function editarFaq(adminId: number, id: number, datos: FaqPatch) {
  await faqOFallar(id);
  if (datos.faqCategoriaId !== undefined) await categoriaOFallar(datos.faqCategoriaId);

  const faq = await repo.editarFaq(id, adminId, datos);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'EDITAR_FAQ',
    entidad: 'Faq',
    entidadId: id,
  });
  return aFaqDto(faq);
}

export async function darDeBajaFaq(adminId: number, id: number): Promise<void> {
  await faqOFallar(id);
  await repo.darDeBajaFaq(id, adminId);
  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_FAQ',
    entidad: 'Faq',
    entidadId: id,
  });
}
