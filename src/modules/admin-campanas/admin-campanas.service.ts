import { AppError } from '../../middlewares/errorHandler';
import type { FiltrosCampanas } from './admin-campanas.dto';
import * as repo from './admin-campanas.repository';
import type { CampanaAdmin } from './admin-campanas.repository';

function aItemDto(c: CampanaAdmin) {
  return {
    id: c.id,
    titulo: c.titulo,
    objetivo: c.objetivo.toString(),
    fechaInicio: c.fechaInicio,
    fechaFin: c.fechaFin,
    imagenUrl: c.imagenUrl,
    estado: { id: c.estadoCampania.id, nombre: c.estadoCampania.nombre },
    refugio: c.refugio,
    fechaAlta: c.fechaAlta,
  };
}

export async function listar(filtros: FiltrosCampanas) {
  const { items, total } = await repo.listar(filtros);
  return { items: items.map(aItemDto), total, page: filtros.page, limit: filtros.limit };
}

export async function obtener(id: number) {
  const c = await repo.buscar(id);
  if (!c) throw new AppError('NO_ENCONTRADO', 'No encontramos esa campaña.', 404);

  const donaciones = await repo.resumenDonaciones(id);

  return {
    ...aItemDto(c),
    descripcion: c.descripcion,
    donaciones: {
      cantidad: donaciones._count._all,
      montoDeclarado: (donaciones._sum.monto ?? 0).toString(),
    },
  };
}
