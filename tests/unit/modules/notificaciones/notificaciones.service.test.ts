import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../../src/modules/notificaciones/notificaciones.repository';
import * as service from '../../../../src/modules/notificaciones/notificaciones.service';
import { encolarEnvioMail, encolarEnvioPush } from '../../../../src/shared/colaNotificaciones';
import * as emisor from '../../../../src/websockets/emisor';
import { estaEnLinea } from '../../../../src/websockets/presencia';

vi.mock('../../../../src/modules/notificaciones/notificaciones.repository');
vi.mock('../../../../src/shared/colaNotificaciones');
vi.mock('../../../../src/websockets/emisor');
vi.mock('../../../../src/websockets/presencia');

const USUARIO = 7;
const OTRO_USUARIO = 99;

const FILA = {
  id: 1,
  tipo: 'SOLICITUD_ACEPTADA',
  mensaje: 'Tu solicitud fue aceptada',
  leido: false,
  entidadTipo: 'SOLICITUD',
  entidadId: 42,
  fechaAlta: new Date('2026-09-01T12:00:00.000Z'),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.crear).mockResolvedValue(FILA as never);
  vi.mocked(repo.contarNoLeidas).mockResolvedValue(0);
  vi.mocked(repo.listarDispositivosActivos).mockResolvedValue([]);
  vi.mocked(estaEnLinea).mockReturnValue(false);
});

describe('notificar — regla 1: siempre queda en bandeja', () => {
  it('persiste la notificación aunque no pida ningún canal extra', async () => {
    await service.notificar({ usuarioId: USUARIO, tipo: 'X', mensaje: 'hola' });

    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: USUARIO, tipo: 'X', mensaje: 'hola' }),
    );
    expect(encolarEnvioPush).not.toHaveBeenCalled();
    expect(encolarEnvioMail).not.toHaveBeenCalled();
  });

  it('avisa en tiempo real (socket) además de guardar', async () => {
    await service.notificar({ usuarioId: USUARIO, tipo: 'X', mensaje: 'hola' });

    // El ítem emitido sale de lo que devolvió `repo.crear` (FILA), no del input crudo.
    expect(emisor.emitirNotificacionNueva).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ id: FILA.id, mensaje: FILA.mensaje }),
    );
    expect(emisor.emitirContadorNotificaciones).toHaveBeenCalledWith(USUARIO, 0);
  });

  it('best-effort: si falla el guardado, no propaga el error', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('DB caída'));

    await expect(
      service.notificar({ usuarioId: USUARIO, tipo: 'X', mensaje: 'hola' }),
    ).resolves.toBeUndefined();
  });
});

describe('notificar — regla 3: con la app abierta no se manda push', () => {
  it('usuario en línea: no encola push aunque lo pida', async () => {
    vi.mocked(estaEnLinea).mockReturnValue(true);
    vi.mocked(repo.listarDispositivosActivos).mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ] as never);

    await service.notificar({
      usuarioId: USUARIO,
      tipo: 'X',
      mensaje: 'hola',
      canal: { push: true },
    });

    expect(encolarEnvioPush).not.toHaveBeenCalled();
  });

  it('usuario offline con dispositivos activos: encola push', async () => {
    vi.mocked(estaEnLinea).mockReturnValue(false);
    vi.mocked(repo.listarDispositivosActivos).mockResolvedValue([
      { expoPushToken: 'ExponentPushToken[a]' },
    ] as never);

    await service.notificar({
      usuarioId: USUARIO,
      tipo: 'X',
      mensaje: 'hola',
      canal: { push: true },
    });

    expect(encolarEnvioPush).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['ExponentPushToken[a]'], cuerpo: 'hola' }),
    );
  });

  it('offline pero sin dispositivos registrados: no encola nada', async () => {
    vi.mocked(estaEnLinea).mockReturnValue(false);
    vi.mocked(repo.listarDispositivosActivos).mockResolvedValue([]);

    await service.notificar({
      usuarioId: USUARIO,
      tipo: 'X',
      mensaje: 'hola',
      canal: { push: true },
    });

    expect(encolarEnvioPush).not.toHaveBeenCalled();
  });
});

describe('notificar — regla 2: mail se envía si se pide, sin importar si está online', () => {
  it('encola el mail al correo del usuario', async () => {
    vi.mocked(repo.buscarEmailUsuario).mockResolvedValue({ email: 'a@b.com' } as never);

    await service.notificar({
      usuarioId: USUARIO,
      tipo: 'X',
      mensaje: 'hola',
      asuntoMail: 'Asunto',
      canal: { mail: true },
    });

    expect(encolarEnvioMail).toHaveBeenCalledWith({
      to: 'a@b.com',
      asunto: 'Asunto',
      texto: 'hola',
    });
  });

  it('sin email cargado, no encola nada (no revienta)', async () => {
    vi.mocked(repo.buscarEmailUsuario).mockResolvedValue(null as never);

    await service.notificar({ usuarioId: USUARIO, tipo: 'X', mensaje: 'hola', canal: { mail: true } });

    expect(encolarEnvioMail).not.toHaveBeenCalled();
  });
});

describe('notificarUnaVez — idempotencia de los jobs programados', () => {
  it('no notifica de nuevo si ya existe esa notificación puntual', async () => {
    vi.mocked(repo.existioAlguna).mockResolvedValue(true);

    await service.notificarUnaVez({
      usuarioId: USUARIO,
      tipo: 'SEGUIMIENTO_RECORDATORIO_24H',
      mensaje: 'hola',
      entidadTipo: 'SEGUIMIENTO',
      entidadId: 5,
    });

    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('notifica si todavía no existía', async () => {
    vi.mocked(repo.existioAlguna).mockResolvedValue(false);

    await service.notificarUnaVez({
      usuarioId: USUARIO,
      tipo: 'SEGUIMIENTO_RECORDATORIO_24H',
      mensaje: 'hola',
      entidadTipo: 'SEGUIMIENTO',
      entidadId: 5,
    });

    expect(repo.crear).toHaveBeenCalled();
  });
});

describe('regla 8: un usuario solo ve y modifica sus propias notificaciones', () => {
  it('marcarLeida de una notificación ajena (o inexistente) tira 404, no 403', async () => {
    vi.mocked(repo.buscarPropia).mockResolvedValue(null);

    await expect(service.marcarLeida(OTRO_USUARIO, FILA.id)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADA',
      httpStatus: 404,
    });
    expect(repo.marcarLeida).not.toHaveBeenCalled();
  });

  it('marcarLeida de la propia sí la marca', async () => {
    vi.mocked(repo.buscarPropia).mockResolvedValue(FILA as never);

    await service.marcarLeida(USUARIO, FILA.id);

    expect(repo.marcarLeida).toHaveBeenCalledWith(FILA.id, USUARIO);
  });

  it('eliminar de una notificación ajena tira 404', async () => {
    vi.mocked(repo.buscarPropia).mockResolvedValue(null);

    await expect(service.eliminar(OTRO_USUARIO, FILA.id)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADA',
      httpStatus: 404,
    });
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });
});
