/**
 * Adaptador en memoria de RepositorioAjuste, MÁS la fase de cierre del
 * inventario en memoria (estado, ronda abierta y valores ajustados).
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts), y a propósito
 * que reproduzca las guardas reales en vez de decir que sí a todo: misma razón
 * que lacrado-memoria.ts. Acá se decide quién puede cambiar una cifra que
 * después se le descuenta del sueldo a alguien, y un mock permisivo hace que
 * la pantalla se pruebe contra un servidor que no existe.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA FASE VIVE ACÁ Y NO EN `_compartido.ts`
 * ---------------------------------------------------------------------------
 * `InventarioDemo` es el dataset de la demo -- hojas, productos, conteos -- y
 * nunca tuvo estado de cierre porque hasta ahora no hacía falta. La fase la
 * introduce ESTE cambio, así que vive con él: `inventario-memoria.ts` y
 * `auditoria-memoria.ts` la leen desde acá. La dependencia va en un solo
 * sentido y no hay ciclo.
 */

import { buscarHojaPorId, obtenerInventario, simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import { faseDeCierre, motivoValido, puedeAjustar, puedeCorregirLoContado } from '../dominio/ajuste-final';
import { totalUnidades } from '../dominio/empaque';
import type { CorreccionDeConteo, EstadoInventario, RepositorioAjuste } from '../puertos/repositorios';

/**
 * Dónde quedó parado el cierre de un inventario de la demo.
 *
 * Un solo registro y no tres mapas sueltos: las tres cosas cambian juntas
 * (abrir una ronda sube `ultimaRonda` Y la deja abierta; iniciar el ajuste
 * cambia el estado Y deja de haber ronda), y separarlas es como se llega a un
 * inventario en `ajuste_auditor` que además dice tener la ronda 3 abierta.
 */
interface CierreEnMemoria {
  estado: EstadoInventario;
  /** La ronda MÁS ALTA que existió. El mock siembra la 1. */
  ultimaRonda: number;
  /** Si esa última ronda sigue abierta. */
  rondaAbierta: boolean;
  /** `productoId -> unidades` que el auditor ya ajustó. */
  ajustes: Map<number, number>;
}

const cierres = new Map<number, CierreEnMemoria>();

function cierreDe(inventarioId: number): CierreEnMemoria {
  let cierre = cierres.get(inventarioId);
  if (!cierre) {
    // El default es el inventario recién armado: en curso, con la ronda 1
    // abierta y sin ningún ajuste.
    cierre = { estado: 'en_curso', ultimaRonda: 1, rondaAbierta: true, ajustes: new Map() };
    cierres.set(inventarioId, cierre);
  }
  return cierre;
}

export function estadoDeInventarioEnMemoria(inventarioId: number): EstadoInventario {
  return cierreDe(inventarioId).estado;
}

/** Los valores que el auditor ya ajustó en ese inventario. Vacío hasta que toca algo. */
export function ajustesEnMemoria(inventarioId: number): ReadonlyMap<number, number> {
  return cierreDe(inventarioId).ajustes;
}

/**
 * La ronda activa del inventario. `null` = la última ya cerró, o el
 * inventario dejó de estar `en_curso`.
 *
 * `null` NO es 1 (regla que ya documenta el puerto): con el ajuste en curso no
 * hay ronda que cerrar, y devolver un número ahí haría que la pantalla ofrezca
 * cerrar una ronda que no existe.
 *
 * `tieneHojas` lo pasa quien llama porque las hojas viven en `_compartido.ts`:
 * sin hojas creadas el Coordinador está en el paso 1 del armado y no hay
 * ronda todavía (mismo momento que `tamanoHoja: null`).
 */
export function rondaActivaEnMemoria(inventarioId: number, tieneHojas: boolean): number | null {
  const cierre = cierreDe(inventarioId);
  if (cierre.estado !== 'en_curso' || !tieneHojas || !cierre.rondaAbierta) return null;
  return cierre.ultimaRonda;
}

/**
 * Marca la ronda como cerrada. La llama `inventario-memoria.ts#cerrarRonda`:
 * sin esto, el mock cerraba la ronda y `activo()` seguía diciendo que estaba
 * abierta, así que la ventana del Coordinador y los botones del Auditor no
 * aparecían nunca.
 */
export function cerrarRondaEnMemoria(inventarioId: number): void {
  cierreDe(inventarioId).rondaAbierta = false;
}

/** Solo para tests: deja el adaptador como recién arrancado. */
export function limpiarAjusteMemoria(): void {
  cierres.clear();
}

// ---------------------------------------------------------------------------
// Guardas — las mismas que sostiene el servidor
// ---------------------------------------------------------------------------

/** Quién está en sesión, o truena: ningún cambio sobre una cifra de nómina es anónimo. */
async function quienCambia(): Promise<{ rol: string; sucursalId: number | null }> {
  const sesion = await sesionMemoria.sesionActiva();
  if (!sesion) {
    throw new Error('No hay sesión activa: toda corrección se registra contra quien está logueado.');
  }
  return { rol: sesion.colaborador.rol, sucursalId: sesion.sucursal?.id ?? null };
}

function exigirMotivo(motivo: string): void {
  // La MISMA regla que valida la pantalla (dominio/ajuste-final.ts). Si el
  // adaptador aceptara lo que la pantalla rechaza, el día que otra pantalla
  // llame a este método el motivo entraría vacío sin que nadie lo note.
  if (!motivoValido(motivo)) {
    throw new Error('Falta el motivo del cambio: sin eso el descuento no se puede explicar después.');
  }
}

/**
 * Las tres operaciones del Auditor comparten guarda: tiene que ser auditor Y
 * de la sucursal de ese inventario. Juntas en una función y no repetidas en
 * cada método -- cuatro copias son cuatro lugares donde acordarse de validar,
 * y uno se olvida.
 */
async function exigirAuditorDelInventario(inventarioId: number): Promise<number> {
  const inventario = await obtenerInventario(inventarioId);
  if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

  const quien = await quienCambia();
  if (quien.rol !== 'auditor') {
    throw new Error('Solo un Auditor puede abrir otro conteo o ajustar el inventario.');
  }
  // Audita toda la cadena, pero no dos tiendas a la vez: se compara contra la
  // sucursal de su ficha, igual que en lacrado-memoria.ts.
  if (quien.sucursalId !== inventario.sucursalId) {
    throw new Error('Solo un Auditor de la sucursal del inventario puede ajustarlo.');
  }
  return inventario.hojas.length;
}

/** La fase del inventario, con la ronda resuelta — las dos guardas la piden igual. */
async function faseDe(inventarioId: number): Promise<ReturnType<typeof faseDeCierre>> {
  const inventario = await obtenerInventario(inventarioId);
  const totalHojas = inventario?.hojas.length ?? 0;
  return faseDeCierre(
    estadoDeInventarioEnMemoria(inventarioId),
    rondaActivaEnMemoria(inventarioId, totalHojas > 0),
    totalHojas,
  );
}

// ---------------------------------------------------------------------------

export const ajusteMemoria: RepositorioAjuste = {
  async corregirConteo(hojaId, productoId, correccion: CorreccionDeConteo) {
    await simularLatencia();
    exigirMotivo(correccion.motivo);

    const hoja = await buscarHojaPorId(hojaId);
    if (!hoja) throw new Error(`Hoja ${hojaId} no encontrada.`);
    const inventario = await obtenerInventario(hoja.inventarioId);
    if (!inventario) throw new Error(`Inventario ${hoja.inventarioId} no encontrado.`);

    // CORRIGEN LOS DOS: el Coordinador (sin ver el stock) y el Auditor (con el
    // stock a la vista). Es la misma corrección sobre el mismo dato, así que
    // es el mismo permiso -- lo que cambia es qué ve cada uno en su pantalla,
    // no qué puede hacer.
    const quien = await quienCambia();
    if (quien.rol !== 'coordinador' && quien.rol !== 'auditor' && quien.rol !== 'administrador') {
      throw new Error('Solo el Coordinador, el Auditor o un Administrador pueden corregir un conteo cargado.');
    }
    // El Administrador no cuelga de una tienda y entra a todas; los otros dos
    // solo a la suya. Un auditor de otra sucursal corrigiendo conteos ajenos
    // es el mismo agujero que ya cierra `exigirAuditorDelInventario`.
    if (quien.rol !== 'administrador' && quien.sucursalId !== inventario.sucursalId) {
      throw new Error('Solo el Coordinador o el Auditor de la sucursal del inventario pueden corregir sus conteos.');
    }

    if (!puedeCorregirLoContado(await faseDe(inventario.id))) {
      throw new Error('El auditor ya empezó el ajuste final de este inventario: desde ahora los valores los cambia él.');
    }

    const producto = hoja.productos.find((p) => p.id === productoId);
    if (!producto) throw new Error(`El producto ${productoId} no está en la hoja ${hojaId}.`);

    // REEMPLAZA el valor, como dice el contrato. Quién, qué, antes y después
    // los registra el SERVIDOR (`registrarAuditoria`); el mock NO simula esa
    // bitácora, porque una auditoría que solo existe en el teléfono no es una
    // auditoría -- y simularla haría creer que el rastro quedó.
    const nuevo = {
      productoId,
      empaques: correccion.empaques,
      sueltas: correccion.sueltas,
      // La corrección la hace el Coordinador a mano: no la confirmó ningún
      // escáner, y decir que sí sería inventar una evidencia que no existe.
      confirmadoPorEscaner: false,
      contadoEn: new Date().toISOString(),
    };
    const indice = hoja.conteos.findIndex((c) => c.productoId === productoId);
    if (indice >= 0) hoja.conteos[indice] = nuevo;
    else hoja.conteos.push(nuevo);

    /**
     * `salioDeLaRonda` SIEMPRE null en el mock, y no es una simplificación:
     * para saber si un ítem sale de la ronda siguiente hay que compararlo
     * contra el stock del ERP, y este adaptador no lo tiene. Es el MISMO
     * límite que ya documenta `abrirRondaExtra` unas líneas más abajo -- el
     * mock ni siquiera materializa las hojas del reconteo, así que no hay
     * ronda siguiente de la cual sacar nada.
     *
     * Devolver una salida inventada sería peor que no devolver ninguna: la
     * pantalla diría "ya no sale en el 2do conteo" sin que eso haya pasado en
     * ningún lado.
     */
    return { salioDeLaRonda: null };
  },

  async abrirRondaExtra(inventarioId) {
    await simularLatencia();
    const hojas = await exigirAuditorDelInventario(inventarioId);
    const cierre = cierreDe(inventarioId);

    if (cierre.estado !== 'en_curso') {
      throw new Error('Solo se puede abrir otro conteo mientras el inventario sigue abierto.');
    }
    if (rondaActivaEnMemoria(inventarioId, hojas > 0) !== null) {
      throw new Error('Todavía hay una ronda abierta: ciérrala antes de abrir otro conteo.');
    }
    cierre.ultimaRonda += 1;
    cierre.rondaAbierta = true;
    // El mock NO materializa las hojas del reconteo: para saber qué ítems
    // vuelven hay que comparar contra el ERP, y eso solo lo puede hacer el
    // backend (mismo límite que documenta inventario-memoria.ts#cerrarRonda).
  },

  async iniciarAjuste(inventarioId) {
    await simularLatencia();
    const hojas = await exigirAuditorDelInventario(inventarioId);
    const cierre = cierreDe(inventarioId);

    if (cierre.estado === 'ajuste_auditor') throw new Error('El ajuste final de este inventario ya está en curso.');
    if (cierre.estado !== 'en_curso') throw new Error('Este inventario ya cerró su conteo: no hay ajuste que iniciar.');
    if (rondaActivaEnMemoria(inventarioId, hojas > 0) !== null) {
      throw new Error('Todavía hay una ronda abierta: ciérrala antes de empezar el ajuste final.');
    }
    cierre.estado = 'ajuste_auditor';
  },

  async ajustarItem(inventarioId, productoId, correccion: CorreccionDeConteo) {
    await simularLatencia();
    exigirMotivo(correccion.motivo);
    await exigirAuditorDelInventario(inventarioId);

    if (!puedeAjustar(await faseDe(inventarioId))) {
      throw new Error('El ajuste final todavía no empezó: primero inícialo desde el ciclo de conteos.');
    }

    // El empaque se resuelve contra el catálogo del inventario, no contra una
    // tabla propia: el factor tiene que ser el MISMO con el que se contó, o el
    // ajuste cambiaría las unidades sin que nadie tocara la cantidad.
    const inventario = await obtenerInventario(inventarioId);
    const producto = inventario?.hojas.flatMap((h) => h.productos).find((p) => p.id === productoId);
    if (!producto) throw new Error(`El producto ${productoId} no está en este inventario.`);

    cierreDe(inventarioId).ajustes.set(
      productoId,
      totalUnidades(
        {
          productoId,
          empaques: correccion.empaques,
          sueltas: correccion.sueltas,
          confirmadoPorEscaner: false,
          contadoEn: new Date().toISOString(),
        },
        producto.empaques,
      ),
    );
  },

  async cerrarAjuste(inventarioId) {
    await simularLatencia();
    await exigirAuditorDelInventario(inventarioId);

    const cierre = cierreDe(inventarioId);
    if (cierre.estado !== 'ajuste_auditor') {
      throw new Error('No hay ningún ajuste final en curso para este inventario.');
    }
    cierre.estado = 'conteo_cerrado';
  },
};
