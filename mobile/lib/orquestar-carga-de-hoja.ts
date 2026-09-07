import type { HojaConteo } from './dominio/tipos';

/**
 * Orquesta la resolución de "qué hoja le toca ver al Contador ahora mismo"
 * en `app/conteo/contar.tsx` — vive FUERA de la pantalla para poder
 * probarse sin montar React Native, mismo criterio que `ejecutar-ingreso.ts`.
 *
 * HALLAZGO (2026-09-08, cliente en el ciclo real): el Coordinador cerró el
 * 2do conteo y asignó las hojas del 3ro con el Contador todavía con la app
 * ABIERTA — la pantalla siguió mostrando la ronda 2 hasta que cerró y
 * volvió a abrir la app. Causa: `contar.tsx` resolvía la ronda activa UNA
 * sola vez al montar, y el refresco de cada visita (`useFocusEffect`) solo
 * volvía a pedir la MISMA hoja/ronda que ya tenía en estado — nunca
 * volvía a preguntar `activo()` si la ronda activa había cambiado.
 *
 * La regla que arregla esto: si la ronda resuelta AHORA es distinta de la
 * que tenía la pantalla, el número de hoja que se venía mostrando era de
 * la ronda vieja — se descarta y se vuelve a elegir para la nueva (misma
 * lógica de "buscar mi hoja en proceso" que la primera carga), en vez de
 * arrastrarlo a ciegas. Si la ronda NO cambió, se reusa el número ya
 * elegido y solo se refresca esa hoja — el comportamiento de siempre.
 *
 * Los conteos locales sin sincronizar de la ronda vieja NUNCA se tocan
 * acá: esta función solo decide QUÉ MOSTRAR, nunca borra nada — mismo
 * criterio que `asegurarSembrada` (hojas-sqlite.ts) protege siempre el
 * trabajo del Contador.
 */
export interface AccionesCargaHoja {
  activo: () => Promise<{ inventarioId: number; rondaActiva: number | null } | null>;
  /** Sin red (u otra falla de `activo`): cae al inventario/ronda que ya se descargó localmente alguna vez. */
  inventarioIdSinRed: () => Promise<number | null>;
  rondaActivaSinRed: (inventarioId: number) => Promise<number | null>;
  mias: (inventarioId: number, ronda: number) => Promise<HojaConteo[]>;
  porNumero: (inventarioId: number, numero: string, ronda: number) => Promise<HojaConteo | null>;
}

export interface EstadoCargaHoja {
  inventarioId: number | null;
  ronda: number | null;
  numeroActivo: string | null;
  hoja: HojaConteo | null;
}

/** De la lista de `mias()`, la hoja que le corresponde ver: la que está en proceso, o si ninguna, la primera con catálogo cargado. */
function elegirNumeroDeHoja(hojas: HojaConteo[]): string | null {
  const actual = hojas.find((h) => h.estado === 'en-proceso' && h.productos.length > 0) ?? hojas.find((h) => h.productos.length > 0);
  return actual?.numero ?? null;
}

export async function cargarHojaActiva(
  estadoActual: Pick<EstadoCargaHoja, 'ronda' | 'numeroActivo'>,
  acciones: AccionesCargaHoja,
): Promise<EstadoCargaHoja> {
  let inventarioId: number | null;
  let ronda: number | null;
  try {
    const activo = await acciones.activo();
    inventarioId = activo?.inventarioId ?? null;
    ronda = activo?.rondaActiva ?? null;
  } catch {
    // Sin red (u otra falla): no hay forma de preguntarle al servidor cuál
    // es la ronda activa, pero el avance de hoy puede estar completo en
    // SQLite — se sigue con eso en vez de dejar la pantalla colgada.
    inventarioId = await acciones.inventarioIdSinRed();
    ronda = inventarioId ? await acciones.rondaActivaSinRed(inventarioId) : null;
  }

  if (!inventarioId || ronda === null) {
    return { inventarioId, ronda, numeroActivo: null, hoja: null };
  }

  // La ronda activa cambió respecto a la que tenía la pantalla: el número
  // que se venía mostrando era de la ronda vieja, se vuelve a elegir.
  const cambioDeRonda = estadoActual.ronda !== null && ronda !== estadoActual.ronda;
  let numeroActivo = cambioDeRonda ? null : estadoActual.numeroActivo;

  if (!numeroActivo) {
    const mias = await acciones.mias(inventarioId, ronda);
    numeroActivo = elegirNumeroDeHoja(mias);
  }

  if (!numeroActivo) {
    return { inventarioId, ronda, numeroActivo: null, hoja: null };
  }

  const hoja = await acciones.porNumero(inventarioId, numeroActivo, ronda);
  return { inventarioId, ronda, numeroActivo, hoja };
}
