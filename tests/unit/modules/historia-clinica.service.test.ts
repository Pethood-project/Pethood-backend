import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/historia-clinica/historia-clinica.repository';
import * as service from '../../../src/modules/historia-clinica/historia-clinica.service';
import { borrarImagen, guardarImagen } from '../../../src/shared/storage';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import type { CrearHistoriaClinicaDto } from '../../../src/modules/historia-clinica/historia-clinica.dto';

vi.mock('../../../src/modules/historia-clinica/historia-clinica.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');

const ARCHIVO = { buffer: Buffer.from('doc'), mimetype: 'application/pdf' };

const DATOS: CrearHistoriaClinicaDto = {
  fechaVisita: new Date(2026, 2, 1),
  fechaProxima: null,
  requiereRevision: false,
  vacunacion: false,
  titulo: 'Control anual',
  descripcion: 'Todo bien',
};

const MASCOTA_ADOPTANTE = { id: 10, usuarioId: 2, refugioId: null };
const MASCOTA_REFUGIO = { id: 11, usuarioId: 3, refugioId: 1 };

const ADOPTANTE = { id: 2, refugioId: null };
const OTRO_ADOPTANTE = { id: 99, refugioId: null };
const STAFF_REFUGIO = { id: 4, refugioId: 1 };
const STAFF_OTRO_REFUGIO = { id: 5, refugioId: 2 };

const REGISTRO_GUARDADO = {
  id: 100,
  fechaVisita: new Date(2026, 2, 1),
  fechaProxima: null,
  requiereRevision: false,
  vacunacion: false,
  titulo: 'Control anual',
  descripcion: 'Todo bien',
  documentoUrl: null,
  mascotaId: 10,
  usuarioAlta: 2,
  fechaAlta: new Date(2026, 2, 1),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(guardarImagen).mockResolvedValue('/api/v1/archivos/historias-clinicas/x.pdf');
});

describe('crearHistoriaClinica — acceso', () => {
  it('404 si la mascota no existe', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(null as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);

    await expect(service.crearHistoriaClinica(10, DATOS, { usuarioId: 2 })).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('403 si el usuario no está asociado a la mascota', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(OTRO_ADOPTANTE as never);

    await expect(service.crearHistoriaClinica(10, DATOS, { usuarioId: 99 })).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
    });
  });

  it('permite al dueño directo de la mascota', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.crear).mockResolvedValue(REGISTRO_GUARDADO as never);

    await expect(service.crearHistoriaClinica(10, DATOS, { usuarioId: 2 })).resolves.toMatchObject({
      id: 100,
    });
  });

  it('permite a un integrante del refugio dueño', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_REFUGIO as never);
    vi.mocked(repo.crear).mockResolvedValue({ ...REGISTRO_GUARDADO, mascotaId: 11 } as never);

    await expect(service.crearHistoriaClinica(11, DATOS, { usuarioId: 4 })).resolves.toMatchObject({
      mascotaId: 11,
    });
  });

  it('rechaza a un integrante de otro refugio', async () => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_OTRO_REFUGIO as never);

    await expect(service.crearHistoriaClinica(11, DATOS, { usuarioId: 5 })).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
    });
  });
});

describe('crearHistoriaClinica — documento', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
  });

  it('se guarda sin documento', async () => {
    vi.mocked(repo.crear).mockResolvedValue(REGISTRO_GUARDADO as never);

    await service.crearHistoriaClinica(10, DATOS, { usuarioId: 2 });

    expect(guardarImagen).not.toHaveBeenCalled();
    expect(vi.mocked(repo.crear).mock.calls[0]![0].documentoUrl).toBeNull();
  });

  it('guarda el documento adjunto y lo vincula', async () => {
    vi.mocked(repo.crear).mockResolvedValue({
      ...REGISTRO_GUARDADO,
      documentoUrl: '/api/v1/archivos/historias-clinicas/x.pdf',
    } as never);

    await service.crearHistoriaClinica(10, DATOS, { usuarioId: 2, archivo: ARCHIVO });

    expect(vi.mocked(repo.crear).mock.calls[0]![0].documentoUrl).toBe(
      '/api/v1/archivos/historias-clinicas/x.pdf',
    );
  });

  it('borra el documento si la escritura en base falla', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('base caída'));

    await expect(
      service.crearHistoriaClinica(10, DATOS, { usuarioId: 2, archivo: ARCHIVO }),
    ).rejects.toThrow('base caída');

    expect(borrarImagen).toHaveBeenCalledWith('/api/v1/archivos/historias-clinicas/x.pdf');
  });

  it('registra en auditoría el alta', async () => {
    vi.mocked(repo.crear).mockResolvedValue(REGISTRO_GUARDADO as never);

    await service.crearHistoriaClinica(10, DATOS, { usuarioId: 2 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'HistoriaClinica', entidadId: 100 }),
    );
  });
});

