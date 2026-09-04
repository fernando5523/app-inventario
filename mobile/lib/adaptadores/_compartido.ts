/**
 * Estado compartido en memoria para hojas-memoria.ts, catalogo-memoria.ts
 * e inventario-memoria.ts.
 *
 * No es un adaptador de un puerto: es la "base de datos" en memoria que
 * esos tres adaptadores leen y escriben. Sin esto, una hoja creada por
 * inventario-memoria.ts (paso 2 del Coordinador) sería invisible para
 * hojas-memoria.ts (lo que ve el Contador) — cada uno tendría su propia
 * copia y nunca cerrarían los números.
 *
 * El dataset de arranque (Market Central Luzuriaga, 160 hojas de 50
 * items, 8.000 items) es el que ya validaron las maquetas
 * (mobile/design/hojas.html, mis-hojas.html, conteo.html) — no se
 * inventa nada nuevo acá. Donde las maquetas no documentan un dato
 * (ej. productos de una hoja que no sea la #002), se deja vacío en vez
 * de rellenarlo con datos inventados.
 */

import { finalizar as finalizarDominio, puedeEditar } from '../dominio/hoja';
import { partirEnHojas, repartir } from '../dominio/lote';
import type { Colaborador, Conteo, Empaque, HojaConteo, Producto, TamanoHoja } from '../dominio/tipos';
import { sesionMemoria } from './sesion-memoria';

// ---------------------------------------------------------------------------
// Latencia simulada
// ---------------------------------------------------------------------------

/**
 * Simula latencia de red corta (100-200ms por defecto). Sin esto, todo
 * adaptador en memoria resuelve instantáneo y las pantallas se escriben
 * sin estados de carga — y después explotan contra la red de verdad.
 */
