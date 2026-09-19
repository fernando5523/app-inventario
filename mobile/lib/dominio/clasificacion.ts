/**
 * Lógica pura de la pantalla de Clasificación de productos (Auditor). Aparte
 * del JSX por lo de siempre: son reglas con casos que importan (¿la decisión
 * del Auditor cambia lo de Dynamics o coincide?, ¿quedan páginas por traer?) y
 * dentro del render no se prueban.
 */

import type { ClaseItem, Clasificacion, ProductoClasificable, ResponsableDynamics } from '../puertos/repositorios';

/** Lo que dice Dynamics, en texto para la pantalla. */
export function textoResponsableDynamics(r: ResponsableDynamics): string {
  if (r === 'empresa') return 'Empresa';
  if (r === 'empleado') return 'Empleado';
  return 'Sin dato';
}

// ---------------------------------------------------------------------------
// Las tres vías
// ---------------------------------------------------------------------------

/** El orden en que se ofrecen, y el único lugar donde vive: de lo que más mueve la cuenta a lo que menos. */
export const CLASES: readonly ClaseItem[] = ['empresa', 'paquete', 'unidad'];

/** La etiqueta del cliente, textual (reunión 2): Empresa / Paquete / Unidad. */
export function textoClase(clase: ClaseItem): string {
  if (clase === 'empresa') return 'Empresa';
  if (clase === 'paquete') return 'Paquete';
  return 'Unidad';
}

/**
 * QUÉ SIGNIFICA CADA UNA, en la pantalla y no en la memoria de una reunión.
 *
 * Es el pedido explícito: el Auditor tiene que poder elegir sin acordarse de
 * lo que se dijo en una reunión de agosto. Vive en el dominio porque lo dicen
 * dos lugares (el selector y el resumen de la fila) y dos redacciones de la
 * misma regla es como una de las dos termina diciendo otra cosa.
 */
export function explicacionClase(clase: ClaseItem): string {
  if (clase === 'empresa') return 'Lo asume la empresa: no se le descuenta a nadie del personal.';
  if (clase === 'paquete') return 'Va al cuadro de paquetes: el faltante se mide contra el empaque de compra.';
  return 'Se le descuenta al personal, entero. Es el tratamiento de siempre.';
}

export type EstadoClasificacion =
  /** El Auditor no puso excepción: manda Dynamics. */
  | { tipo: 'sin-clasificar' }
  /**
   * Excepción VIEJA: `clase === null` Y sin empaque corregido. Se cargó antes
   * de las tres vías y la sigue mandando `esEmpresa`. Se muestra por lo que es
   * -- empresa o no -- y NUNCA se le inventa una tercera vía que nadie eligió.
   *
   * Lo que la distingue de `solo-empaque` es justamente el empaque: una fila
   * nueva SIEMPRE tiene al menos una de las dos cosas (el servidor lo exige),
   * así que `clase null + empaque null` solo puede ser una vieja.
   */
  | { tipo: 'vieja'; esEmpresa: boolean }
  /**
   * SOLO SE CORRIGIÓ EL EMPAQUE, sin forzar ningún cuadro. Es el caso más
   * común y el que evita "corregir 1:1": el Auditor arregla el dato y deja que
   * la regla clasifique sola de ahí en adelante.
   */
  | { tipo: 'solo-empaque'; empaqueCorregido: number }
  /** El Auditor decidió LO MISMO que ya derivaba el snapshot: no cambia la cuenta. */
  | { tipo: 'coincide'; clase: ClaseItem }
  /** El Auditor CAMBIÓ lo que hacía el sistema (la cerveza): mueve la liquidación. */
  | { tipo: 'excepcion'; clase: ClaseItem };

