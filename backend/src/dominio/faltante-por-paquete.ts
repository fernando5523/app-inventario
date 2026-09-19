/**
 * A QUE CUADRO VA EL FALTANTE (o el sobrante) DE UN ITEM: al descuento del
 * personal, al cuadro POR PAQUETE que se audita aparte, o al de la empresa.
 *
 * PURO -- sin Prisma ni Express -- por la misma razon que
 * `reparto-de-fondo.ts`: de acá sale plata que se le descuenta del sueldo a
 * una persona, y eso tiene que poder probarse sin base (ver el test).
 *
 * ---------------------------------------------------------------------------
 * LA REGLA, VALIDADA CONTRA EL ARCHIVO REAL DEL CLIENTE
 * ---------------------------------------------------------------------------
 *     razon = |diferencia| / empaqueCompra
 *     razon >  umbral  ->  TODO el item al cuadro POR PAQUETE
 *     razon <= umbral  ->  TODO el item al cuadro UNICO (descuento al personal)
 *
 * NO SE PARTE NADA. El item entero va a un cuadro o al otro -- no hay paquetes
 * enteros por un lado y residuo por el otro.
 *
 * DE DONDE SALE, y por que esta version es la buena: del Excel que Gilmer
 * arma A MANO todos los meses
 * (`requerimiento/INVENTARIO MES DE JULIO 2026 ACTUAL MKT BOLIVAR.xlsx`,
 * Bolivar julio 2026). Las dos versiones anteriores de este archivo salian de
 * interpretar la transcripcion; esta sale de su propio trabajo, que es la
 * especificacion mas confiable que hay. Lo verificado sobre sus 107 renglones:
 *
 *   1. NINGUN CODIGO APARECE EN DOS CUADROS. Si se partiera, el faltante de
 *      -21 de DORITOS tendria que figurar como -12 en paquetes y -9 en unicos.
 *      No figura asi en ningun renglon.
 *   2. LA CANTIDAD ABSOLUTA NO DECIDE. -37 de NESTLE CHOCOLATE PRINCESA esta
 *      en FALTANTES UNICOS y -3 de VIRUTEX LIMPIADOR LAVANDA 3.8LT esta en
 *      FALTANTE POR PAQUETE. Lo unico que explica las dos a la vez es la
 *      RAZON contra el empaque de compra: el chocolate viene en cajas enormes
 *      (Gilmer menciono 540) y el limpiador en packs de pocas unidades.
 *   3. EL DESCUENTO SALE SOLO DE LOS CUADROS UNICOS:
 *         TOTAL FALTANTES UNICOS  -862.50
 *       + TOTAL SOBRANTES UNICOS  +490.60
 *       = DIFERENCIA              -371.90   ->  /12 personas = -30.99 c/u
 *      Los cuadros por paquete (-877.20 y +625.90) y el de empresa NO entran.
 *      Y los sobrantes SI compensan a los faltantes.
 *
 * Y la frase de Gilmer (reunion 1, 00:18:30) se lee sin forzarla:
 * *"empaque de 6, le falta 23, ENTONCES SON PAQUETES"* -- el 23 entero. Nunca
 * dijo "3 paquetes y 5 sueltas".
 *
 * LA COMPARACION ES ESTRICTA (`>`, no `>=`) porque el cliente dijo "MAS de la
 * mitad" (reunion 1, 00:18:30: *"si es menos de la mitad del paquete seria
 * para descontar al trabajador, pero si ya es mas de la mitad del paquete ya
 * separaria por paquetes"*). Oscar lo precisa en 00:37:49: *"la mitad mas uno
 * es igual a un paquete"*. Con empaque 6 y umbral 0.5: 4 o mas van a paquetes,
 * 3 o menos al personal.
 *
 * ---------------------------------------------------------------------------
 * SON CUATRO CUADROS MAS EMPRESA, no dos
 * ---------------------------------------------------------------------------
 * El archivo tiene PRODUCTOS FALTANTES UNICOS, PRODUCTOS SOBRANTES UNICO,
 * FALTANTE POR PAQUETE y SOBRANTE POR PAQUETE, mas la hoja EMPRESA. Esta
 * funcion devuelve el destino; separar faltante de sobrante lo hace quien
 * acumula, mirando el signo (`auditoria.calculos.ts#CuadroDeDiferencias`).
 *
 * ---------------------------------------------------------------------------
 * "HAY QUE INDICAR"
 * ---------------------------------------------------------------------------
 * El cliente lo pidio textual, y significa que el reporte tiene que explicar
 * POR QUE un item quedo en el cuadro de paquetes: la cantidad, el empaque de
 * compra con su simbolo, y la razon entre los dos. Por eso esta funcion
 * devuelve `razon` y `paquetesEnteros` ademas del destino -- son para LEER el
 * reporte, no para decidir.
 */

