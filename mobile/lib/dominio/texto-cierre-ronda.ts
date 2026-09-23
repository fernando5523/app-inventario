/**
 * El texto del botón de cierre del ciclo de conteos — su ÚNICA fuente.
 *
 * Vive en el dominio, aparte de CicloScreen.tsx, por dos razones: es lógica
 * pura (qué ronda cierra, qué pasa después) que se prueba sin montar la
 * pantalla, y el número de ítems se formatea con un formateador INYECTADO
 * (mismo patrón que `comparativo-ronda.ts`) para no atar el dominio a la UI.
 */

import { pluralizar } from './plural';

/**
 * "1er", "2do", "3er"… — nombre ordinal de una ronda del ciclo.
 *
 * Es un Proxy sobre una tabla y no una tabla a secas porque LAS RONDAS YA NO
 * SON TRES: el Auditor abre un 4to o un 5to conteo cuando el inventario no le
 * cierra. Con la tabla de tres, la ronda 4 se leía `undefined` y la app decía
 * "undefined conteo abierto" justo en el paso que acababa de inventarse.
 *
 * Los cuatro primeros llevan su forma irregular del español ("1er", no "1°");
 * de ahí en más se compone con el número, que es como se lee de verdad una
 * ronda poco común ("el 7° conteo").
 */
const ORDINALES_IRREGULARES: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', 5: '5to', 6: '6to' };

export function ordinal(ronda: number): string {
  return ORDINALES_IRREGULARES[ronda] ?? `${ronda}°`;
}

/**
 * Se mantiene el nombre `ORDINAL` con forma de tabla —`ORDINAL[n]`— para no
 * tocar las seis pantallas que ya lo usan así, pero ahora responde para
 * CUALQUIER ronda en vez de devolver `undefined` a partir de la 4ta.
 */
export const ORDINAL: Record<number, string> = new Proxy(
  {},
  { get: (_objetivo, clave) => ordinal(Number(clave)) },
) as Record<number, string>;

/**
 * LAS PASADAS DEL CICLO AUTOMÁTICO. Cerrar la 3ra ya NO termina el inventario:
 * lo deja esperando al Auditor, que decide si abre otro conteo o arranca el
 * ajuste final (ver dominio/ajuste-final.ts). Es un techo del ciclo que se
 * cierra solo, no un techo de cuántas rondas puede tener un inventario.
 */
export const RONDA_MAX = 3;

/**
 * Qué dice el botón de cierre: la ronda que CIERRA y qué pasa DESPUÉS.
 *
 * Antes decía "Cerrar y abrir el 2do conteo" fijo — con la ronda 2 activa
 * eso MENTÍA (cerraba la 2da diciendo que abría la 2da). Ahora la siguiente
 * sale de la activa (+1), salvo que sea la última pasada del ciclo: la 3ra,
 * o cuando ya no queda nada por recontar (`aRecontar === 0`, todo cuadró).
 * En ese caso cerrar TERMINA el inventario, no abre otra ronda — y el botón
 * lo dice, en vez de prometer una ronda que no va a existir.
 *
 * @param rondaActiva la ronda que se está por cerrar (la activa del backend).
 * @param aRecontar   ítems que pasarían al reconteo (del preview del cierre).
 * @param formato     cómo mostrar ese número (inyectado: el dominio no formatea).
 */
/**
 * true cuando cerrar ESTA ronda NO abre otra automáticamente: es la última
 * pasada del ciclo (>= RONDA_MAX), o ya no queda nada por recontar
 * (`aRecontar === 0`, todo cuadró). La ÚNICA fuente de esa decisión — el botón,
 * la etiqueta del preview y el párrafo explicativo la comparten para no
 * contradecirse entre sí.
 *
 * "Última pasada" ya NO quiere decir "fin del inventario", y por eso los
 * textos de abajo cambiaron: cerrar acá deja el inventario esperando al
 * Auditor, que puede abrir otro conteo o arrancar el ajuste final. Decir
 * "termina el inventario" era cierto hasta este cambio y ahora sería una
 * promesa falsa sobre el paso más delicado del cierre.
 */
export function esUltimaPasada(rondaActiva: number, aRecontar: number): boolean {
  return rondaActiva >= RONDA_MAX || aRecontar === 0;
}

export function textoBotonCierre(rondaActiva: number, aRecontar: number, formato: (n: number) => string): string {
  if (esUltimaPasada(rondaActiva, aRecontar)) {
    return `Cerrar el ${ORDINAL[rondaActiva]} conteo y pasarlo al auditor`;
  }
  // `pluralizar`: en la 2da y la 3ra pasada lo que queda por recontar son
  // pocos ítems y puede ser UNO -- "· 1 ítems" en el botón del cierre.
  return `Cerrar el ${ORDINAL[rondaActiva]} conteo y abrir el ${ORDINAL[rondaActiva + 1]} · ${formato(aRecontar)} ${pluralizar(aRecontar, 'ítem', 'ítems')}`;
}

