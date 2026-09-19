/**
 * QUIÉN PUEDE TOCAR UN VALOR YA CONTADO, Y HASTA CUÁNDO.
 *
 * Vive en el dominio y no dentro de las pantallas porque la misma regla la
 * necesitan cuatro lugares distintos -- el aviso al finalizar una hoja
 * (Contador), la pantalla de corrección (Coordinador), los botones del ciclo
 * (Auditor) y la pantalla de ajuste -- y si cada uno la resolviera por su
 * cuenta terminarían contradiciéndose sobre el mismo inventario. Además son
 * cuatro fases con bordes, y dentro de un ternario anidado no se puede probar
 * ninguna.
 *
 * ---------------------------------------------------------------------------
 * LO QUE CAMBIÓ
 * ---------------------------------------------------------------------------
 * Hasta ahora finalizar una hoja era el punto de no retorno: "ningún ítem se
 * puede volver a editar". Ya no. El Coordinador corrige lo que cargaron los
 * contadores -- con la ronda abierta y también con la ronda cerrada -- y el
 * Auditor, en el ajuste final, cambia valores viendo el stock del ERP.
 *
 * La ventana del Coordinador se cierra cuando el Auditor arranca el ajuste, y
 * por eso el ajuste ARRANCA CON UN BOTÓN y no solo al cerrar la última ronda:
 * si entrara solo, esa ventana no existiría.
 */

import type { EstadoInventario } from '../puertos/repositorios';

/**
 * En qué punto del cierre está el inventario, para los dos roles que pueden
 * tocar valores.
 *
 *   'contando'         hay una ronda abierta: se cuenta y se corrige.
 *   'rondas-cerradas'  la última ronda cerró y el ajuste todavía no arrancó.
 *                      ES LA VENTANA del Coordinador, y también donde el
 *                      Auditor decide entre abrir otra ronda o ajustar.
 *   'ajuste'           el Auditor está ajustando: el Coordinador quedó afuera.
 *   'cerrado'          el conteo cerró: nadie toca nada, sigue la liquidación.
 */
export type FaseDeCierre = 'contando' | 'rondas-cerradas' | 'ajuste' | 'cerrado';

/**
 * ---------------------------------------------------------------------------
 * LO QUE ESTAS DOS SEÑALES **NO** ALCANZAN A DISTINGUIR
 * ---------------------------------------------------------------------------
 * `activo().rondaActiva` es LA ÚLTIMA RONDA QUE EXISTE (`max(numeroConteo)`),
 * no "una ronda que admite conteo" -- lo dice el propio backend
 * (`inventarios.service.ts#InventarioActivoDto`), y agrega que `en_curso`
 * significa "se está contando, O se cerró y espera al Auditor".
 *
 * O sea: con `en_curso` + un número, 'contando' y 'rondas-cerradas' son
 * INDISTINGUIBLES desde el móvil. Esta función devuelve 'contando' en ese caso
 * porque es el más frecuente, pero quien la llame tiene que saber que puede
 * ser la ventana.
 *
 * Consecuencia práctica, y por eso está escrito acá: `puedeCorregirLoContado`
 * vale igual en las dos (corrige en las dos), así que no le afecta. Los dos
 * botones del Auditor NO pueden usar 'rondas-cerradas' como candado -- nunca
 * se cumpliría contra el backend real y el Auditor quedaría sin salida. Para
 * eso está `elAuditorPuedeDecidir`, más abajo.
 *
 * El día que `activo()` devuelva `rondaActiva: null` con la última ronda
 * cerrada (o un `rondaAbierta` explícito), esta ambigüedad desaparece sola y
 * no hay que tocar nada más que este archivo.
 */
export function faseDeCierre(estado: EstadoInventario, rondaActiva: number | null): FaseDeCierre {
  if (estado === 'ajuste_auditor') return 'ajuste';
  if (estado !== 'en_curso') return 'cerrado';
  return rondaActiva === null ? 'rondas-cerradas' : 'contando';
}