export function simularLatencia(msMin = 100, msMax = 200): Promise<void> {
  const ms = msMin + Math.random() * (msMax - msMin);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Empaques (validado: mobile/design/conteo.html)
// ---------------------------------------------------------------------------

export const EMPAQUES: Record<'caja' | 'pack' | 'plancha' | 'fardo', Empaque> = {
  caja: { nombre: 'Caja', factor: 12 },
  pack: { nombre: 'Pack', factor: 6 },
  plancha: { nombre: 'Plancha', factor: 24 },
  fardo: { nombre: 'Fardo', factor: 20 },
};

// ---------------------------------------------------------------------------
// Zonas físicas de Market Central Luzuriaga (validado: mobile/design/hojas.html)
// ---------------------------------------------------------------------------

interface Zona {
  letra: string;
  nombre: string;
  items: number;
}

/** 2000+1500+1400+1200+1100+800 = 8.000. Verificado con python antes de cargar. */
const ZONAS_LUZURIAGA: Zona[] = [
  { letra: 'A', nombre: 'Abarrotes', items: 2000 },
  { letra: 'B', nombre: 'Lácteos', items: 1500 },
  { letra: 'C', nombre: 'Limpieza', items: 1400 },
  { letra: 'D', nombre: 'Bebidas', items: 1200 },
  { letra: 'E', nombre: 'Licores', items: 1100 },
  { letra: 'F', nombre: 'Perecibles', items: 800 },
];

const SUCURSAL_LUZURIAGA_ID = 1;
const TOTAL_ITEMS_LUZURIAGA = ZONAS_LUZURIAGA.reduce((acc, z) => acc + z.items, 0); // 8.000

interface EspecificacionHoja {
  zona: string;
  gondola: string;
  tamano: number;
}

/** Zona a la que pertenece el item en esa posición (0-indexado) del catálogo. */
function zonaDelItem(indice: number): Zona {
  let acumulado = 0;
  for (const zona of ZONAS_LUZURIAGA) {
    acumulado += zona.items;
    if (indice < acumulado) return zona;
  }
  return ZONAS_LUZURIAGA[ZONAS_LUZURIAGA.length - 1];
}

/**
 * Arma zona + góndola para cada hoja de un inventario.
 *
 * OJO con la trampa numérica de acá: particionar CADA ZONA por separado
 * con partirEnHojas (2000/30, 1500/30, ...) da 268 hojas a tamaño 30, no
 * las 267 ya validadas por el cliente (ver mobile/design/hojas.html) —
 * cada zona termina con su PROPIA hoja parcial en vez de que los restos
 * se junten en una sola. La cuenta correcta sale de particionar el
 * TOTAL global una sola vez (partirEnHojas(8000, tamano), fuente única
 * de verdad del total) y recién ahí asignarle zona a cada hoja según en
 * qué zona cae su primer ítem. A tamaño 50 da exactamente lo mismo que
 * particionar zona por zona (todas dividen exacto); a 30 es lo que
 * evita la hoja de más.
 */
function armarZonasYGondolas(tamano: TamanoHoja): EspecificacionHoja[] {
  const tamanos = partirEnHojas(TOTAL_ITEMS_LUZURIAGA, tamano);
  const resultado: EspecificacionHoja[] = [];
  const posicionPorZona = new Map<string, number>();

  let cursorItem = 0;
  for (const tam of tamanos) {
    const zona = zonaDelItem(cursorItem);
    const posicion = (posicionPorZona.get(zona.nombre) ?? 0) + 1;
    posicionPorZona.set(zona.nombre, posicion);
    resultado.push({ zona: zona.nombre, gondola: `${zona.letra}${posicion}`, tamano: tam });
    cursorItem += tam;
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Productos reales de la Hoja #002 (validado: mobile/design/conteo.html)
// ---------------------------------------------------------------------------

/**
 * `empaques` es una lista (decisión del cliente: un producto puede venir
 * en más de una presentación — ver lib/dominio/tipos.ts#Producto). El
 * Aceite Vegetal Primor tiene DOS a propósito (Caja Y Pack), como
 * catálogo de ejemplo real de ese caso — los otros tres se quedan con
 * uno solo, sin inventar una segunda presentación que ningún dato
 * respalda. Ninguno trae `codigoBarras` por empaque: dato real de
 * Dynamics (min-1, catálogo real) es que los barcodes que trae son de la
 * unidad suelta, ninguno identifica un empaque — no se inventa uno acá
 * para que el escáner "funcione mejor" de lo que funciona de verdad.
 */
const BASE_PRODUCTOS: Array<{ descripcion: string; empaques: Array<keyof typeof EMPAQUES>; codigoBarras: string }> = [
  { descripcion: 'Aceite Vegetal Primor 1L', empaques: ['caja', 'pack'], codigoBarras: '7750123051' },
  { descripcion: 'Cerveza Cusqueña Trigo 310ml', empaques: ['pack'], codigoBarras: '7750999015' },
  { descripcion: 'Leche Evaporada Gloria Azul 400g', empaques: ['plancha'], codigoBarras: '7750123088' },
  { descripcion: 'Fideos Canuto Lavaggi 500g', empaques: ['fardo'], codigoBarras: '7750123054' },
];
const NIVELES = ['Nivel 1', 'Nivel 2', 'Nivel 3'];
const CODIGO_DESDE_HOJA_002 = 51; // Hoja #002 = códigos 0051-0100

/**
 * 50 productos de la Hoja #002, con 32 ya contados — los mismos valores
 * EXACTOS de mobile/design/conteo.html (2 Cajas x12 + 0 = 24, 5 Packs x6
 * + 2 = 32, 2 Planchas x24 + 5 = 53; verificados con totalUnidades()
 * antes de escribir este archivo). Es la ÚNICA hoja con productos
 * reales: el resto de las 160 no tiene catálogo documentado en ninguna
 * maqueta, y acá no se inventa uno para rellenar.
 */
function armarProductosYConteosHoja002(fechaDemo: string): { productos: Producto[]; conteos: Conteo[] } {
  const productos: Producto[] = [];
  const conteos: Conteo[] = [];

  for (let i = 0; i < 50; i++) {
    const codigo = String(CODIGO_DESDE_HOJA_002 + i).padStart(4, '0');
    const base = BASE_PRODUCTOS[i % BASE_PRODUCTOS.length];
    const codigoBarras = i < BASE_PRODUCTOS.length ? base.codigoBarras : `${base.codigoBarras.slice(0, 6)}${codigo}`;
    const empaquesDelProducto = base.empaques.map((k) => EMPAQUES[k]);
    const producto: Producto = {
      id: i + 1,
      codigo,
      codigoBarras,
      descripcion: base.descripcion,
      empaques: empaquesDelProducto,
      ubicacion: `Góndola A2 · ${NIVELES[i % NIVELES.length]}`,
    };
    productos.push(producto);

    // Contado = true en exactamente 32 de 50: índices 0-2 y 4-32 (igual
    // que conteo.html). El índice 3 (Lavaggi) queda deliberadamente sin
    // contar, como en la maqueta.
    const contado = i < 3 || (i >= 4 && i < 33);
    if (!contado) continue;

    // Los 3 casos validados contra el mockup cuentan UN solo empaque
    // (el [0] de la lista) — una segunda presentación en el catálogo no
    // cambia lo que YA se contó para estos índices puntuales.
    const empaqueDefault = empaquesDelProducto[0];
    let cantidadEmpaque: number;
    let sueltas: number;
    if (i === 0) {
      cantidadEmpaque = 2;
      sueltas = 0; // 2 Cajas x12 + 0 = 24
    } else if (i === 1) {
      cantidadEmpaque = 5;
      sueltas = 2; // 5 Packs x6 + 2 = 32
    } else if (i === 2) {
      cantidadEmpaque = 2;
      sueltas = 5; // 2 Planchas x24 + 5 = 53
    } else {
      cantidadEmpaque = 1 + (i % 3);
      sueltas = (i * 3) % empaqueDefault.factor;
    }

    conteos.push({
      productoId: producto.id,
      empaques: [{ empaqueNombre: empaqueDefault.nombre, cantidad: cantidadEmpaque }],
      sueltas,
      confirmadoPorEscaner: i < 3,
      contadoEn: fechaDemo,
    });
  }

  return { productos, conteos };
}

// ---------------------------------------------------------------------------
// Inventarios (estado mutable)
// ---------------------------------------------------------------------------

export interface InventarioDemo {
  id: number;
  sucursalId: number;
  snapshotItems: number;
  snapshotTomadoEn: string;
  tamanoHoja: TamanoHoja | null;
  hojas: HojaConteo[];
}

const inventariosPorId = new Map<number, InventarioDemo>();
let proximoInventarioId = 1;
let proximaHojaId = 1;

export function registrarInventario(sucursalId: number, items: number, tomadoEn: string): InventarioDemo {
  const inventario: InventarioDemo = {
    id: proximoInventarioId++,
    sucursalId,
    snapshotItems: items,
    snapshotTomadoEn: tomadoEn,
    tamanoHoja: null,
    hojas: [],
  };
  inventariosPorId.set(inventario.id, inventario);
  return inventario;
}

/**
 * Reemplaza las hojas del inventario por un lote nuevo (todas pendientes,
 * sin asignar, sin productos): esto es lo que hace de verdad el paso 2
 * del Coordinador. OJO: es destructivo sobre cualquier reparto/avance
 * anterior de ese inventario — correcto para un paso 2 real, pero quien
 * pruebe el wizard contra el inventario ya sembrado de Luzuriaga (ver
 * sembrarLuzuriaga más abajo) va a perder su estado de ejemplo si lo
 * llama de nuevo.
 */
export function crearHojasEnInventario(inventario: InventarioDemo, tamano: TamanoHoja): HojaConteo[] {
  const especificaciones = armarZonasYGondolas(tamano);
  const nuevas: HojaConteo[] = especificaciones.map((spec, indice) => ({
    id: proximaHojaId++,
    inventarioId: inventario.id,
    numero: String(indice + 1).padStart(3, '0'),
    zona: spec.zona,
    gondola: spec.gondola,
    tamano: spec.tamano,
    estado: 'pendiente',
    sync: 'local',
    asignados: [],
    productos: [],
    conteos: [],
  }));
  inventario.tamanoHoja = tamano;
  inventario.hojas = nuevas;
  return nuevas;
}

/**
 * Reparte las hojas sin asignar del inventario entre los colaboradores
 * dados, en bloques contiguos (dominio: repartir()). El orden de
 * `colaboradorIds` es el orden de reparto: el primero se lleva el primer
 * bloque.
 */
export function asignarHojasEnInventario(
  inventario: InventarioDemo,
  colaboradorIds: number[],
  colaboradoresDeLaSucursal: Colaborador[],
): HojaConteo[] {
  const porId = new Map(colaboradoresDeLaSucursal.map((c) => [c.id, c] as const));
  const personas = colaboradorIds.map((id) => {
    const colaborador = porId.get(id);
    if (!colaborador) throw new Error(`El colaborador ${id} no pertenece a esta sucursal.`);
    return colaborador;
  });

  const sinAsignar = inventario.hojas.filter((h) => h.asignados.length === 0);
  const asignaciones = repartir(sinAsignar, personas);
  for (const bloque of asignaciones) {
    for (const hoja of bloque.hojas) {
      hoja.asignados = [bloque.persona.nombre];
    }
  }
  return inventario.hojas;
}

/**
 * Números de hoja "finalizada" en el dataset de ejemplo: 34 hojas, FUERA
 * del bloque de María Rojas (#001-#020) — si cualquiera de esas 34 cayera
 * en su bloque, su Inicio y Mis Hojas contarían una historia distinta a
 * la que ya validó el cliente (1 hoja en proceso + 19 pendientes, nunca
 * "finalizada sin catálogo cargado"). Elección determinista y simple, no
 * aleatoria: #041 a #074.
 */
function estaFinalizadaEnDemo(numeroHoja: number): boolean {
  return numeroHoja >= 41 && numeroHoja <= 74;
}

const FECHA_DEMO = '2026-09-01T09:41:00-05:00'; // mismo momento que ya usa hojas.html

/**
 * Siembra el inventario de Luzuriaga reusando el mismo camino que usaría
 * el Coordinador de verdad (crearHojasEnInventario + asignarHojasEnInventario,
 * con partirEnHojas/repartir del dominio) y encima le pone la
 * "fotografía" de ejemplo que ya validaron las maquetas: 34 hojas
 * finalizadas y la #002 en proceso con productos reales. Cero lógica de
 * reparto duplicada: la única parte que no sale del dominio es la
 * narrativa de qué hojas están en qué estado.
 */
async function sembrarLuzuriaga(): Promise<InventarioDemo> {
  const inventario = registrarInventario(SUCURSAL_LUZURIAGA_ID, TOTAL_ITEMS_LUZURIAGA, FECHA_DEMO);
  crearHojasEnInventario(inventario, 50);

  const colaboradores = await sesionMemoria.colaboradores(SUCURSAL_LUZURIAGA_ID);
  const contadores = colaboradores.filter((c) => c.rol === 'conteo');
  asignarHojasEnInventario(
    inventario,
    contadores.map((c) => c.id),
    colaboradores,
  );

  for (const hoja of inventario.hojas) {
    const numeroActual = Number(hoja.numero);
    if (numeroActual === 2) {
      const { productos, conteos } = armarProductosYConteosHoja002(FECHA_DEMO);
      hoja.productos = productos;
      hoja.conteos = conteos;
      hoja.estado = 'en-proceso';
      continue;
    }
    // Todas las hojas menos la #002 (la de María Rojas, que se deja
    // "local" a propósito para la demo del Contador) están sincronizadas
    // — si no, `todoSincronizado` de RepositorioLacrado nunca da true y
    // el lacrado del Auditor queda bloqueado para siempre.
    hoja.sync = 'sincronizado';
    if (estaFinalizadaEnDemo(numeroActual)) {
      hoja.estado = 'finalizada';
    }
  }

  return inventario;
}

let semillaPromise: Promise<void> | null = null;
/** Memoiza la promesa (no solo el resultado): dos llamadas concurrentes
 *  antes de que la siembra termine no deben sembrar dos veces. */
function asegurarSemilla(): Promise<void> {
  if (!semillaPromise) {
    semillaPromise = sembrarLuzuriaga().then(() => undefined);
  }
  return semillaPromise;
}

export async function obtenerInventario(inventarioId: number): Promise<InventarioDemo | undefined> {
  await asegurarSemilla();
  return inventariosPorId.get(inventarioId);
}

export async function obtenerInventarioDeSucursal(sucursalId: number): Promise<InventarioDemo | undefined> {
  await asegurarSemilla();
  for (const inventario of inventariosPorId.values()) {
    if (inventario.sucursalId === sucursalId) return inventario;
  }
  return undefined;
}

export async function buscarHojaPorId(hojaId: number): Promise<HojaConteo | undefined> {
  await asegurarSemilla();
  for (const inventario of inventariosPorId.values()) {
    const hoja = inventario.hojas.find((h) => h.id === hojaId);
    if (hoja) return hoja;
  }
  return undefined;
}

/** `finalizar()` del dominio es puro (no muta la hoja): esto la reemplaza
 *  en el store por la versión nueva que devolvió. */
export async function reemplazarHoja(hoja: HojaConteo): Promise<void> {
  await asegurarSemilla();
  for (const inventario of inventariosPorId.values()) {
    const indice = inventario.hojas.findIndex((h) => h.id === hoja.id);
    if (indice >= 0) {
      inventario.hojas[indice] = hoja;
      return;
    }
  }
}

// Re-exportadas para que los adaptadores no dupliquen el import del dominio.
export { finalizarDominio, puedeEditar };