/**
 * Cruza lo que hace el sistema con lo que decidió el Auditor. La distinción
 * `coincide`/`excepcion` es la que le importa a Gilmer: una excepción cambia a
 * quién se le descuenta el faltante; una coincidencia es redundante.
 *
 * Se compara contra `claseDynamics` -- la clase que DERIVÓ EL SNAPSHOT -- y no
 * contra `responsableDynamics`: con tres vías, "empleado" ya no alcanza para
 * saber qué iba a hacer el sistema (un ítem del empleado que se compra por
 * caja es `paquete`, no `unidad`). Compararlo con el booleano viejo marcaría
 * como "coincide" un cambio de unidad a paquete, que es justo el que el
 * cliente pidió poder hacer.
 */
export function estadoClasificacion(p: ProductoClasificable): EstadoClasificacion {
  if (p.clasificacion === null) return { tipo: 'sin-clasificar' };
  const { clase, esEmpresa, empaqueCompraCorregido } = p.clasificacion;
  if (clase === null) {
    // Sin cuadro forzado: o corrigió el empaque (fila nueva), o es una vieja.
    return empaqueCompraCorregido !== null
      ? { tipo: 'solo-empaque', empaqueCorregido: empaqueCompraCorregido }
      : { tipo: 'vieja', esEmpresa };
  }
  return { tipo: clase === p.claseDynamics ? 'coincide' : 'excepcion', clase };
}

/**
 * EL EMPAQUE DE COMPRA, listo para mostrar: "12 — Emp.12".
 *
 * `null` cuando el snapshot no lo resolvió, y ahí la pantalla NO muestra un
 * número: NULL no es 1. Quien llama decide qué decir en su lugar (ver
 * `ADVERTENCIA_SIN_EMPAQUE`), porque la consecuencia hay que explicarla, no
 * solo dejar un guion.
 */
export function textoEmpaqueCompra(empaqueCompra: number | null, simbolo: string | null): string | null {
  if (empaqueCompra === null) return null;
  return simbolo === null ? String(empaqueCompra) : `${empaqueCompra} — ${simbolo}`;
}

/**
 * Lo que hay que decirle al Auditor cuando elige Paquete sobre un ítem SIN
 * empaque de compra. No es un detalle: sin ese número no hay umbral que
 * medir, así que elegir "Paquete" ahí no va a hacer lo que él espera. Se dice
 * antes, no después de que el faltante salga distinto.
 */
export const ADVERTENCIA_SIN_EMPAQUE =
  'Este producto no tiene empaque de compra en el sistema. Sin ese dato no se puede medir el umbral por paquete: revísalo en Dynamics antes de marcarlo así.';

/** ¿Quedan productos por traer del catálogo? (paginado de ~11.800). */
export function hayMasPorCargar(cargados: number, total: number): boolean {
  return cargados < total;
}

/**
 * Actualiza (o limpia, con `null`) la clasificación de UN código en la lista ya
 * cargada, sin recargar todo. Devuelve un arreglo NUEVO: la pantalla re-renderiza
 * solo esa fila y no vuelve a pedir las ~11.800.
 */
export function aplicarClasificacion(
  productos: ProductoClasificable[],
  codigo: string,
  clasificacion: Clasificacion | null,
): ProductoClasificable[] {
  return productos.map((p) => (p.codigo === codigo ? { ...p, clasificacion } : p));
}

/** Deja solo los que tienen excepción -- para el filtro "solo clasificados" tras desclasificar en pantalla. */
export function soloConClasificacion(productos: ProductoClasificable[]): ProductoClasificable[] {
  return productos.filter((p) => p.clasificacion !== null);
}

// ---------------------------------------------------------------------------
// El empaque de compra corregido, y su consecuencia
// ---------------------------------------------------------------------------

/**
 * EL EMPAQUE QUE MANDA HOY: el corregido por el Auditor si lo hay, y si no el
 * del snapshot de Dynamics.
 *
 * `null` = ninguno de los dos existe, y NULL NO ES 1 (decisión de min-1): sin
 * denominador la razón contra el umbral no se puede calcular. No se asume
 * nada.
 */