/** Los tres destinos posibles. Espeja `ClaseItem` de Prisma. */
export type ClaseItem = 'empresa' | 'paquete' | 'unidad';

/**
 * A donde fue la diferencia de UN item, con el signo conservado (negativo =
 * faltante, positivo = sobrante).
 *
 * EXACTAMENTE UNO de los tres montos es distinto de cero: el item entero va a
 * un cuadro. La invariante, verificada en el test:
 *
 *     alPersonal + aPaquetes + aEmpresa === diferencia
 */
export interface RepartoDeDiferencia {
  /** Lo que se le descuenta al personal (cuadro UNICO). */
  alPersonal: number;
  /** Lo que sale al cuadro POR PAQUETE: se audita aparte (¿el almacenero?). */
  aPaquetes: number;
  /** Lo que absorbe la empresa por orden de gerencia (las cervezas). */
  aEmpresa: number;
  /**
   * `|diferencia| / empaqueCompra` -- el numero que DECIDIO el destino.
   *
   * `null` cuando no se pudo calcular (clase `empresa`/`unidad`, o sin empaque
   * de compra). Va al reporte: el "hay que indicar" del cliente es poder
   * explicar por que este item quedo donde quedo.
   */
  razon: number | null;
  /**
   * Cuantas cajas COMPLETAS entran en la diferencia. INFORMATIVO, no es
   * criterio: el item va entero a un cuadro segun `razon`. Sirve para que el
   * reporte pueda decir "faltan 23, son casi 4 cajas de 6".
   */
  paquetesEnteros: number;
}

/**
 * EL EMPAQUE DE COMPRA QUE VALE: el corregido por el Auditor si lo hay, y si
 * no el que trajo Dynamics.
 *
 * El cliente pidio poder corregirlo cuando el ERP lo trae mal (reunion 2), y
 * Fernando se lo concedio textual: *"claro que tu edites el empaque y ya
 * cambia el resultado"*. Vive en `ClasificacionProducto.empaqueCompraCorregido`,
 * por CODIGO y en vivo. `null` = sin corregir.
 *
 * EL SNAPSHOT NO SE SOBREESCRIBE, y es la mitad del punto: `CatalogoItem.
 * empaqueCompra` tiene que seguir diciendo lo que dijo Dynamics para poder
 * responder *"el ERP dijo 1 y el Auditor lo corrigio a 12"*. Esta funcion
 * elige cual de los dos MIDE, no reemplaza a ninguno.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE VA EN VIVO Y EL UMBRAL VA CONGELADO
 * ---------------------------------------------------------------------------
 * Es LA pregunta que se va a hacer quien mire los dos campos al lado, asi que
 * queda escrita: `Inventario.umbralMediaUnidadPaquete` se COPIA al abrir el
 * inventario y este se lee EN VIVO. No es una inconsistencia.
 *
 *   El umbral es una POLITICA. "A partir de media caja lo audito aparte" es
 *   una decision del negocio, y cambiarla a mitad de camino cambia la REGLA
 *   con la que se midio a la gente. Eso no puede aplicar retroactivamente.
 *
 *   El empaque es un DATO QUE ESTABA MAL. "Esta caja trae 12" no es una
 *   politica ni un matiz de sucursal: es un hecho del producto que el ERP
 *   reporto equivocado. Corregir un dato equivocado TIENE que aplicar -- si
 *   no aplicara, el unico efecto de la correccion seria dejar constancia de
 *   que sabemos que esta mal.
 *
 * Por eso tambien es CROSS-TIENDA (por codigo, no por sucursal): si el ERP
 * trae mal el empaque de un producto, lo trae mal en todas las tiendas a la
 * vez. Es lo que el cliente pidio -- *"asi evitamos estar corrigiendo 1:1"*.
 *
 * ---------------------------------------------------------------------------
 * HASTA DONDE LLEGA LA CORRECCION
 * ---------------------------------------------------------------------------
 * Alcanza a lo que TODAVIA NO SE LIQUIDO. Lo liquidado y lo lacrado no se
 * tocan: `DiferenciaItem.clase` se congela al cerrar y sigue diciendo con que
 * regla se liquido ese mes, y el regimen congelado de
 * `liquidacion.reclasificacion.ts` lee el `empaqueCompra` del snapshot, nunca
 * esta correccion.
 *
 * Es la MISMA frontera que el umbral copiado al inventario y por la misma
 * razon: no se le cambia el descuento a alguien sobre un sueldo ya pagado.
 * Que la correccion sea legitima no la hace retroactiva.
 */
