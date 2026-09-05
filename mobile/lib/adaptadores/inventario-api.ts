/**
 * Adaptador HTTP de RepositorioInventario. Mismo puerto que
 * inventario-memoria.ts. Es el wizard de 3 pasos del Coordinador
 * (pantalla 2) más la lectura de `activo`.
 *
 * ---------------------------------------------------------------------------
 * PASO 1 (snapshot) — CONTRATO VERIFICADO contra backend/README.md §Dynamics
 * ---------------------------------------------------------------------------
 *   GET  /api/d365/estado    → { configurado: boolean }   (cualquier rol)
 *   POST /api/d365/snapshot  → { inventarioId, items, tomadoEn }
 *                              body { sucursalId, modo? }  (admin o coordinador)
 *
 * Todo lo que yo había deducido acá estaba MAL y quedó corregido: la ruta no
 * cuelga de `/api/sucursales/:id/...` sino de `/api/d365`, el `sucursalId` va
 * en el CUERPO y no en la URL, y sobre todo **no hay endpoint de estado de
 * progreso** — el backend resuelve el snapshot en una sola respuesta.
 *
 * PROBADO CONTRA EL SERVIDOR REAL (2026-09-04): `POST /api/d365/snapshot`
 * con `{sucursalId: 1}` devolvió `{inventarioId: 1, items: 4, tomadoEn: ...}`
 * — un inventario de verdad en Postgres, con la forma exacta que espera este
 * adaptador.
 *
 * ---------------------------------------------------------------------------
 * PASOS 2 y 3 — CONTRATO ADIVINADO. NO VERIFICADO.
 * ---------------------------------------------------------------------------
 * `crearHojas`, `asignarHojas` y `activo` siguen sin backend: el README dice
 * textual que "el paso 2, crear hojas, no está construido en este backend".
 * Sus rutas son deducción, igual que hojas-api.ts y catalogo-api.ts.
 *
 * ---------------------------------------------------------------------------
 * SOLO LECTURA DE DYNAMICS
 * ---------------------------------------------------------------------------
 * Confirmado por el README: "No hay, ni va a haber en esta fase, ningún
 * endpoint que escriba de vuelta a Dynamics". El `exportInventoryCount` del
 * proyecto hermano (que SÍ escribe) no está portado y este archivo no lo
 * consume. Si algún día aparece, no se enchufa acá sin decisión explícita del
 * cliente: un ajuste automático mal calculado corrige stock real en el ERP.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ PROGRESO: el backend no lo expone. No se inventa.
 * ---------------------------------------------------------------------------
 * El puerto pide `onAvance` porque bajar 8.000 ítems tarda minutos. Pero
 * `POST /api/d365/snapshot` devuelve UNA sola vez, al final: no hay stream ni
 * endpoint de estado que consultar. No existe, hoy, de dónde sacar "1.200 de
 * 8.000".
 *
 * Así que `onAvance` se llama dos veces y con la verdad: `{traidos: 0, total:
 * null}` al arrancar y el total real al terminar. `total: null` es
 * exactamente el caso que el puerto contempla para que la pantalla muestre un
 * spinner honesto en vez de una barra que miente — el mismo criterio, ahora
 * por una razón distinta (antes: Dynamics no contesta el total; ahora:
 * nuestro backend no lo reporta).
 *
 * Para progreso REAL hace falta que el backend deje estado consultable
 * mientras pagina (el módulo de referencia del proyecto hermano ya lo hace,
 * `getCurrentSyncStatus()`). `_http.ts#sondear` está escrito y testeado
 * esperando ese endpoint: el día que exista, se enchufa acá y nada más
 * cambia.
 */

import type { HojaConteo, TamanoHoja } from '../dominio/tipos';
import {
  ErrorSnapshot,
  type CierreRonda,
  type CodigoErrorSnapshot,
  type DesgloseSnapshot,
  type OpcionesTraerSnapshot,
  type RepositorioInventario,
  type ResumenRonda,
} from '../puertos/repositorios';
import { ErrorApi, pedir, TIMEOUT_LARGO_MS } from './_http';

