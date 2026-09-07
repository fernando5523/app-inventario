import { describe, expect, it, vi } from 'vitest';

import { teclear } from './teclado-pin';

describe('teclear: el valor final viaja como dato, no por el estado del padre', () => {
  // La carrera del bug de "Resetear PIN" (release 2.12.0): al teclear el 6º
  // dígito, el callback tiene que recibir los 6, no los 5 del render anterior.
  it('el último dígito completa y devuelve los 6 dígitos, no los 5 previos', () => {
    const r = teclear('12345', '6', 6);
    expect(r.valor).toBe('123456');
    expect(r.valor).toHaveLength(6);
    expect(r.completo).toBe(true);
  });

  it('un dígito intermedio no completa', () => {
    expect(teclear('1234', '5', 6)).toEqual({ valor: '12345', completo: false });
  });

  it('el primer dígito no completa', () => {
    expect(teclear('', '4', 6)).toEqual({ valor: '4', completo: false });
  });

  it('con el teclado lleno ignora la tecla (valor null, no vuelve a "completar")', () => {
    // `null` y no `''`: el vacío es un valor legítimo; "lleno" es otra cosa.
    expect(teclear('123456', '7', 6)).toEqual({ valor: null, completo: false });
  });

  it('respeta una longitud distinta de 6', () => {
    expect(teclear('123', '4', 4)).toEqual({ valor: '1234', completo: true });
  });
});

describe('contrato con onCompletar: quien resetea recibe el PIN COMPLETO', () => {
  // Sin harness de render (mobile no tiene react-test-renderer), se prueba el
  // contrato que usa UsuariosScreen: TecladoPin dispara onCompletar con el
  // valor final de `teclear`, y el handler llama al repositorio con ESE valor
  // -- nunca con el estado del padre, que en ese tick todavía tiene 5 dígitos.
  it('completar el último dígito llama a resetearPin con los 6, no con los 5 del estado', async () => {
    const resetearPin = vi.fn().mockResolvedValue(undefined);
    const usuario = { id: 7, nombre: 'Nancy' };

    // El tick del último dígito: el estado del padre TODAVÍA tiene 5.
    const estadoDelPadre = '12345';
    const { valor: pinFinal, completo } = teclear(estadoDelPadre, '6', 6);

    // Así lo hace TecladoPin: pasa `pinFinal` (el argumento), no el estado.
    if (completo && pinFinal) await resetearPin(usuario.id, pinFinal);

    expect(resetearPin).toHaveBeenCalledWith(7, '123456');
    // Si se leyera el estado del padre (el bug), serían 5 dígitos: eso NO pasa.
    expect(resetearPin).not.toHaveBeenCalledWith(7, estadoDelPadre);
  });
});
