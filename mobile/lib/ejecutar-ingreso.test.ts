import { describe, expect, it, vi } from 'vitest';

import { ejecutarIngreso, type AccionesIngreso } from './ejecutar-ingreso';
import type { Sesion } from './dominio/tipos';

function accionesEspiadas(): { [K in keyof AccionesIngreso]: ReturnType<typeof vi.fn> } {
  return {
    ingresar: vi.fn(),
    alEntrar: vi.fn(),
    vaciarPin: vi.fn(),
    alRechazar: vi.fn(),
    marcarIngresando: vi.fn(),
  };
}

const sesionFalsa = { colaborador: { rol: 'conteo' } } as unknown as Sesion;

describe('ejecutarIngreso: un PIN rechazado VACÍA el campo antes de avisar', () => {
  it('rechazo → vacía el PIN, apaga el spinner y avisa; NO entra', async () => {
    const acciones = accionesEspiadas();
    acciones.ingresar.mockRejectedValue(new Error('PIN incorrecto.'));

    await ejecutarIngreso(30, '000000', acciones as unknown as AccionesIngreso);

    expect(acciones.vaciarPin).toHaveBeenCalledTimes(1); // el estado del PIN queda VACÍO.
    expect(acciones.alRechazar).toHaveBeenCalledWith('PIN incorrecto.');
    expect(acciones.marcarIngresando).toHaveBeenLastCalledWith(false);
    expect(acciones.alEntrar).not.toHaveBeenCalled();
  });

  it('el orden importa: vaciar SIEMPRE antes de avisar (si no, el reintento cae sobre el campo lleno)', async () => {
    const acciones = accionesEspiadas();
    acciones.ingresar.mockRejectedValue(new Error('PIN incorrecto.'));
    const orden: string[] = [];
    acciones.vaciarPin.mockImplementation(() => orden.push('vaciar'));
    acciones.alRechazar.mockImplementation(() => orden.push('avisar'));

    await ejecutarIngreso(30, '000000', acciones as unknown as AccionesIngreso);

    expect(orden).toEqual(['vaciar', 'avisar']);
  });

  it('sin Error (rechazo raro sin mensaje): avisa con un texto por defecto, igual vacía el PIN', async () => {
    const acciones = accionesEspiadas();
    acciones.ingresar.mockRejectedValue('caída rara'); // no es una Error

    await ejecutarIngreso(30, '000000', acciones as unknown as AccionesIngreso);

    expect(acciones.vaciarPin).toHaveBeenCalledTimes(1);
    expect(acciones.alRechazar).toHaveBeenCalledWith('Intentá de nuevo.');
  });

  it('ingreso OK: entra con la sesión y NO vacía el PIN ni avisa (ni apaga el spinner: se desmonta)', async () => {
    const acciones = accionesEspiadas();
    acciones.ingresar.mockResolvedValue(sesionFalsa);

    await ejecutarIngreso(30, '000030', acciones as unknown as AccionesIngreso);

    expect(acciones.alEntrar).toHaveBeenCalledWith(sesionFalsa);
    expect(acciones.vaciarPin).not.toHaveBeenCalled();
    expect(acciones.alRechazar).not.toHaveBeenCalled();
    expect(acciones.marcarIngresando).toHaveBeenCalledTimes(1); // solo el true del arranque.
    expect(acciones.marcarIngresando).toHaveBeenCalledWith(true);
  });
});