const RUTAS = {
  // Verificadas contra el README.
  d365Estado: '/api/d365/estado',
  d365Snapshot: '/api/d365/snapshot',
  // Adivinadas: el backend todavía no tiene módulo de hojas/inventario.
  activo: (sucursalId: number) => `/api/sucursales/${sucursalId}/inventarios/activo`,
  crearHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas`,
  asignarHojas: (inventarioId: number) => `/api/inventarios/${inventarioId}/hojas/asignar`,
  resumenRonda: (inventarioId: number, ronda: number) => `/api/inventarios/${inventarioId}/rondas/${ronda}/resumen`,
  cerrarRonda: (inventarioId: number, ronda: number) => `/api/inventarios/${inventarioId}/rondas/${ronda}/cerrar`,
};

/**
 * El desglose todavía NO lo devuelve el servidor (verificado con curl el
 * 2026-09-04: la respuesta es `{inventarioId, items, tomadoEn}`). min3 lo
 * está dejando registrado del lado de Dynamics. Se declara opcional acá
 * para que el día que aparezca la pantalla lo muestre sin tocar una línea
 * — y mientras tanto no se inventa ningún número.
 */
interface SnapshotDto {
  inventarioId: number;
  items: number;
  tomadoEn: string;
  desglose?: DesgloseSnapshot;
}

interface InventarioActivoDto extends SnapshotDto {
  tamanoHoja: TamanoHoja | null;
  totalHojas: number;
}

/**
 * Traduce el error de transporte al vocabulario del puerto. La pantalla no
 * conoce `ErrorApi` ni códigos HTTP — necesita saber qué SALIDA ofrecerle a
 * la persona, y esa decisión se toma acá, una sola vez, en vez de en cada
 * pantalla que llame al snapshot.
 */
function comoErrorSnapshot(error: unknown): ErrorSnapshot {
  if (error instanceof ErrorSnapshot) return error;

  if (!(error instanceof ErrorApi)) {
    return new ErrorSnapshot('desconocido', 'No se pudo traer el catálogo de Dynamics.');
  }

  const directos: Partial<Record<string, CodigoErrorSnapshot>> = {
    'sin-red': 'sin-red',
    timeout: 'timeout',
    cancelado: 'cancelado',
  };
  const directo = directos[error.clase];
  if (directo) return new ErrorSnapshot(directo, error.message);

  // Se mira SIEMPRE el mensaje crudo del servidor, no `message`: en un 5xx
  // `message` ya fue reemplazado por el texto genérico y no queda rastro de
  // qué dijo el backend (ver _http.ts#mensajeServidor).
  const crudo = error.mensajeServidor ?? error.message;

  // 400 = `sucursalId` inválido O `modo="real"` sin credenciales (README).
  // El pre-chequeo de `/api/d365/estado` ya cubre el caso normal de "faltan
  // credenciales"; esto atrapa la carrera (se borraron entre el chequeo y el
  // POST) mirando el mensaje del backend, que es lo único que las distingue.
  if (error.clase === 'validacion' && /credencial|configurad|D365_/i.test(crudo)) {
    return new ErrorSnapshot('dynamics-no-configurado', error.message);
  }

  // Sucursal sin almacén de Dynamics asociado. Sin almacén no hay stock
  // (vive en `WarehousesOnHandV2`, se consulta por almacén), y sin stock no
  // hay contra qué contar. Es una salida DISTINTA de "faltan credenciales":
  // esto lo arregla un Administrador en Tiendas, no en Configuración.
  if (/almac[ée]n|warehouse/i.test(crudo)) {
    return new ErrorSnapshot('sin-almacen', crudo);
  }

  // 502 = "Dynamics respondió con error o no se pudo autenticar" (README).
  // Son dos cosas distintas bajo un mismo código, y solo el mensaje las
  // separa. Si el backend expusiera un código propio esto dejaría de ser
  // adivinanza — vale la pena pedírselo.
  if (error.estado === 502) {
    const esAuth = /autentic|credencial|401|unauthorized/i.test(crudo);
    return esAuth
      ? new ErrorSnapshot('credenciales-rechazadas', 'Azure rechazó las credenciales de Dynamics configuradas.')
      : new ErrorSnapshot('desconocido', 'Dynamics respondió con un error al pedirle el catálogo.');
  }

  return new ErrorSnapshot('desconocido', error.message);
}

export const inventarioApi: RepositorioInventario = {
  async traerSnapshot(sucursalId: number, opciones: OpcionesTraerSnapshot = {}) {
    const { onAvance, signal, tipo = 'mensual' } = opciones;

    try {
      // Arranca honesto: todavía no llegó nada y no sabemos cuántos son.
      onAvance?.({ traidos: 0, total: null });

      // Pre-chequeo. Sin esto, "faltan credenciales" llega como un 400
      // genérico indistinguible de "sucursalId inválido", y la pantalla no
      // podría mandar al Administrador a cargarlas — que es justamente la
      // salida que el puerto pide para `dynamics-no-configurado`.
      const estado = await pedir<{ configurado: boolean }>(RUTAS.d365Estado, { senal: signal });
      if (!estado.configurado) {
        throw new ErrorSnapshot(
          'dynamics-no-configurado',
          'Faltan las credenciales de Dynamics. Un Administrador las carga en Configuración.',
        );
      }

      // `modo` se OMITE: el default del backend es "real". Nunca se manda
      // "ejemplo" desde acá — sustituir datos reales por los 4 de muestra sin
      // que nadie lo pida es exactamente la clase de silencio que arruina un
      // inventario. Si hace falta demostrar sin credenciales, se usa el
      // adaptador en memoria (ver contenedor.ts).
      //
      // NO se reintenta solo, aunque el backend garantice idempotencia: el
      // puerto dice que ante `sin-red` "se reintenta solo" DESDE LA PANTALLA.
      // Que reintenten las dos capas es cómo una espera de minutos se
      // convierte en tres.
      // `tipo` SIEMPRE explícito, aunque el default del backend coincida:
      // el universo que se cuenta es una decisión del Coordinador y tiene
      // que viajar dicha, no asumida. El día que el default del servidor
      // cambie, esta pantalla no cambia de comportamiento sin que nadie lo
      // haya pedido.
      //
      // `almacen` NO se manda: el backend lo resuelve de la sucursal
      // (`Sucursal.almacenId`, ya verificado contra el ERP al guardarlo).
      // Mandarlo desde el teléfono sería dejar que el cliente elija contra
      // qué almacén se cuenta.
      const resultado = await pedir<SnapshotDto>(RUTAS.d365Snapshot, {
        metodo: 'POST',
        cuerpo: { sucursalId, tipo },
        msTimeout: TIMEOUT_LARGO_MS,
        senal: signal,
      });

      onAvance?.({ traidos: resultado.items, total: resultado.items });
      return resultado;
    } catch (error) {
      throw comoErrorSnapshot(error);
    }
  },

  async crearHojas(inventarioId, tamano) {
    return pedir<HojaConteo[]>(RUTAS.crearHojas(inventarioId), {
      metodo: 'POST',
      cuerpo: { tamano },
    });
  },

  async asignarHojas(inventarioId, colaboradorIds) {
    // El ORDEN del array es el orden de reparto (el primero se lleva el
    // primer bloque, ver dominio/lote.ts#repartir): se manda tal cual, sin
    // ordenar ni deduplicar acá.
    return pedir<HojaConteo[]>(RUTAS.asignarHojas(inventarioId), {
      metodo: 'POST',
      cuerpo: { colaboradorIds },
    });
  },

  async resumenRonda(inventarioId, ronda) {
    // Mapeo directo: la forma de `ResumenRondaDto` (rondas.service.ts) coincide
    // campo a campo con `ResumenRonda` del puerto —los siete del embudo
    // (total/contados/sinContar/cuadrados/aRecontar/sinDatoErp/porcentajeCuadrado)
    // más inventarioId, ronda, hojasSinFinalizar, sePuedeCerrar, siguienteRonda
    // y motivoSinSiguiente. Verificado contra el service, no adivinado.
    return pedir<ResumenRonda>(RUTAS.resumenRonda(inventarioId, ronda));
  },

  async cerrarRonda(inventarioId, ronda) {
    // Body vacío: qué se cierra y qué se abre lo decide el backend leyendo el
    // inventario (rondas.service.ts#cerrar), igual que el lacrado. La forma de
    // `CierreDeRondaDto` coincide con `CierreRonda`; `hojas` son `HojaDto[]`
    // que ya calzan con `HojaConteo` (mismo mapeo que crearHojas/asignarHojas).
    return pedir<CierreRonda>(RUTAS.cerrarRonda(inventarioId, ronda), { metodo: 'POST', cuerpo: {} });
  },

  async activo(sucursalId) {
    // null = "el Coordinador todavía no trajo el snapshot", que es un estado
    // normal de la pantalla de inicio, no un error.
    try {
      return await pedir<InventarioActivoDto>(RUTAS.activo(sucursalId));
    } catch (error) {
      if (error instanceof ErrorApi && error.clase === 'no-encontrado') return null;
      throw error;
    }
  },
};