export function empaqueEfectivo(corregido: number | null, delSnapshot: number | null): number | null {
  return corregido ?? delSnapshot;
}

/**
 * LA CLASE EFECTIVA de un item, con la precedencia que el cliente pidió.
 *
 *   1. La EXCEPCION MANUAL DEL AUDITOR (`ClasificacionProducto.clase`), leida
 *      EN VIVO al liquidar -- nunca la congelada. Manda sobre todo porque el
 *      cliente lo pidió explicito (reunion 2, 00:30:15): *"si por ahi puedes
 *      poner una opcion donde pueda ponerlo yo, si es empaque o es unidad...
 *      el sistema no lo va a hacer al 100%"*.
 *   2. La clase del SNAPSHOT (`CatalogoItem.clase`), derivada al traer el
 *      catalogo de D365.
 *   3. SIN `empaqueCompra` -> `unidad`, pase lo que pase.
 *
 * EL EMPAQUE RE-DERIVA LA CLASE, EN LAS DOS DIRECCIONES. No es solo una
 * guarda que baja `paquete` a `unidad`: tambien SUBE `unidad` a `paquete`
 * cuando el empaque efectivo es mayor que 1.
 *
 *     empaque efectivo >  1   ->  paquete
 *     empaque efectivo == 1   ->  unidad
 *     empaque efectivo null   ->  unidad
 *
 * NO ES UNA REGLA NUEVA: es la MISMA derivacion que corre min-1 al tomar el
 * snapshot (`d365-catalogo.service.ts#clasificarItem`), corriendo de nuevo con
 * el insumo arreglado. La clase del snapshot SE DERIVO del empaque; si el
 * empaque estaba mal y se corrige, la derivacion tiene que volver a correr.
 * Congelar la clase y aceptar el empaque corregido al mismo tiempo es
 * incoherente: se guarda un dato nuevo y se sigue decidiendo con el viejo.
 *
 * Y es lo que el cliente pidio: si el Auditor tiene que corregir el empaque Y
 * ADEMAS forzar el cuadro en cada producto, no se ahorro el "corregir 1:1" que
 * queria evitar.
 *
 * DOS LIMITES QUE ESTA FUNCION NO CRUZA:
 *
 *   - `empresa` NO se toca por esta via. La re-derivacion es solo entre
 *     `unidad` y `paquete`. Un item que gerencia absorbe lo sigue absorbiendo
 *     aunque alguien le corrija el empaque -- eso no lo decide una caja.
 *   - La EXCEPCION MANUAL sigue arriba de todo. Si el Auditor forzo el cuadro,
 *     manda el, aunque el empaque diga otra cosa. Lo unico que la acota es
 *     que forzar `paquete` sin empaque no se puede cumplir: sin denominador la
 *     razon no se calcula, y degradar a `unidad` deja el faltante donde ya
 *     estaba en vez de mandarlo al cuadro del almacenero por un dato que
 *     falta. Si el Auditor marco `paquete` y el item no tiene empaque, lo que
 *     hay es un dato faltante en el catalogo y se arregla en D365 -- no acá.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN NO ES INTERCAMBIABLE. RESOLVER `empaqueEfectivo` PRIMERO
 * ---------------------------------------------------------------------------
 *     empaqueEfectivo(corregido, snapshot)  ->  claseEfectiva  ->  repartirDiferencia
 *                    ^^^^^^^^^ PRIMERO
 *
 * Porque el `null`/`1` que esta funcion degrada a `unidad` es EXACTAMENTE el
 * caso que la correccion del Auditor viene a arreglar: los displays que
 * Dynamics trae con `PurchaseUnitSymbol = 'U'` llegan con empaque 1. Si se
 * llama a `claseEfectiva` con el empaque del SNAPSHOT, esos items se degradan
 * a `unidad` antes de que nadie mire la correccion, y la correccion no sirve
 * para nada -- se guarda, se ve en la pantalla, y no cambia un solo sol.
 *
 * Es el tipo de linea que alguien reordena sin darse cuenta porque "da igual".
 * No da igual.
 */
