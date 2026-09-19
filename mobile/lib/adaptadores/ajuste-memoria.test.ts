/**
 * Acá se decide quién puede cambiar una cifra que después se le descuenta del
 * sueldo a alguien, y hasta cuándo. Los casos que se prueban son los bordes
 * donde el permiso cambia de mano: si uno se afloja, el cambio lo termina
 * haciendo quien no debía, o en un momento en el que ya no correspondía.
 *
 * Hasta este cambio finalizar una hoja era el punto de no retorno. Ahora no:
 * la ventana de corrección del Coordinador se abre con la ronda cerrada y se
 * cierra cuando el Auditor arranca el ajuste. Esa ventana es una decisión del
 * cliente, no un efecto secundario, y estos tests la fijan.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { obtenerInventario, registrarInventario, crearHojasEnInventario } from './_compartido';
import {
  ajusteMemoria,
  ajustesEnMemoria,
  cerrarRondaEnMemoria,
  estadoDeInventarioEnMemoria,
  limpiarAjusteMemoria,
  rondaActivaEnMemoria,
} from './ajuste-memoria';
import { sesionMemoria } from './sesion-memoria';

/** Padrón de Market Bolívar (sucursal 3), ver sesion-memoria.ts. */
const BOLIVAR = 3;
const OSCAR = 301; // coordinador
const SILVIA = 302; // conteo
const JORGE = 303; // auditor de Bolívar
const NILDA = 203; // auditora, pero de Market Carhuaz
const PIN = '123456';

const MOTIVO = 'Recuento con el jefe de tienda';

/** Un inventario nuevo CON hojas: sin hojas no hay ronda ni nada que corregir. */
function inventarioConHojas(sucursalId = BOLIVAR): number {
  const inventario = registrarInventario(sucursalId, 8000, new Date().toISOString());
  crearHojasEnInventario(inventario, 50);
  return inventario.id;
}

async function comoAuditor(): Promise<void> {
  await sesionMemoria.cerrar();
  await sesionMemoria.ingresar(JORGE, PIN);
}

async function comoCoordinador(): Promise<void> {
  await sesionMemoria.cerrar();
  await sesionMemoria.ingresar(OSCAR, PIN);
}

beforeEach(async () => {
  limpiarAjusteMemoria();
  await sesionMemoria.cerrar();
});

describe('la fase del inventario', () => {
  it('nace en curso, con la ronda 1 abierta', async () => {
    const id = inventarioConHojas();

    expect(estadoDeInventarioEnMemoria(id)).toBe('en_curso');
    expect(rondaActivaEnMemoria(id, true)).toBe(1);
  });

  /** LA VENTANA del coordinador: ronda cerrada, inventario todavía abierto. */
  it('cerrada la ronda no hay ronda activa, pero el inventario sigue en curso', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);

    expect(rondaActivaEnMemoria(id, true)).toBeNull();
    expect(estadoDeInventarioEnMemoria(id)).toBe('en_curso');
  });

  it('sin hojas no hay ronda: el coordinador todavía está armando el inventario', async () => {
    const inventario = registrarInventario(BOLIVAR, 8000, new Date().toISOString());

    expect(rondaActivaEnMemoria(inventario.id, false)).toBeNull();
  });
});

