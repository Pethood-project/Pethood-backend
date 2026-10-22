import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/admin-catalogos/admin-catalogos.repository';
import * as service from '../../../src/modules/admin-catalogos/admin-catalogos.service';
import { schemaAlta } from '../../../src/modules/admin-catalogos/admin-catalogos.dto';

vi.mock('../../../src/modules/admin-catalogos/admin-catalogos.repository');
vi.mock('../../../src/shared/logAuditoria');

const ADMIN = 1;

/** Fila de `vacuna` tal como la devuelve el repository con sus includes. */
function filaVacuna(extra: Record<string, unknown> = {}) {
  return {
    id: 8,
    codigo: 'PARVOVIRUS_CANINO',
    nombre: 'Parvovirus canino',
    descripcion: 'Refuerzo anual',
    especies: [{ especie: { id: 1, nombre: 'Perro' } }],
    fechaAlta: new Date(2026, 9, 22),
    fechaBaja: null,
    _count: { historiasClinicas: 0 },
    ...extra,
  };
}

const DATOS = { nombre: 'Parvovirus canino', descripcion: 'Refuerzo anual', especieIds: [1] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.contarEspeciesActivas).mockResolvedValue(1);
  vi.mocked(repo.buscarPorNombre).mockResolvedValue(null);
  vi.mocked(repo.codigosQueEmpiezanCon).mockResolvedValue([]);
  vi.mocked(repo.crearVacuna).mockResolvedValue(filaVacuna() as never);
  vi.mocked(repo.actualizarVacuna).mockResolvedValue(filaVacuna() as never);
});

describe('alta de vacunas (spec 029)', () => {
  it('genera el código del nombre y devuelve sus especies', async () => {
    const item = await service.crear(ADMIN, 'vacunas', DATOS);

    expect(repo.crearVacuna).toHaveBeenCalledWith(
      { codigo: 'PARVOVIRUS_CANINO', nombre: 'Parvovirus canino', descripcion: 'Refuerzo anual' },
      [1],
      ADMIN,
    );
    expect(item).toMatchObject({
      codigo: 'PARVOVIRUS_CANINO',
      especies: [{ id: 1, nombre: 'Perro' }],
      puedeDarseDeBaja: true,
    });
  });

  it('si el código ya existe, le suma un sufijo', async () => {
    vi.mocked(repo.codigosQueEmpiezanCon).mockResolvedValue(['PARVOVIRUS_CANINO']);

    await service.crear(ADMIN, 'vacunas', DATOS);

    expect(vi.mocked(repo.crearVacuna).mock.calls[0]![0].codigo).toBe('PARVOVIRUS_CANINO_2');
  });

  it('rechaza una especie inexistente o de baja', async () => {
    vi.mocked(repo.contarEspeciesActivas).mockResolvedValue(1);

    await expect(
      service.crear(ADMIN, 'vacunas', { ...DATOS, especieIds: [1, 99] }),
    ).rejects.toMatchObject({ codigo: 'ESPECIE_NO_ENCONTRADA', httpStatus: 404 });
    expect(repo.crearVacuna).not.toHaveBeenCalled();
  });

  it('una especie repetida cuenta una sola vez', async () => {
    await service.crear(ADMIN, 'vacunas', { ...DATOS, especieIds: [1, 1] });

    expect(vi.mocked(repo.crearVacuna).mock.calls[0]![1]).toEqual([1]);
  });

  it('rechaza un nombre que ya existe', async () => {
    vi.mocked(repo.buscarPorNombre).mockResolvedValue(filaVacuna({ id: 3 }) as never);

    await expect(service.crear(ADMIN, 'vacunas', DATOS)).rejects.toMatchObject({
      codigo: 'CATALOGO_DUPLICADO',
    });
  });
});

describe('body del alta de vacunas', () => {
  const schema = schemaAlta('vacunas')!;

  it('exige al menos una especie', () => {
    const r = schema.safeParse({ ...DATOS, especieIds: [] });
    expect(!r.success && r.error.issues[0]!.message).toBe('Elegí al menos una especie');
  });

  it('exige la descripción', () => {
    expect(schema.safeParse({ ...DATOS, descripcion: '' }).success).toBe(false);
  });

  it('ignora un código que venga en el body', () => {
    const r = schema.safeParse({ ...DATOS, codigo: 'OTRO' });
    expect(r.success && 'codigo' in r.data).toBe(false);
  });
});

describe('edición de vacunas', () => {
  it('no toca el código y sincroniza las especies', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(filaVacuna() as never);
    vi.mocked(repo.contarEspeciesActivas).mockResolvedValue(2);

    await service.editar(ADMIN, 'vacunas', 8, { ...DATOS, nombre: 'Parvo', especieIds: [1, 2] });

    expect(repo.actualizarVacuna).toHaveBeenCalledWith(
      8,
      { nombre: 'Parvo', descripcion: 'Refuerzo anual' },
      [1, 2],
      ADMIN,
    );
  });
});

describe('baja y reactivación de vacunas', () => {
  it('una vacuna en uso se puede dar de baja', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(
      filaVacuna({ _count: { historiasClinicas: 15 } }) as never,
    );
    vi.mocked(repo.darDeBaja).mockResolvedValue(
      filaVacuna({ fechaBaja: new Date(), _count: { historiasClinicas: 15 } }) as never,
    );

    await expect(service.darDeBaja(ADMIN, 'vacunas', 8)).resolves.toMatchObject({
      cantidadUsos: 15,
    });
    expect(repo.darDeBaja).toHaveBeenCalledWith('vacunas', 8, ADMIN);
  });

  it('no se reactiva si no le queda ninguna especie activa', async () => {
    vi.mocked(repo.buscar).mockResolvedValue(filaVacuna({ fechaBaja: new Date() }) as never);
    vi.mocked(repo.contarEspeciesActivasDeVacuna).mockResolvedValue(0);

    await expect(service.reactivar(ADMIN, 'vacunas', 8)).rejects.toMatchObject({
      codigo: 'ESPECIE_DE_BAJA',
    });
    expect(repo.reactivar).not.toHaveBeenCalled();
  });
});