export function empaqueEfectivo(corregido: number | null, delSnapshot: number | null): number | null {
  return corregido ?? delSnapshot;
}

/**
 * LA CLASE EFECTIVA de un ítem, con la precedencia que pidió el cliente.
 *
 * ESPEJA `backend/src/dominio/faltante-por-paquete.ts#claseEfectiva`, función
 * por función y con la misma regla. Está duplicada A PROPÓSITO y no importada,
 * por lo mismo que `reparto-visible.ts#resumirAsistencia`: no hay lib
 * compartida entre backend y mobile, y una regla de tres líneas duplicada sale
 * más barata que el andamiaje para compartirla. El nombre idéntico es lo que
 * hace que los dos archivos se encuentren el día que la regla cambie.
 *
 * LA CLASE SE RE-DERIVA DESDE EL EMPAQUE EFECTIVO, en las dos direcciones, y
 * eso es lo que hace que corregir el empaque SOLO alcance: un ítem que
 * Dynamics trae con empaque 1 (los DORITOS, que vienen en display) pasa a
 * `paquete` con la corrección, sin que el Auditor tenga que forzar además el
 * cuadro. Es la frase de Gilmer — "así evitamos estar corrigiendo 1:1".
 */
function esPaquete(empaqueCompra: number | null): boolean {
  return empaqueCompra !== null && empaqueCompra > 1;
}

export function claseEfectiva(
  excepcionDelAuditor: ClaseItem | null,
  claseDelSnapshot: ClaseItem,
  empaqueCompra: number | null,
): ClaseItem {
  // (1) EL CUADRO FORZADO MANDA, aunque el empaque diga otra cosa. Lo único
  // que lo acota es la guarda de abajo: forzar `paquete` sin un empaque contra
  // el cual medir no se puede cumplir, y ahí degrada a `unidad`.
  if (excepcionDelAuditor !== null) {
    if (excepcionDelAuditor !== 'paquete') return excepcionDelAuditor;
    return esPaquete(empaqueCompra) ? 'paquete' : 'unidad';
  }

  // (2) `empresa` NO SE TOCA POR ESTA VÍA. Que un producto lo absorba gerencia
  // lo decide gerencia, no el tamaño de una caja: corregir el empaque de una
  // cerveza no la saca del cuadro de empresa.
  if (claseDelSnapshot === 'empresa') return 'empresa';

  // (3) RE-DERIVAR con el empaque EFECTIVO, en las dos direcciones.
  return esPaquete(empaqueCompra) ? 'paquete' : 'unidad';
}

/**
 * QUÉ VA A CAMBIAR SI GUARDA — lo más útil que puede mostrar esta pantalla.
 *
 * Sin esto el Auditor teclea un número a ciegas sobre el sueldo de alguien: el
 * empaque decide si un faltante se le descuenta al personal o se va al cuadro
 * de paquetes, y eso no se deduce mirando el campo.
 *
 * Compara la clase efectiva de HOY (con el empaque que está guardado) contra
 * la que quedaría con lo que se está tecleando. Las dos salen de
 * `claseEfectiva`, la misma función: no hay forma de que la previsualización y
 * el resultado difieran.
 */
export interface ConsecuenciaEmpaque {
  /** El empaque que manda hoy, y el que mandaría al guardar. `null` = ninguno. */
  empaqueAntes: number | null;
  empaqueDespues: number | null;
  claseAntes: ClaseItem;
  claseDespues: ClaseItem;
  /** `true` = guardar mueve este ítem de un cuadro a otro. */
  cambia: boolean;
  /**
   * `true` = el Auditor eligió Paquete pero el empaque que quedaría no lo
   * permite (1, o ninguno), así que el sistema lo va a tratar como Unidad.
   *
   * Es EL caso de este lote y hay que decirlo fuerte: marcar Paquete sin
   * corregir el empaque no hace nada, y quien lo marcó se va convencido de que
   * sí. Es lo que pasa hoy con los DORITOS, que D365 trae con empaque 1.
   */
  paqueteSinEfecto: boolean;
  // SIN `correccionSinEfecto`: existió mientras la clase del snapshot no se
  // re-derivaba, y avisaba que corregir el empaque solo no alcanzaba. Desde
  // que `claseEfectiva` re-deriva en las dos direcciones, ese caso no puede
  // ocurrir — un aviso que nunca aparece es código muerto, y uno que aparece
  // diciendo algo falso es peor.
}