describe('ajusteMemoria.corregirConteo — el coordinador, sin ver stock', () => {
  it('reemplaza el valor de un producto de la hoja', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    const hoja = inventario.hojas.find((h) => h.productos.length > 0) ?? inventario.hojas[0];
    // El mock solo siembra catálogo en la hoja #002 del inventario de demo;
    // acá se le pone un producto para poder corregirlo.
    hoja.productos = [{ id: 9001, codigo: '0001', codigoBarras: '7750000001', descripcion: 'Aceite', empaques: [{ nombre: 'Caja', factor: 12 }] }];
    await comoCoordinador();

    await ajusteMemoria.corregirConteo(hoja.id, 9001, { empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }], sueltas: 3, motivo: MOTIVO });

    const conteo = (await obtenerInventario(id))!.hojas.find((h) => h.id === hoja.id)!.conteos.find((c) => c.productoId === 9001)!;
    expect(conteo.sueltas).toBe(3);
    expect(conteo.empaques).toEqual([{ empaqueNombre: 'Caja', cantidad: 2 }]);
    // Una corrección a mano NO la confirmó ningún escáner: decir que sí sería
    // inventar una evidencia que no existe.
    expect(conteo.confirmadoPorEscaner).toBe(false);
  });

  it('funciona también con la ronda YA CERRADA: es la ventana que pidió el cliente', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    const hoja = inventario.hojas[0];
    hoja.productos = [{ id: 9002, codigo: '0002', codigoBarras: '7750000002', descripcion: 'Leche', empaques: [] }];
    cerrarRondaEnMemoria(id);
    await comoCoordinador();

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 9002, { empaques: [], sueltas: 7, motivo: MOTIVO }),
    ).resolves.toBeUndefined();
  });

  it('DEJA de funcionar en cuanto el auditor arranca el ajuste', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    const hoja = inventario.hojas[0];
    hoja.productos = [{ id: 9003, codigo: '0003', codigoBarras: '7750000003', descripcion: 'Fideos', empaques: [] }];
    cerrarRondaEnMemoria(id);
    await comoAuditor();
    await ajusteMemoria.iniciarAjuste(id);
    await comoCoordinador();

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 9003, { empaques: [], sueltas: 7, motivo: MOTIVO }),
    ).rejects.toThrow(/ajuste final/i);
  });

  it('el motivo es obligatorio, y un relleno de un toque no cuenta', async () => {
    const id = inventarioConHojas();
    const hoja = (await obtenerInventario(id))!.hojas[0];
    await comoCoordinador();

    await expect(ajusteMemoria.corregirConteo(hoja.id, 1, { empaques: [], sueltas: 1, motivo: '' })).rejects.toThrow(/motivo/i);
    await expect(ajusteMemoria.corregirConteo(hoja.id, 1, { empaques: [], sueltas: 1, motivo: 'x' })).rejects.toThrow(/motivo/i);
  });

  it('quien cuenta no puede corregir su propio conteo', async () => {
    const id = inventarioConHojas();
    const hoja = (await obtenerInventario(id))!.hojas[0];
    await sesionMemoria.ingresar(SILVIA, PIN);

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 1, { empaques: [], sueltas: 1, motivo: MOTIVO }),
    ).rejects.toThrow(/Coordinador, el Auditor o un Administrador/i);
  });

  /**
   * EL AUDITOR TAMBIÉN CORRIGE. Es la misma corrección sobre el mismo dato y
   * el mismo endpoint: lo que lo distingue del Coordinador es que él VE el
   * stock mientras lo hace, y eso se decide en la pantalla, no en el permiso.
   */
  it('el auditor de la sucursal SÍ puede corregir lo contado', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    const hoja = inventario.hojas[0];
    hoja.productos = [{ id: 9100, codigo: '0100', codigoBarras: '7750000100', descripcion: 'Atún', empaques: [] }];
    await comoAuditor();

    await ajusteMemoria.corregirConteo(hoja.id, 9100, { empaques: [], sueltas: 11, motivo: MOTIVO });

    const conteo = (await obtenerInventario(id))!.hojas[0].conteos.find((c) => c.productoId === 9100)!;
    expect(conteo.sueltas).toBe(11);
  });

  it('pero un auditor de OTRA tienda no', async () => {
    const id = inventarioConHojas();
    const hoja = (await obtenerInventario(id))!.hojas[0];
    await sesionMemoria.ingresar(NILDA, PIN);

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 1, { empaques: [], sueltas: 1, motivo: MOTIVO }),
    ).rejects.toThrow(/sucursal del inventario/i);
  });

  /** Arrancado el ajuste, al auditor también se le cierra esta vía: corrige por la de ajuste. */
  it('el auditor tampoco corrige por aquí una vez que empezó su ajuste', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    const hoja = inventario.hojas[0];
    hoja.productos = [{ id: 9101, codigo: '0101', codigoBarras: '7750000101', descripcion: 'Arroz', empaques: [] }];
    cerrarRondaEnMemoria(id);
    await comoAuditor();
    await ajusteMemoria.iniciarAjuste(id);

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 9101, { empaques: [], sueltas: 4, motivo: MOTIVO }),
    ).rejects.toThrow(/ajuste final/i);
  });

  it('sin sesión tampoco: ningún cambio sobre una cifra de nómina es anónimo', async () => {
    const id = inventarioConHojas();
    const hoja = (await obtenerInventario(id))!.hojas[0];

    await expect(
      ajusteMemoria.corregirConteo(hoja.id, 1, { empaques: [], sueltas: 1, motivo: MOTIVO }),
    ).rejects.toThrow(/sesión activa/i);
  });
});