/**
 * CORREGIR LO CONTADO: se puede mientras el inventario esté `en_curso`, con la
 * ronda abierta o cerrada -- y se deja de poder en cuanto arranca el ajuste.
 *
 * Es la decisión textual del cliente, y la razón de que exista
 * `'rondas-cerradas'` como fase propia: si corregir terminara al cerrar la
 * ronda, alguien que detecta un error de carga cinco minutos después ya no
 * tendría cómo arreglarlo.
 *
 * ---------------------------------------------------------------------------
 * LA MISMA VENTANA PARA LOS DOS ROLES
 * ---------------------------------------------------------------------------
 * Corrigen el Coordinador Y el Auditor, y la ventana es idéntica: por eso hay
 * UNA función y no una por rol. Lo que los diferencia no es CUÁNDO sino QUÉ
 * VEN mientras corrigen -- el Auditor ve el stock del ERP y el Coordinador no
 * (conteo ciego). Esa diferencia vive en la pantalla, que es donde se decide
 * qué se dibuja, no acá.
 *
 * Y para el Auditor la ventana se cierra igual que para el otro: arrancado su
 * ajuste final, esta vía desaparece de su app y corrige por la pantalla de
 * ajuste. Son dos actos distintos sobre datos distintos y no pueden convivir:
 * uno arregla lo que alguien contó, el otro fija el valor definitivo.
 */
export function puedeCorregirLoContado(fase: FaseDeCierre): boolean {
  return fase === 'contando' || fase === 'rondas-cerradas';
}

/**
 * SI SE LE OFRECEN AL AUDITOR sus dos decisiones: abrir otra ronda, o empezar
 * el ajuste. Es la pregunta que hace la pantalla, y NO es la misma que "la
 * última ronda ya cerró".
 *
 * BUG REAL (emulador, inventario 8040): las dos acciones estaban condicionadas
 * a la fase 'rondas-cerradas', que contra el backend real no se puede saber
 * (ver `faseDeCierre`). Resultado: la pantalla del Ciclo decía "el auditor
 * decide: otro conteo, o el ajuste final" y no mostraba un solo botón para
 * decidir ninguna de las dos cosas.
 *
 * Así que el candado se corre a lo que SÍ se sabe: el inventario está abierto
 * y el ajuste todavía no empezó. La precondición real -- que no quede una
 * ronda abierta -- la sostiene el servidor, que responde 409 con el motivo
 * escrito, y la pantalla lo dice de antemano en vez de fingir que lo sabe.
 *
 * Es el criterio menos malo de los dos: un botón que puede recibir un 409
 * explicado es peor que un botón perfecto, pero mucho mejor que no tener
 * ninguna salida -- que es lo que había.
 */
export function elAuditorPuedeDecidir(fase: FaseDeCierre): boolean {
  return fase === 'contando' || fase === 'rondas-cerradas';
}

/** Con la última ronda cerrada, las dos decisiones son válidas de verdad. */
export function puedeAbrirRondaExtra(fase: FaseDeCierre): boolean {
  return fase === 'rondas-cerradas';
}

export function puedeIniciarAjuste(fase: FaseDeCierre): boolean {
  return fase === 'rondas-cerradas';
}

/** El Auditor cambia valores (y cierra) solo durante el ajuste. */
export function puedeAjustar(fase: FaseDeCierre): boolean {
  return fase === 'ajuste';
}

/**
 * POR QUÉ NO SE PUEDE CORREGIR AHORA -- en términos del negocio, nunca del
 * sistema. `null` cuando sí se puede.
 *
 * Un "no se puede" a secas obliga a adivinar si es un permiso, un momento o
 * una falla; y de las tres, dos se arreglan solas esperando y una no.
 *
 * El texto del ajuste cambia según QUIÉN lee: al Coordinador hay que decirle
 * que ahora manda el Auditor; al Auditor, que es él mismo quien sigue y por
 * dónde. Decirle "el auditor ya empezó" AL AUDITOR lo dejaría buscando a otra
 * persona que no existe.
 */
export function motivoSinCorregir(fase: FaseDeCierre, rol: 'coordinador' | 'auditor' = 'coordinador'): string | null {
  if (fase === 'ajuste') {
    return rol === 'auditor'
      ? 'Ya empezaste el ajuste final de este inventario: desde aquí no se corrige más. Los valores definitivos se fijan en Ajuste final del conteo.'
      : 'El auditor ya empezó el ajuste final de este inventario: desde ahora los valores los cambia él, comparando contra el stock. Ya no se pueden corregir desde aquí.';
  }
  if (fase === 'cerrado') {
    return 'El conteo de este inventario ya cerró: los valores quedaron firmes y son los que usa la liquidación.';
  }
  return null;
}

