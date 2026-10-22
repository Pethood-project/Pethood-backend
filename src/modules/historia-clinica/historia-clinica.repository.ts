import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja } from '../../shared/auditoria';
import { SELECT_VACUNA } from '../../shared/vacunas';

export interface DatosNuevaHistoriaClinica {
  fechaVisita: Date;
  fechaProxima: Date | null;
  requiereRevision: boolean;
  vacunacion: boolean;
  vacunaId: number | null;
  titulo: string;
  descripcion: string;
  documentoUrl: string | null;
  mascotaId: number;
}

/** El código de la vacuna viaja en el DTO como `tipoVacuna` (spec 029). */
const CON_VACUNA = { vacuna: { select: { codigo: true } } } as const;

export function crear(datos: DatosNuevaHistoriaClinica, usuarioAlta: number) {
  return prisma.historiaClinica.create({
    data: { ...datos, ...datosAlta(usuarioAlta) },
    include: CON_VACUNA,
  });
}

/**
 * Mascota activa por id, con lo necesario para resolver el permiso de acceso y para validar
 * una vacuna (especie y fecha de nacimiento).
 */
export function buscarMascota(mascotaId: number) {
  return prisma.mascota.findFirst({
    where: { id: mascotaId, fechaBaja: null },
    select: {
      id: true,
      usuarioId: true,
      refugioId: true,
      fechaNacimiento: true,
      raza: { select: { especieId: true } },
    },
  });
}

/** Vacuna activa del catálogo con ese código y asociada a esa especie (spec 029), o null. */
export function buscarVacunaDeEspecie(codigo: string, especieId: number) {
  return prisma.vacuna.findFirst({
    where: {
      codigo,
      fechaBaja: null,
      especies: { some: { especieId, fechaBaja: null } },
    },
    select: SELECT_VACUNA,
  });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

/** Historial vigente de una mascota, más reciente primero. */
export function listarPorMascota(mascotaId: number) {
  return prisma.historiaClinica.findMany({
    where: { mascotaId, fechaBaja: null },
    orderBy: { fechaVisita: 'desc' },
    include: CON_VACUNA,
  });
}

/** Registro vigente por id, sin filtrar por mascota: la propiedad la chequea el servicio. */
export function buscarPorId(historiaClinicaId: number) {
  return prisma.historiaClinica.findFirst({
    where: { id: historiaClinicaId, fechaBaja: null },
    include: CON_VACUNA,
  });
}

/**
 * "Modificar" (HU-8.3) nunca actualiza: da de baja el registro anterior y crea el nuevo con
 * los datos ya fusionados, en una sola transacción.
 */
export function reemplazar(
  anteriorId: number,
  datosNuevo: DatosNuevaHistoriaClinica,
  usuarioActor: number,
) {
  return prisma.$transaction(async (tx) => {
    await tx.historiaClinica.update({
      where: { id: anteriorId },
      data: datosBaja(usuarioActor),
    });

    return tx.historiaClinica.create({
      data: { ...datosNuevo, ...datosAlta(usuarioActor) },
      include: CON_VACUNA,
    });
  });
}

/** HU-8.4: baja lógica simple, sin alta de reemplazo. */
export function darDeBaja(historiaClinicaId: number, usuarioBaja: number) {
  return prisma.historiaClinica.update({
    where: { id: historiaClinicaId },
    data: datosBaja(usuarioBaja),
  });
}
