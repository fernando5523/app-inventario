/**
 * Reproduce el hallazgo del cliente (2026-09-08): tenía abierta la #001 de la
 * ronda 2, el Coordinador abrió la 3ra, y al refrescar la ronda activa la
 * pantalla resolvía "001" contra la 3ra y terminaba en OTRA #001. La regla:
 * navegar y resolver por hojaId (identidad estable), y si la abierta ya no es
 * de la ronda activa asignada a la persona, sacarla de la vista con aviso.
 */
import { describe, expect, it, vi } from 'vitest';

import { cargarHojaActiva, textoHojaVieja, type AccionesCargaHoja } from './orquestar-carga-de-hoja';
import type { HojaConteo } from './dominio/tipos';

function hoja(parciales: Partial<HojaConteo> & { id: number; numero: string }): HojaConteo {
  return {
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
    ...parciales,
  };
}

describe('primera carga (sin hoja elegida): elige la que le toca y la trae por id', () => {
  it('resuelve inventario, ronda, elige la hoja en proceso y devuelve su id', async () => {
    const enProceso = hoja({ id: 22, numero: '002', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 1 })),
      mias: vi.fn(async () => [hoja({ id: 11, numero: '001', productos: [{ id: 9 } as never] }), enProceso]),
    });

    const r = await cargarHojaActiva({ ronda: null, hojaId: null }, acc);

    expect(r).toEqual({ inventarioId: 5, ronda: 1, hojaId: 22, hoja: enProceso, motivo: null, rondaVieja: null });
    expect(acc.mias).toHaveBeenCalledWith(5, 1);
  });

  it('sin ninguna hoja asignada: motivo sin-hoja, hoja null', async () => {
    const acc = acciones({ activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 1 })), mias: vi.fn(async () => []) });
    const r = await cargarHojaActiva({ ronda: null, hojaId: null }, acc);
    expect(r).toMatchObject({ inventarioId: 5, ronda: 1, hojaId: null, hoja: null, motivo: 'sin-hoja' });
  });

  it('sin inventario en curso: motivo sin-inventario, nunca tira', async () => {
    const acc = acciones({ activo: vi.fn(async () => null) });
    const r = await cargarHojaActiva({ ronda: null, hojaId: null }, acc);
    expect(r).toMatchObject({ inventarioId: null, ronda: null, hoja: null, motivo: 'sin-inventario' });
  });
});

describe('con una hoja abierta: se resuelve por ID, no por número', () => {
  it('MISMA numeración en dos rondas: abre la hoja correcta por id, no por "001"', async () => {
    // La persona tiene abierta la hoja id=201 (que es su #001). Se resuelve por
    // id contra mias() -- que ya filtra por persona y ronda activa -- así que
    // el "001" que se repite en otras rondas/personas nunca puede confundirla.
    const miHoja = hoja({ id: 201, numero: '001', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 2 })),
      mias: vi.fn(async () => [miHoja]),
    });

    const r = await cargarHojaActiva({ ronda: 2, hojaId: 201 }, acc);

    expect(r.hoja).toBe(miHoja);
    expect(r.hojaId).toBe(201);
    expect(r.motivo).toBeNull();
  });

  it('EL BUG DEL CLIENTE — la ronda cambió y su hoja ya no está: hoja-vieja, hoja null (aviso), rondaVieja 2', async () => {
    // Tenía la #001 de la ronda 2 (id=201). El Coordinador abrió la 3ra: sus
    // hojas nuevas tienen otros ids; la 201 ya no está en mias(3).
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 3 })),
      mias: vi.fn(async () => [hoja({ id: 305, numero: '001', productos: [{ id: 1 } as never] })]),
    });

    const r = await cargarHojaActiva({ ronda: 2, hojaId: 201 }, acc);

    expect(r).toMatchObject({ ronda: 3, hoja: null, hojaId: null, motivo: 'hoja-vieja', rondaVieja: 2 });
  });

  it('la ronda es la MISMA pero la hoja se reasignó (ya no es suya): también hoja-vieja', async () => {
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 2 })),
      mias: vi.fn(async () => [hoja({ id: 202, numero: '002' })]), // la 201 ya no le pertenece.
    });

    const r = await cargarHojaActiva({ ronda: 2, hojaId: 201 }, acc);

    expect(r).toMatchObject({ ronda: 2, motivo: 'hoja-vieja', rondaVieja: 2 });
  });

  it('la hoja abierta sigue siendo válida: la trae ACTUALIZADA, sin aviso', async () => {
    const actualizada = hoja({ id: 201, numero: '001', estado: 'en-proceso', conteos: [{ productoId: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 2 })),
      mias: vi.fn(async () => [actualizada]),
    });

    const r = await cargarHojaActiva({ ronda: 2, hojaId: 201 }, acc);

    expect(r).toEqual({ inventarioId: 5, ronda: 2, hojaId: 201, hoja: actualizada, motivo: null, rondaVieja: null });
  });
});