/**
 * LO QUE NUNCA SE CORRIGE: el stock del ERP.
 *
 * Regla textual del cliente: corregir lo CONTADO no es lo mismo que corregir
 * el STOCK. El stock viene del sistema y no lo cambia nadie desde la app --
 * ni el Auditor, que es el único que lo ve mientras corrige.
 *
 * Vive acá y no dentro de una pantalla porque lo dicen DOS: la pantalla de
 * corrección del Auditor y su modal. Dos redacciones distintas de la misma
 * regla es como se abre la puerta a que una de las dos insinúe que el stock
 * se toca.
 */
export const STOCK_NO_SE_CORRIGE =
  'El stock viene del sistema y no se corrige desde aquí: está para comparar. Lo que cambias es lo que se contó.';

// ---------------------------------------------------------------------------
// El motivo
// ---------------------------------------------------------------------------

/**
 * Mínimo de caracteres de un motivo, ya sin espacios de los bordes.
 *
 * El contrato solo exige que el motivo EXISTA; este piso es nuestro. Con un
 * campo obligatorio y sin piso, lo que se escribe es "." o "x" -- y entonces
 * el requisito se cumple en la base y no se cumple en la realidad, que es
 * poder explicar el descuento seis meses después. Cinco caracteres no
 * garantizan una buena explicación, pero descartan el relleno de un toque.
 */
export const MOTIVO_MINIMO = 5;

export function motivoValido(motivo: string): boolean {
  return motivo.trim().length >= MOTIVO_MINIMO;
}

/** Qué falta para que el motivo sirva. `null` cuando ya sirve. */
export function errorDeMotivo(motivo: string): string | null {
  const limpio = motivo.trim();
  if (limpio.length === 0) return 'Escribe por qué cambias este valor: queda registrado junto al cambio.';
  if (limpio.length < MOTIVO_MINIMO) return `Explica un poco más: al menos ${MOTIVO_MINIMO} caracteres.`;
  return null;
}

// ---------------------------------------------------------------------------
// El aviso al finalizar una hoja
// ---------------------------------------------------------------------------

/**
 * LO QUE PASA DESPUÉS DE FINALIZAR UNA HOJA, dicho como es ahora.
 *
 * Decía: "la hoja queda congelada: ningún ítem se puede volver a editar".
 * Eso pasó a ser FALSO el día que el Coordinador pudo corregir, y una
 * promesa falsa acá es cara en las dos direcciones: quien cree que no hay
 * vuelta atrás no finaliza una hoja que ya terminó (y traba el cierre de la
 * ronda para todo el equipo), y quien descubre que sí se podía deja de
 * creerle al resto de los avisos de la app.
 *
 * El texto nuevo dice las dos cosas que son ciertas y que a esta persona le
 * importan: que ELLA ya no la toca, y quién sí puede -- con nombre de rol,
 * para que sepa a quién pedirle el arreglo.
 */
export const TEXTO_TRAS_FINALIZAR =
  'Después de finalizar, tú ya no editas esta hoja. Si aparece un error, el coordinador puede corregir el valor —dejando registrado el motivo— hasta que el auditor empiece el ajuste final del inventario.';

// ---------------------------------------------------------------------------
// Quién sigue abierto
// ---------------------------------------------------------------------------

/**
 * `true` = el conteo de este inventario TODAVÍA NO CERRÓ.
 *
 * Existe porque `ajuste_auditor` rompe una suposición que estaba repartida por
 * toda la app: que "abierto" era exactamente `en_curso`. Media docena de
 * lugares comparaban contra ese literal, y el día que el Auditor arranca el
 * ajuste todos habrían dado el inventario por cerrado -- pidiendo diferencias
 * que no existen, ofreciendo exportar una planilla que no se calculó y
 * llamando "cerrado" a un inventario que está en su paso más delicado.
 *
 * Una sola función y no un `estado !== 'en_curso'` en cada archivo: el día que
 * aparezca otra fase intermedia, se agrega acá y no en seis lugares -- que es
 * exactamente el error que este cambio vino a arreglar.
 */
export function conteoAbierto(estado: EstadoInventario): boolean {
  return estado === 'en_curso' || estado === 'ajuste_auditor';
}
