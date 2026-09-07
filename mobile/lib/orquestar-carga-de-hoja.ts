import type { HojaConteo } from './dominio/tipos';
import { ORDINAL } from './dominio/texto-cierre-ronda';

/**
 * Orquesta la resolución de "qué hoja le toca ver al Contador ahora mismo"
 * en `app/conteo/contar.tsx` — vive FUERA de la pantalla para poder probarse
 * sin montar React Native, mismo criterio que `ejecutar-ingreso.ts`.
 *
 * HALLAZGO DEL CLIENTE (2026-09-08): tenía abierta la Hoja #001 de la RONDA 2;
 * el Coordinador cerró esa ronda y abrió la 3ra. Al refrescar la ronda activa,
 * la pantalla resolvía el NÚMERO "001" contra la ronda 3 -> terminaba parado
 * en OTRA hoja #001, de otra persona, con los mismos productos a la vista;
 * cada conteo daba 403. Causa: el número de hoja se REPITE en cada ronda, no
 * es identidad.
 *
 * La regla que arregla esto: se navega y se resuelve por `hojaId` (identidad
 * ESTABLE entre rondas), buscando la hoja abierta en `mias()` de la ronda
 * ACTIVA -- que son las hojas de la ronda en curso asignadas a esta persona.
 * Buscar por id ahí enforcea las dos condiciones a la vez: ronda activa Y
 * pertenencia. Si el id ya no está (la ronda se cerró, o se reasignó), la hoja
 * quedó VIEJA: se saca de la vista con un aviso claro, en vez de dejar contar
 * en el vacío.
 *
 * Los conteos locales sin sincronizar NUNCA se tocan acá: esta función solo
 * decide QUÉ MOSTRAR, jamás borra nada (mismo criterio que `asegurarSembrada`
 * en hojas-sqlite.ts, que siempre protege el trabajo del Contador).
 */
export interface AccionesCargaHoja {
  activo: () => Promise<{ inventarioId: number; rondaActiva: number | null } | null>;
  /** Sin red (u otra falla de `activo`): cae al inventario/ronda que ya se descargó localmente alguna vez. */
  inventarioIdSinRed: () => Promise<number | null>;
  rondaActivaSinRed: (inventarioId: number) => Promise<number | null>;
  /** Las hojas de la ronda dada asignadas a esta persona. La resolución por id se hace contra esto. */
  mias: (inventarioId: number, ronda: number) => Promise<HojaConteo[]>;
}

/**
 * Por qué NO hay hoja para mostrar:
 *   'sin-inventario'  no hay inventario/ronda en curso todavía.
 *   'sin-hoja'        hay ronda, pero a esta persona no le asignaron ninguna.
 *   'hoja-vieja'      la que estaba abierta ya no es de la ronda activa (o se
 *                     reasignó): se saca de la vista con un aviso.
 */
export type MotivoSinHoja = 'sin-inventario' | 'sin-hoja' | 'hoja-vieja';

export interface EstadoCargaHoja {
  inventarioId: number | null;
  ronda: number | null;
  /** La hoja resuelta, por ID (identidad estable). null si no hay ninguna válida. */
  hojaId: number | null;
  hoja: HojaConteo | null;
  motivo: MotivoSinHoja | null;
  /** La ronda en la que estaba la hoja que quedó vieja — para el texto del aviso. */
  rondaVieja: number | null;
}

/** La hoja que le toca ver a quien entra sin una elegida: la que está en proceso, o si no, la primera con catálogo cargado. */
function elegirHoja(hojas: HojaConteo[]): HojaConteo | null {
  return (
    hojas.find((h) => h.estado === 'en-proceso' && h.productos.length > 0) ??
    hojas.find((h) => h.productos.length > 0) ??
    null
  );
}

/**
 * El aviso cuando la hoja abierta quedó vieja. Si cambió la ronda, dice de cuál
 * era y a cuál volver; si es la misma ronda (se reasignó a otra persona), lo
 * dice sin inventar un cierre de ronda que no pasó.
 */
export function textoHojaVieja(rondaVieja: number | null, rondaActiva: number): string {
  if (rondaVieja !== null && rondaVieja !== rondaActiva) {
    return `Esta hoja es del ${ORDINAL[rondaVieja]} conteo, que ya cerró. Vuelve a Mis hojas para tomar una del ${ORDINAL[rondaActiva]}.`;
  }
  return 'Esta hoja ya no está asignada a ti. Vuelve a Mis hojas para ver las que te tocan ahora.';
}

export async function cargarHojaActiva(
  estadoActual: { ronda: number | null; hojaId: number | null },
  acciones: AccionesCargaHoja,
): Promise<EstadoCargaHoja> {
  let inventarioId: number | null;
  let ronda: number | null;
  try {
    const activo = await acciones.activo();
    inventarioId = activo?.inventarioId ?? null;
    ronda = activo?.rondaActiva ?? null;
  } catch {
    // Sin red (u otra falla): no hay forma de preguntarle al servidor cuál es
    // la ronda activa, pero el avance de hoy puede estar completo en SQLite —
    // se sigue con eso en vez de dejar la pantalla colgada.
    inventarioId = await acciones.inventarioIdSinRed();
    ronda = inventarioId ? await acciones.rondaActivaSinRed(inventarioId) : null;
  }

  if (!inventarioId || ronda === null) {
    return { inventarioId, ronda, hojaId: null, hoja: null, motivo: 'sin-inventario', rondaVieja: estadoActual.ronda };
  }

  // Se resuelve SIEMPRE contra `mias()` de la ronda ACTIVA. El número de hoja
  // no sirve para resolver: se repite en cada ronda. El id, sí.
  const mias = await acciones.mias(inventarioId, ronda);

  if (estadoActual.hojaId !== null) {
    const abierta = mias.find((h) => h.id === estadoActual.hojaId);
    if (abierta) {
      return { inventarioId, ronda, hojaId: abierta.id, hoja: abierta, motivo: null, rondaVieja: null };
    }
    // La hoja abierta ya no está entre las de la ronda activa asignadas a la
    // persona: quedó vieja. Se saca de la vista con aviso (cada conteo sobre
    // ella daría 403).
    return { inventarioId, ronda, hojaId: null, hoja: null, motivo: 'hoja-vieja', rondaVieja: estadoActual.ronda };
  }

  // Entró sin una hoja elegida (por el tab): se elige la que le corresponde.
  const elegida = elegirHoja(mias);
  if (!elegida) {
    return { inventarioId, ronda, hojaId: null, hoja: null, motivo: 'sin-hoja', rondaVieja: null };
  }
  return { inventarioId, ronda, hojaId: elegida.id, hoja: elegida, motivo: null, rondaVieja: null };
}