describe('sin red: sigue con lo último bueno, nunca se cuelga ni borra nada', () => {
  it('activo() falla -> cae a inventarioIdSinRed/rondaActivaSinRed y resuelve la hoja local por id', async () => {
    const local = hoja({ id: 201, numero: '002', estado: 'en-proceso', productos: [{ id: 1 } as never] });
    const acc = acciones({
      activo: vi.fn(async () => {
        throw new Error('sin red');
      }),
      inventarioIdSinRed: vi.fn(async () => 5),
      rondaActivaSinRed: vi.fn(async () => 2),
      mias: vi.fn(async () => [local]),
    });

    const r = await cargarHojaActiva({ ronda: 2, hojaId: 201 }, acc);

    expect(r.hoja).toBe(local);
    expect(r.motivo).toBeNull();
  });

  it('sin red y sin nada descargado: sin-inventario, nunca tira', async () => {
    const acc = acciones({
      activo: vi.fn(async () => {
        throw new Error('sin red');
      }),
      inventarioIdSinRed: vi.fn(async () => null),
    });

    const r = await cargarHojaActiva({ ronda: null, hojaId: null }, acc);
    expect(r).toMatchObject({ inventarioId: null, ronda: null, hoja: null, motivo: 'sin-inventario' });
  });
});

describe('BUG REAL (2026-09-10): mias() revienta sin catch, cuelga la pantalla de Contar', () => {
  // `activo()` ya estaba protegido por el try/catch de arriba (cae a
  // sin red). `mias()` NO lo estaba: si el backend está caído, activo()
  // agota su reintento y tira, PERO acá activo() puede resolver bien
  // (por ejemplo desde SQLite/caché) y ser `mias()` la que revienta
  // después -- y esa excepción escapaba SIN CONTROL. En contar.tsx eso
  // dejaba `cargando` en true para siempre: la pantalla donde la persona
  // cuenta quedaba con el spinner girando, sin forma de salir salvo la
  // navegación de OTRO tab (si es que esta screen no bloqueaba eso también).
  it('mias() revienta -> NO debe escapar: motivo "error", nunca una excepción sin atrapar', async () => {
    const acc = acciones({
      activo: vi.fn(async () => ({ inventarioId: 5, rondaActiva: 1 })),
      mias: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });

    const r = await cargarHojaActiva({ ronda: null, hojaId: null }, acc);

    expect(r).toMatchObject({ inventarioId: 5, ronda: 1, hoja: null, hojaId: null, motivo: 'error' });
  });
});

describe('textoHojaVieja: el aviso que ve la persona', () => {
  it('ronda distinta: nombra la que cerró y a cuál volver', () => {
    expect(textoHojaVieja(2, 3)).toBe('Esta hoja es del 2do conteo, que ya cerró. Vuelve a Mis hojas para tomar una del 3er.');
  });

  it('misma ronda (reasignada) o sin ronda previa: no inventa un cierre de ronda', () => {
    expect(textoHojaVieja(2, 2)).toContain('ya no está asignada a ti');
    expect(textoHojaVieja(null, 2)).toContain('ya no está asignada a ti');
  });
});