describe('ajusteMemoria — las tres del auditor', () => {
  it('abre otra ronda cuando la última ya cerró, y la ronda activa sube', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoAuditor();

    await ajusteMemoria.abrirRondaExtra(id);

    // Era la 1: el 4to o el 5to conteo del cliente salen de repetir esto.
    expect(rondaActivaEnMemoria(id, true)).toBe(2);
  });

  it('NO abre otra ronda con una todavía abierta: serían dos rondas vivas a la vez', async () => {
    const id = inventarioConHojas();
    await comoAuditor();

    await expect(ajusteMemoria.abrirRondaExtra(id)).rejects.toThrow(/ronda abierta/i);
  });

  it('iniciar el ajuste pasa el inventario a ajuste_auditor', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoAuditor();

    await ajusteMemoria.iniciarAjuste(id);

    expect(estadoDeInventarioEnMemoria(id)).toBe('ajuste_auditor');
    // Durante el ajuste NO hay ronda que cerrar: ofrecerla sería ofrecer
    // cerrar una ronda que no existe.
    expect(rondaActivaEnMemoria(id, true)).toBeNull();
  });

  it('no se inicia el ajuste con una ronda abierta', async () => {
    const id = inventarioConHojas();
    await comoAuditor();

    await expect(ajusteMemoria.iniciarAjuste(id)).rejects.toThrow(/ronda abierta/i);
  });

  it('ajustar un ítem antes de iniciar el ajuste no se puede', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoAuditor();

    await expect(
      ajusteMemoria.ajustarItem(id, 1, { empaques: [], sueltas: 5, motivo: MOTIVO }),
    ).rejects.toThrow(/todavía no empezó/i);
  });

  it('el ajuste guarda el valor en UNIDADES, con el factor del empaque de la hoja', async () => {
    const id = inventarioConHojas();
    const inventario = (await obtenerInventario(id))!;
    inventario.hojas[0].productos = [
      { id: 9010, codigo: '0010', codigoBarras: '7750000010', descripcion: 'Gaseosa', empaques: [{ nombre: 'Caja', factor: 12 }] },
    ];
    cerrarRondaEnMemoria(id);
    await comoAuditor();
    await ajusteMemoria.iniciarAjuste(id);

    await ajusteMemoria.ajustarItem(id, 9010, { empaques: [{ empaqueNombre: 'Caja', cantidad: 3 }], sueltas: 4, motivo: MOTIVO });

    // 3 Caja × 12 = 36, + 4 sueltas = 40.
    expect(ajustesEnMemoria(id).get(9010)).toBe(40);
  });

  it('cerrar el ajuste deja el inventario en conteo_cerrado', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoAuditor();
    await ajusteMemoria.iniciarAjuste(id);

    await ajusteMemoria.cerrarAjuste(id);

    expect(estadoDeInventarioEnMemoria(id)).toBe('conteo_cerrado');
  });

  it('no se cierra un ajuste que nunca empezó', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoAuditor();

    await expect(ajusteMemoria.cerrarAjuste(id)).rejects.toThrow(/ningún ajuste/i);
  });

  it('el coordinador no puede abrir rondas ni ajustar: no es su decisión', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await comoCoordinador();

    await expect(ajusteMemoria.abrirRondaExtra(id)).rejects.toThrow(/Auditor/i);
    await expect(ajusteMemoria.iniciarAjuste(id)).rejects.toThrow(/Auditor/i);
  });

  it('un auditor de OTRA tienda tampoco', async () => {
    const id = inventarioConHojas();
    cerrarRondaEnMemoria(id);
    await sesionMemoria.ingresar(NILDA, PIN);

    await expect(ajusteMemoria.iniciarAjuste(id)).rejects.toThrow(/sucursal del inventario/i);
  });
});
