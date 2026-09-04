/**
 * Regla de negocio del FACTOR DE EMPAQUE. Pura: sin red, sin Prisma, sin
 * Dynamics. Vive fuera de `modules/d365/` a proposito -- no es un detalle de
 * como consultamos el ERP, es cuantas unidades trae una caja, y eso sigue
 * siendo verdad aunque manana el catalogo venga de otro lado.
 *
 * Definicion del cliente, textual: "emp.12 es 12 unidades, cualquier otra que
 * no tenga valor numerico cae en factor 1, ejemplo: unidad, ltr, saco, bolsa
 * o cosas asi".
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO IMPORTA MAS QUE CASI CUALQUIER OTRA COSA
 * ---------------------------------------------------------------------------
 * De este numero depende TODO el conteo. Si el factor sale mal, el operario
 * carga "2 cajas" y el sistema guarda 2 unidades en vez de 24 -- y ese numero
 * es el que se audita contra el ERP a fin de mes y el que termina en la
 * liquidacion de alguien. Un factor equivocado no se nota: se nota semanas
 * despues, como un faltante que nadie puede explicar.
 */

/** Sin numero en el simbolo, un empaque vale por una unidad. */
export const FACTOR_POR_DEFECTO = 1;

/**
 * Extrae el factor del simbolo de unidad.
 *
 * Casos y por que se resuelven asi:
 *
 *  - `"Emp.12"`, `"Emp 12"`, `"EMP.12"`, `"emp-12"` → 12. El separador no
 *    importa: se busca el numero, no un formato exacto. El ERP lo carga a
 *    mano y la unica constante observada es que el numero esta ahi.
 *  - `"Unidad"`, `"Ltr"`, `"Saco"`, `"Bolsa"`, `""`, `null` → 1. Son unidades
 *    de medida, no empaques: no multiplican nada.
 *  - `"Emp.0"`, `"Emp.-5"` → 1. Un empaque de cero unidades no existe, y uno
 *    negativo menos. Devolver 0 haria que `2 cajas` sumaran 0 unidades y el
 *    item apareceria como faltante total.
 *  - VARIOS numeros (`"Emp.12x6"`) → se toma el PRIMERO (12).
 *
 *    Es el caso incomodo y la decision no es obvia: "12x6" podria ser 12
 *    packs de 6 (72 unidades) o un pack de 12 marcado con el contenido. NO se
 *    multiplica, porque multiplicar es inventar una semantica que el cliente
 *    no definio, y equivocarse ahi rompe el conteo por 6x. Se toma el primero
 *    porque en el formato documentado (`Emp.N`) el numero que sigue al
 *    prefijo es el que califica el empaque. Si aparecen simbolos asi en el
 *    catalogo real, hay que confirmarlos con el cliente uno por uno --
 *    `simboloEsAmbiguo` existe justamente para poder listarlos.
 */
export function factorDesdeSimbolo(simbolo: string | null | undefined): number {
  if (!simbolo) return FACTOR_POR_DEFECTO;

  const numeros = simbolo.match(/\d+/g);
  if (!numeros || numeros.length === 0) return FACTOR_POR_DEFECTO;

  const factor = Number.parseInt(numeros[0]!, 10);
  // NaN no deberia pasar (el match ya garantiza digitos), pero un simbolo con
  // un numero enorme puede desbordar: se trata igual que "sin numero".
  if (!Number.isFinite(factor) || !Number.isInteger(factor) || factor < 1) {
    return FACTOR_POR_DEFECTO;
  }
  return factor;
}

/**
 * true si el simbolo trae MAS DE UN numero, o sea que `factorDesdeSimbolo`
 * tuvo que elegir. Sirve para listar los casos dudosos del catalogo real y
 * confirmarlos con el cliente, en vez de que pasen silenciosos.
 */
export function simboloEsAmbiguo(simbolo: string | null | undefined): boolean {
  if (!simbolo) return false;
  return (simbolo.match(/\d+/g) ?? []).length > 1;
}
