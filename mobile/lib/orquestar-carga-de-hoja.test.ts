/**
 * Reproduce el hallazgo del cliente (2026-09-08): el Coordinador cierra
 * una ronda y abre la siguiente con el Contador todavía con la app
 * abierta -- la pantalla tiene que traer la hoja nueva sola, sin que
 * nadie tenga que cerrar y reabrir la app.
 */
import { describe, expect, it, vi } from 'vitest';

import { cargarHojaActiva, type AccionesCargaHoja } from './orquestar-carga-de-hoja';
import type { HojaConteo } from './dominio/tipos';

function hoja(parciales: Partial<HojaConteo> & { numero: string }): HojaConteo {
  return {
    id: 1,
    inventarioId: 1,
    zona: 'Zona',
    gondola: 'G1',
    tamano: 10,
    estado: 'pendiente',
    sync: 'sincronizado',
    asignados: ['Conteo'],
    productos: [],
    conteos: [],
    ...parciales,
  } as HojaConteo;
}

function acciones(parciales: Partial<AccionesCargaHoja>): AccionesCargaHoja {
  return {
    activo: vi.fn(async () => null),
    inventarioIdSinRed: vi.fn(async () => null),
    rondaActivaSinRed: vi.fn(async () => null),
    mias: vi.fn(async () => []),
    porNumero: vi.fn(async () => null),
    ...parciales,
  };
}

describe('primera carga (sin ronda previa en la pantalla)', () => {
  it('resuelve inventario, ronda, elige la hoja en proceso y la trae', async () => {
    const hojaEnProceso = hoja({ numero: '002', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 1 })),
      mias: vi.fn(async () => [hoja({ numero: '001', productos: [{ id: 9 } as never] }), hojaEnProceso]),
      porNumero: vi.fn(async () => hojaEnProceso),
    });

    const resultado = await cargarHojaActiva({ ronda: null, numeroActivo: null }, acc);

    expect(resultado).toEqual({ inventarioId: 5, ronda: 1, numeroActivo: '002', hoja: hojaEnProceso });
    expect(acc.mias).toHaveBeenCalledWith(5, 1);
    expect(acc.porNumero).toHaveBeenCalledWith(5, '002', 1);
  });

  it('sin ninguna hoja con catálogo cargado: inventario y ronda resueltos, hoja null', async () => {
    const acc = acciones({ activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 1 })), mias: vi.fn(async () => []) });

    const resultado = await cargarHojaActiva({ ronda: null, numeroActivo: null }, acc);

    expect(resultado).toEqual({ inventarioId: 5, ronda: 1, numeroActivo: null, hoja: null });
    expect(acc.porNumero).not.toHaveBeenCalled();
  });

  it('sin inventario en curso: todo null, nunca tira', async () => {
    const acc = acciones({ activo: vi.fn(async () => null) });
    await expect(cargarHojaActiva({ ronda: null, numeroActivo: null }, acc)).resolves.toEqual({
      inventarioId: null,
      ronda: null,
      numeroActivo: null,
      hoja: null,
    });
  });
});

describe('EL CASO QUE REPORTÓ EL CLIENTE: la ronda activa cambió mientras la pantalla seguía abierta', () => {
  it('con la app ya en la ronda 2, el Coordinador abre la ronda 3: la pantalla descarta el número viejo y elige la hoja nueva', async () => {
    const hojaRonda3 = hoja({ numero: '005', estado: 'en-proceso', productos: [{ id: 3 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 3 })),
      mias: vi.fn(async () => [hojaRonda3]),
      porNumero: vi.fn(async () => hojaRonda3),
    });

    // La pantalla ya tenía la hoja #002 de la ronda 2 cargada.
    const resultado = await cargarHojaActiva({ ronda: 2, numeroActivo: '002' }, acc);

    // Se volvió a elegir para la ronda 3 -- NUNCA se reusó '002' a ciegas.
    expect(resultado).toEqual({ inventarioId: 5, ronda: 3, numeroActivo: '005', hoja: hojaRonda3 });
    expect(acc.mias).toHaveBeenCalledWith(5, 3);
    expect(acc.porNumero).toHaveBeenCalledWith(5, '005', 3);
  });

  it('la ronda cambió pero todavía no le asignaron ninguna hoja de la nueva: hoja null, no se cuelga con la vieja', async () => {
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 3 })),
      mias: vi.fn(async () => []), // el Coordinador cerró la ronda 2 pero todavía no repartió la 3.
    });

    const resultado = await cargarHojaActiva({ ronda: 2, numeroActivo: '002' }, acc);

    expect(resultado).toEqual({ inventarioId: 5, ronda: 3, numeroActivo: null, hoja: null });
    expect(acc.porNumero).not.toHaveBeenCalled(); // nunca pide la '002' vieja contra la ronda nueva.
  });

  it('la ronda NO cambió: reusa el número que ya tenía, no vuelve a pedir mias() -- comportamiento de siempre', async () => {
    const hojaActualizada = hoja({ numero: '002', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 2 })),
      porNumero: vi.fn(async () => hojaActualizada),
    });

    const resultado = await cargarHojaActiva({ ronda: 2, numeroActivo: '002' }, acc);

    expect(resultado).toEqual({ inventarioId: 5, ronda: 2, numeroActivo: '002', hoja: hojaActualizada });
    expect(acc.mias).not.toHaveBeenCalled(); // no hacía falta volver a elegir: la ronda es la misma.
    expect(acc.porNumero).toHaveBeenCalledWith(5, '002', 2);
  });
});

describe('sin red: sigue con lo último bueno, nunca se cuelga ni borra nada', () => {
  it('activo() falla -- cae a inventarioIdSinRed/rondaActivaSinRed y sigue mostrando la hoja local', async () => {
    const hojaLocal = hoja({ numero: '002', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => {
        throw new Error('sin red');
      }),
      inventarioIdSinRed: vi.fn(async () => 5),
      rondaActivaSinRed: vi.fn(async () => 2),
      porNumero: vi.fn(async () => hojaLocal),
    });

    const resultado = await cargarHojaActiva({ ronda: 2, numeroActivo: '002' }, acc);

    expect(resultado).toEqual({ inventarioId: 5, ronda: 2, numeroActivo: '002', hoja: hojaLocal });
  });

  it('sin red y sin nada descargado nunca: todo null, nunca tira', async () => {
    const acc = acciones({
      activo: vi.fn(async () => {
        throw new Error('sin red');
      }),
      inventarioIdSinRed: vi.fn(async () => null),
    });

    await expect(cargarHojaActiva({ ronda: null, numeroActivo: null }, acc)).resolves.toEqual({
      inventarioId: null,
      ronda: null,
      numeroActivo: null,
      hoja: null,
    });
  });

  it('sin red, la ronda local sigue siendo la misma que ya tenía la pantalla: no descarta el número, no pierde el trabajo local', async () => {
    const acc = acciones({
      activo: vi.fn(async () => {
        throw new Error('sin red');
      }),
      inventarioIdSinRed: vi.fn(async () => 5),
      rondaActivaSinRed: vi.fn(async () => 2), // la misma ronda que ya tenía la pantalla.
    });

    await cargarHojaActiva({ ronda: 2, numeroActivo: '002' }, acc);

    expect(acc.mias).not.toHaveBeenCalled();
  });
});