describe('editarHistoriaClinica — permisos (HU-8.3)', () => {
  it('404 si el registro no existe', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null as never);

    await expect(service.editarHistoriaClinica(100, {}, { usuarioId: 2 })).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('un adoptante puede editar su propio registro', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.reemplazar).mockResolvedValue({ ...REGISTRO_GUARDADO, id: 101 } as never);

    await expect(service.editarHistoriaClinica(100, {}, { usuarioId: 2 })).resolves.toMatchObject({
      id: 101,
    });
  });

  it('rechaza a un adoptante que no cargó el registro', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(OTRO_ADOPTANTE as never);

    await expect(service.editarHistoriaClinica(100, {}, { usuarioId: 99 })).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
    });
  });

  it('un integrante del refugio puede editar un registro cargado por otro integrante', async () => {
    const registroDeOtroStaff = { ...REGISTRO_GUARDADO, mascotaId: 11, usuarioAlta: 4 };
    vi.mocked(repo.buscarPorId).mockResolvedValue(registroDeOtroStaff as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_REFUGIO as never);
    vi.mocked(repo.reemplazar).mockResolvedValue({ ...registroDeOtroStaff, id: 102 } as never);

    await expect(service.editarHistoriaClinica(100, {}, { usuarioId: 4 })).resolves.toMatchObject({
      id: 102,
    });
  });

  it('rechaza a un integrante de otro refugio', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue({ ...REGISTRO_GUARDADO, mascotaId: 11 } as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_OTRO_REFUGIO as never);

    await expect(service.editarHistoriaClinica(100, {}, { usuarioId: 5 })).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
    });
  });
});

describe('editarHistoriaClinica — fusión de campos (inmutabilidad)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.reemplazar).mockResolvedValue({ ...REGISTRO_GUARDADO, id: 101 } as never);
  });

  it('nunca llama a un update: siempre pasa por reemplazar (baja + alta)', async () => {
    await service.editarHistoriaClinica(100, { titulo: 'Nuevo' }, { usuarioId: 2 });

    expect(repo.reemplazar).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ titulo: 'Nuevo' }),
      2,
    );
  });

  it('un campo ausente conserva el valor del registro anterior', async () => {
    await service.editarHistoriaClinica(100, { titulo: 'Nuevo' }, { usuarioId: 2 });

    const datosEnviados = vi.mocked(repo.reemplazar).mock.calls[0]![1];
    expect(datosEnviados.descripcion).toBe(REGISTRO_GUARDADO.descripcion);
    expect(datosEnviados.fechaVisita).toBe(REGISTRO_GUARDADO.fechaVisita);
  });

  it('vacunacion siempre se arrastra del registro anterior, no es editable', async () => {
    await service.editarHistoriaClinica(100, { titulo: 'Nuevo' }, { usuarioId: 2 });

    expect(vi.mocked(repo.reemplazar).mock.calls[0]![1].vacunacion).toBe(
      REGISTRO_GUARDADO.vacunacion,
    );
  });

  it('borra el documento viejo cuando se sube uno nuevo', async () => {
    const conDocumento = { ...REGISTRO_GUARDADO, documentoUrl: '/api/v1/archivos/x/viejo.pdf' };
    vi.mocked(repo.buscarPorId).mockResolvedValue(conDocumento as never);
    vi.mocked(repo.reemplazar).mockResolvedValue({ ...conDocumento, id: 101 } as never);

    await service.editarHistoriaClinica(100, {}, { usuarioId: 2, archivo: ARCHIVO });

    expect(borrarImagen).toHaveBeenCalledWith('/api/v1/archivos/x/viejo.pdf');
  });

  it('registra en auditoría la modificación con el id del nuevo registro', async () => {
    await service.editarHistoriaClinica(100, { titulo: 'Nuevo' }, { usuarioId: 2 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'MODIFICAR', entidad: 'HistoriaClinica', entidadId: 101 }),
    );
  });
});

describe('eliminarHistoriaClinica — permisos (HU-8.4)', () => {
  it('404 si el registro no existe', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null as never);

    await expect(service.eliminarHistoriaClinica(100, 2)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('un adoptante puede eliminar su propio registro', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.darDeBaja).mockResolvedValue(REGISTRO_GUARDADO as never);

    await expect(service.eliminarHistoriaClinica(100, 2)).resolves.toEqual({ id: 100 });
    expect(repo.darDeBaja).toHaveBeenCalledWith(100, 2);
  });

  it('rechaza a un adoptante que no cargó el registro, con el mensaje literal de la HU', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(OTRO_ADOPTANTE as never);

    await expect(service.eliminarHistoriaClinica(100, 99)).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
      mensaje: 'No tiene permisos para eliminar este registro',
    });
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });

  it('un integrante del refugio puede eliminar un registro cargado por otro integrante', async () => {
    const registroDeOtroStaff = { ...REGISTRO_GUARDADO, mascotaId: 11, usuarioAlta: 4 };
    vi.mocked(repo.buscarPorId).mockResolvedValue(registroDeOtroStaff as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_REFUGIO as never);
    vi.mocked(repo.darDeBaja).mockResolvedValue(registroDeOtroStaff as never);

    await expect(service.eliminarHistoriaClinica(100, 4)).resolves.toEqual({ id: 100 });
  });

  it('rechaza a un integrante de otro refugio', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue({ ...REGISTRO_GUARDADO, mascotaId: 11 } as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_REFUGIO as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_OTRO_REFUGIO as never);

    await expect(service.eliminarHistoriaClinica(100, 5)).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
    });
  });

  it('registra en auditoría la baja', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(REGISTRO_GUARDADO as never);
    vi.mocked(repo.buscarMascota).mockResolvedValue(MASCOTA_ADOPTANTE as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.darDeBaja).mockResolvedValue(REGISTRO_GUARDADO as never);

    await service.eliminarHistoriaClinica(100, 2);

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ELIMINAR', entidad: 'HistoriaClinica', entidadId: 100 }),
    );
  });
});