/**
 * EL CUADRO QUE UNA FILA GUARDADA FUERZA HOY, incluidas las excepciones
 * VIEJAS.
 *
 * Espeja `liquidacion.reclasificacion.ts#conciliarClase`: una excepción
 * anterior a las tres vías tiene `clase: null` pero su `esEmpresa` sigue
 * valiendo, y el backend la reconcilia a `'empresa'` antes de resolver nada.
 *
 * SIN ESTO la previsualización mentía desde que la clase se re-deriva: una
 * vieja marcada empresa, sobre un producto con empaque 12, salía como
 * `paquete` acá y como `empresa` en el backend — o sea, la pantalla decía que
 * el faltante se va al cuadro de paquetes cuando en realidad lo absorbe la
 * empresa. Medido contra las dos funciones reales antes de escribir esto.
 */
function cuadroForzadoDe(clasificacion: Clasificacion | null): ClaseItem | null {
  if (clasificacion === null) return null;
  if (clasificacion.clase !== null) return clasificacion.clase;
  return clasificacion.esEmpresa ? 'empresa' : null;
}

export function consecuenciaDeEmpaque(
  p: ProductoClasificable,
  /** `null` = no se fuerza ningún cuadro: lo decide el sistema. */
  claseElegida: ClaseItem | null,
  empaqueTecleado: number | null,
): ConsecuenciaEmpaque {
  const empaqueAntes = empaqueEfectivo(p.clasificacion?.empaqueCompraCorregido ?? null, p.empaqueCompra);
  const empaqueDespues = empaqueEfectivo(empaqueTecleado, p.empaqueCompra);
  // El "antes" se mide con la excepción que ESTÁ GUARDADA, no con la que se
  // está por elegir: si no, cambiar el cuadro y el empaque a la vez mostraría
  // un "antes" que nunca existió.
  const claseAntes = claseEfectiva(cuadroForzadoDe(p.clasificacion), p.claseDynamics, empaqueAntes);
  const claseDespues = claseEfectiva(claseElegida, p.claseDynamics, empaqueDespues);
  return {
    empaqueAntes,
    empaqueDespues,
    claseAntes,
    claseDespues,
    cambia: claseAntes !== claseDespues,
    paqueteSinEfecto: claseElegida === 'paquete' && claseDespues !== 'paquete',
  };
}

/**
 * Qué se puede tipear en el campo del empaque. `null` = vacío, que significa
 * "sin corregir" y es válido (es el deshacer).
 *
 * Devuelve el motivo del rechazo, no un booleano: un campo que se pone rojo
 * sin decir qué espera manda a adivinar. El piso es el MISMO que valida el
 * backend (`>= 1`), así que la pantalla no acepta nada que el servidor vaya a
 * rechazar después.
 */
export function errorDeEmpaque(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio === '') return null;
  if (!/^\d+$/.test(limpio)) return 'Escribe solo el número de unidades que trae el empaque.';
  if (Number(limpio) < 1) return 'El empaque tiene que ser 1 o más. Un 1 significa que se compra suelto.';
  return null;
}

/** El número tipeado, o `null` si el campo está vacío (= sin corregir). */
export function empaqueTecleado(texto: string): number | null {
  const limpio = texto.trim();
  return limpio === '' || errorDeEmpaque(texto) !== null ? null : Number(limpio);
}