/**
 * Estado de un PASO (una ronda) del embudo del ciclo, comparando su número
 * con la ronda ACTIVA del backend — NUNCA un literal. Ese era el bug: el
 * Paso 2 decía "En curso" fijo aunque el inventario ya estuviera en la 3ra.
 *
 *   'cerrado'    ya pasó (número < activa), o el conteo entero ya cerró.
 *   'en-curso'   es la ronda activa y ya tiene datos cargados.
 *   'pendiente'  todavía no se abrió (número > activa), o la activa sin un
 *                solo conteo cargado.
 *   'sin-datos'  el conteo cerró y esta ronda nunca corrió (cuadró antes).
 */
export type EstadoPaso = 'cerrado' | 'en-curso' | 'pendiente' | 'sin-datos';

export function estadoDePaso(rondaPaso: number, rondaActiva: number | null, tieneDatos: boolean): EstadoPaso {
  // Sin ronda activa = el conteo del inventario ya se cerró. Lo que corrió
  // (tiene datos) quedó cerrado; lo que nunca se abrió no tiene nada que mostrar.
  if (rondaActiva === null) return tieneDatos ? 'cerrado' : 'sin-datos';
  if (rondaPaso < rondaActiva) return 'cerrado';
  if (rondaPaso > rondaActiva) return 'pendiente';
  // La ronda activa: en curso si ya se contó algo; pendiente si se abrió pero
  // todavía no entró ni una hoja.
  return tieneDatos ? 'en-curso' : 'pendiente';
}

/**
 * La etiqueta de la fila "a recontar" del preview de cierre. En una ronda
 * intermedia nombra la ronda SIGUIENTE (activa + 1); en la última del ciclo
 * no hay siguiente automática, así que esos ítems pasan al Auditor.
 *
 * Decía "diferencia final para liquidar", y dejó de ser cierto: el Auditor
 * puede abrir otro conteo o cambiar esos valores en el ajuste. Llamarlos
 * "finales" acá haría que el Coordinador cierre creyendo que ese número ya es
 * el que se descuenta.
 */
export function etiquetaARecontar(rondaActiva: number, aRecontar: number): string {
  return esUltimaPasada(rondaActiva, aRecontar)
    ? 'Sin cuadrar (pasan al auditor)'
    : `A recontar en el ${ORDINAL[rondaActiva + 1]} conteo`;
}

/**
 * El párrafo que explica qué hace cerrar ESTA ronda. En una intermedia abre la
 * siguiente con lo que no cuadró; en la última cierra el conteo y deja el
 * inventario listo para liquidar — nunca promete una ronda que no va a existir.
 */
export function textoCierreExplicacion(rondaActiva: number, aRecontar: number): string {
  if (esUltimaPasada(rondaActiva, aRecontar)) {
    return (
      'Cerrar deja el inventario en manos del auditor: él decide si abre otro conteo o si empieza el ajuste final. ' +
      'Hasta que empiece el ajuste todavía puedes corregir valores desde Gestión de hojas.'
    );
  }
  return (
    `Cerrar abre el ${ORDINAL[rondaActiva + 1]} conteo solo con lo que no cuadró — los conteos anteriores quedan ` +
    'intactos. Si quedan pocos ítems para recontar, es media hora; si quedan muchos, conviene mirar qué se contó ' +
    'mal antes de mandar a todos a recontar.'
  );
}

/**
 * QUÉ VE EL COORDINADOR CUANDO LA RONDA YA CERRÓ.
 *
 * Reemplaza al bloque de cierre, que hasta ahora seguía ofreciendo "Cerrar el
 * 1er conteo" con la ronda 1 ya cerrada. El backend lo rechazaba con un 409
 * --el dato estaba a salvo-- pero el botón INVITABA a hacer algo que siempre
 * iba a fallar, y ahí la persona no sabe si se equivocó ella o se rompió la
 * app. Un botón que existe y nunca funciona es peor que no tenerlo.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS COSAS QUE EL TEXTO TIENE QUE DECIR JUNTAS
 * ---------------------------------------------------------------------------
 * 1. Que le toca al Auditor: es lo que la persona necesita para saber que ya
 *    hizo lo suyo y no quedarse esperando un botón.
 * 2. Que TODAVÍA PUEDE CORREGIR. El inventario sigue `en_curso` y esa ventana
 *    dura hasta que el Auditor arranque su ajuste -- es deliberada, y existe
 *    justamente para el que detecta un error de carga cinco minutos después
 *    de cerrar. Si el texto dijera solo "ya cerró", se perdería de vista.
 *
 * NO dice "el conteo terminó": no terminó. Terminarlo es del Auditor.
 */
export function textoRondaYaCerrada(ronda: number): string {
  return (
    `El ${ordinal(ronda)} conteo ya está cerrado y le toca al auditor: él decide si abre otra pasada o ajusta ` +
    'los valores contra el stock. Mientras no arranque su ajuste, todavía puedes corregir lo que se contó ' +
    'desde Gestión de hojas.'
  );
}
