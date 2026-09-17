/**
 * Registro de presencia de websockets (HU-5.2).
 *
 * Es lógica pura sin socket.io de por medio, así que se testea directamente. Lo que importa
 * es el caso multi-dispositivo: quien tiene el celular y la web abiertos sigue en línea
 * hasta que cae el último socket.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  estaEnLinea,
  limpiarPresencia,
  registrarConexion,
  registrarDesconexion,
} from '../../../src/websockets/presencia';

const USUARIO = 7;

beforeEach(() => {
  limpiarPresencia();
});

describe('presencia', () => {
  it('un usuario sin sockets no está en línea', () => {
    expect(estaEnLinea(USUARIO)).toBe(false);
  });

  it('el primer socket lo pone en línea y lo avisa', () => {
    expect(registrarConexion(USUARIO, 'socket-1')).toBe(true);
    expect(estaEnLinea(USUARIO)).toBe(true);
  });

  it('el segundo socket no vuelve a avisar: ya estaba en línea', () => {
    registrarConexion(USUARIO, 'socket-1');

    expect(registrarConexion(USUARIO, 'socket-2')).toBe(false);
  });

  it('con dos dispositivos, cerrar uno NO lo desconecta', () => {
    registrarConexion(USUARIO, 'socket-1');
    registrarConexion(USUARIO, 'socket-2');

    expect(registrarDesconexion(USUARIO, 'socket-1')).toBe(false);
    expect(estaEnLinea(USUARIO)).toBe(true);
  });

  it('recién el último socket lo deja fuera de línea', () => {
    registrarConexion(USUARIO, 'socket-1');
    registrarConexion(USUARIO, 'socket-2');
    registrarDesconexion(USUARIO, 'socket-1');

    expect(registrarDesconexion(USUARIO, 'socket-2')).toBe(true);
    expect(estaEnLinea(USUARIO)).toBe(false);
  });

  it('desconectar dos veces el mismo socket es idempotente', () => {
    registrarConexion(USUARIO, 'socket-1');

    expect(registrarDesconexion(USUARIO, 'socket-1')).toBe(true);
    // La segunda no puede volver a reportar "se fue": ya no había nada que sacar.
    expect(registrarDesconexion(USUARIO, 'socket-1')).toBe(false);
    expect(estaEnLinea(USUARIO)).toBe(false);
  });

  it('reconectar con otro socket lo vuelve a poner en línea', () => {
    registrarConexion(USUARIO, 'socket-1');
    registrarDesconexion(USUARIO, 'socket-1');

    expect(registrarConexion(USUARIO, 'socket-2')).toBe(true);
    expect(estaEnLinea(USUARIO)).toBe(true);
  });

  it('la presencia es por usuario: la de uno no afecta la del otro', () => {
    registrarConexion(USUARIO, 'socket-1');

    expect(estaEnLinea(41)).toBe(false);
  });
});
