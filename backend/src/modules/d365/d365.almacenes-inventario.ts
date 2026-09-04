/**
 * Qué almacenes de Dynamics entran al inventario fisico.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ES UNA LISTA Y NO UNA REGLA SOBRE EL CODIGO
 * ---------------------------------------------------------------------------
 * El tenant tiene 70 almacenes y la nomenclatura parece sistematica: la
 * segunda letra del codigo es el tipo (`D`isponible, `T`ransito,
 * `C`uarentena) y la primera el canal (`M`arket, `A`mayorista, `P`roduccion).
 * De ahi sale la tentacion de escribir `/^MD\d{2}/` y darlo por resuelto.
 *
 * Esta MAL, y se sabe con un contraejemplo concreto: `MD07_CEN` (ALMACEN
 * DISPONIBLE MARKET CENTER) cumple el patron y NO se inventaria. El cliente
 * lo excluyo explicitamente de su lista. Un patron habria metido una tienda
 * que nadie cuenta, y el faltante hubiera aparecido como un descuadre.
 *
 * Cual almacen se inventaria es una decision de NEGOCIO, no una propiedad
 * del codigo. Va en la base, donde se puede cambiar sin recompilar: cuando
 * abre una tienda nueva, se agrega el codigo y listo.
 *
 * ---------------------------------------------------------------------------
 * DONDE VIVE
 * ---------------------------------------------------------------------------
 * En `Configuracion`, clave `ALMACENES_INVENTARIO`, como codigos separados
 * por coma. Clave-valor y no una tabla propia por la misma razon que las
 * otras tres: es una lista corta que solo el Administrador toca, y una tabla
 * traeria migracion, endpoints y pantalla propios para guardar diez strings.
 *
 * Este archivo es PURO -- sin Prisma ni Express -- para poder probar las
 * reglas de verdad (ver d365.almacenes-inventario.test.ts).
 */

/** La clave en `Configuracion`. */
export const CLAVE_ALMACENES = 'ALMACENES_INVENTARIO';

/**
 * Los 10 con los que arranca el sistema, confirmados por el cliente sobre la
 * lista real del tenant. `MD07_CEN` NO esta y no es un olvido -- ver arriba.
 */
export const ALMACENES_INICIALES = [
  'MD01_LUZ',
  'MD02_JRC',
  'MD03_CRH',
  'MD04_SUC',
  'MD05_CRZ',
  'MD06_BOL',
  'MD08_RAY',
  'MD09_R351',
  'MD10',
  'MD11_CENT',
] as const;

/**
 * Lee la lista guardada. Tolerante con el formato porque lo escribe una
 * persona: acepta espacios alrededor de las comas, entradas vacias por una
 * coma de mas, y normaliza a mayusculas (los codigos de Dynamics lo son).
 *
 * Una lista VACIA no se interpreta como "ninguno": ver `filtrar`.
 */
export function parsear(valor: string | null | undefined): string[] {
  if (typeof valor !== 'string') return [];
  const vistos = new Set<string>();
  for (const parte of valor.split(',')) {
    const codigo = parte.trim().toUpperCase();
    if (codigo !== '') vistos.add(codigo);
  }
  return [...vistos];
}

/** Vuelve al formato de la base. Ordenado: la lista se lee, no se busca. */
export function serializar(codigos: readonly string[]): string {
  return [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter((c) => c !== ''))].sort().join(',');
}

/**
 * Agrega un codigo si no estaba. Devuelve la lista nueva y si CAMBIO algo,
 * para que quien llama no escriba en la base ni registre auditoria al pedo
 * cuando el almacen ya estaba habilitado.
 */
export function agregar(codigos: readonly string[], codigo: string): { lista: string[]; agregado: boolean } {
  const nuevo = codigo.trim().toUpperCase();
  if (nuevo === '') return { lista: [...codigos], agregado: false };
  const actual = codigos.map((c) => c.toUpperCase());
  if (actual.includes(nuevo)) return { lista: actual, agregado: false };
  return { lista: [...actual, nuevo], agregado: true };
}

export interface AlmacenListado {
  codigo: string;
  nombre: string;
}

/**
 * Filtra la lista que vino de Dynamics dejando solo los habilitados.
 *
 * LA LISTA VACIA DEVUELVE TODO, y es a proposito. Si la configuracion se
 * borra o todavia no se sembro, filtrar a cero dejaria al Administrador sin
 * poder dar de alta NINGUNA tienda, sin ningun mensaje que explique por que
 * -- un selector vacio parece que Dynamics no responde. Es preferible
 * mostrar de mas (que es lo que habia antes de este filtro) a bloquear el
 * alta entera por una configuracion faltante.
 */
export function filtrar(deDynamics: readonly AlmacenListado[], habilitados: readonly string[]): AlmacenListado[] {
  if (habilitados.length === 0) return [...deDynamics];
  const permitidos = new Set(habilitados.map((c) => c.toUpperCase()));
  return deDynamics.filter((a) => permitidos.has(a.codigo.toUpperCase()));
}
