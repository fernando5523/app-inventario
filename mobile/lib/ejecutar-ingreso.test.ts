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
  it('rechazo → vacía el PIN, apaga el spinner y avisa con el error; NO entra', async () => {
    const acciones = accionesEspiadas();
    const rechazo = new Error('PIN incorrecto.');
    acciones.ingresar.mockRejectedValue(rechazo);

    await ejecutarIngreso(30, '000000', acciones as unknown as AccionesIngreso);

    expect(acciones.vaciarPin).toHaveBeenCalledTimes(1); // el estado del PIN queda VACÍO.
    // Reenvía el ERROR crudo (no un texto ya armado): el mensaje lo decide
    // quién muestra — un 429 con tiempo del servidor dice el minuto exacto.
    expect(acciones.alRechazar).toHaveBeenCalledWith(rechazo);
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

  it('rechazo que no es Error: reenvía el valor crudo e IGUAL vacía el PIN (el texto lo resuelve quién muestra)', async () => {
    const acciones = accionesEspiadas();
    acciones.ingresar.mockRejectedValue('caída suelta'); // no es una Error

    await ejecutarIngreso(30, '000000', acciones as unknown as AccionesIngreso);

    expect(acciones.vaciarPin).toHaveBeenCalledTimes(1);
    expect(acciones.alRechazar).toHaveBeenCalledWith('caída suelta');
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