export function claseEfectiva(
  excepcionDelAuditor: ClaseItem | null,
  claseDelSnapshot: ClaseItem,
  empaqueCompra: number | null,
): ClaseItem {
  // (1) LA EXCEPCION MANUAL MANDA. Si el Auditor forzo el cuadro, manda el
  // Auditor -- aunque el empaque diga otra cosa. Lo unico que la acota es la
  // guarda de abajo: forzar `paquete` sin un empaque contra el cual medir no
  // se puede cumplir, y ahi degrada a `unidad`.
  if (excepcionDelAuditor !== null) {
    if (excepcionDelAuditor !== 'paquete') return excepcionDelAuditor;
    return esPaquete(empaqueCompra) ? 'paquete' : 'unidad';
  }

  // (2) `empresa` NO SE TOCA POR ESTA VIA. Que un producto lo absorba gerencia
  // lo decide gerencia, no el tamano de una caja: corregir el empaque de una
  // cerveza no la saca del cuadro de empresa.
  if (claseDelSnapshot === 'empresa') return 'empresa';

  // (3) RE-DERIVAR con el empaque EFECTIVO, en las dos direcciones.
  return esPaquete(empaqueCompra) ? 'paquete' : 'unidad';
}

/** `> 1` = viene en caja. `1` = se compra por unidad. `null` = no se sabe. */
function esPaquete(empaqueCompra: number | null): boolean {
  return empaqueCompra !== null && empaqueCompra > 1;
}

/**
 * Manda la diferencia de un item a UN cuadro. Ver la cabecera para la regla y
 * la evidencia.
 *
 * `umbral` es `Inventario.umbralMediaUnidadPaquete`, CONGELADO al abrir el
 * inventario: recalcular agosto con la perilla de hoy le cambiaria el
 * descuento a alguien sobre un sueldo ya pagado.
 *
 * Trabaja en UNIDADES, no en plata: la valorizacion la hace quien llama
 * multiplicando por el precio. Como el item no se parte, el monto del cuadro
 * es el monto entero del item y no hay dos redondeos que despues no cierren.
 */
export function repartirDiferencia(
  diferencia: number,
  clase: ClaseItem,
  empaqueCompra: number | null,
  umbral: number,
): RepartoDeDiferencia {
  const vacio = { alPersonal: 0, aPaquetes: 0, aEmpresa: 0, razon: null, paquetesEnteros: 0 };

  if (clase === 'empresa') return { ...vacio, aEmpresa: diferencia };
  // `unidad`, o `paquete` sin empaque utilizable: el faltante se descuenta al
  // personal como siempre. Se rechequea el empaque acá y no se confia en que
  // `claseEfectiva` ya lo hizo -- esta funcion es pura y la llaman los tests.
  if (clase === 'unidad' || empaqueCompra === null || empaqueCompra <= 1) {
    return { ...vacio, alPersonal: diferencia };
  }

  const magnitud = Math.abs(diferencia);
  const razon = magnitud / empaqueCompra;
  const paquetesEnteros = Math.floor(razon);

  // ESTRICTO: "MAS de la mitad". La mitad justa se le descuenta al personal.
  // Con diferencia 0 da `0 > umbral` = false, o sea al personal -- y 0 al
  // personal es 0, asi que no hay borde raro.
  return razon > umbral
    ? { alPersonal: 0, aPaquetes: diferencia, aEmpresa: 0, razon, paquetesEnteros }
    : { alPersonal: diferencia, aPaquetes: 0, aEmpresa: 0, razon, paquetesEnteros };
}
