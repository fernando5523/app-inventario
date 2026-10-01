/**
 * EL .xlsx CON EL FORMATO DE LA PLANILLA DEL CLIENTE: las cuatro hojas que
 * Gilmer arma a mano todos los meses -- FALTANTES (únicos, faltante por
 * paquete y sobrante por paquete), SOBRANTES, EMPRESA y DESCUENTO.
 *
 * ES OTRO ARCHIVO que el de `exportar-diferencias.ts`, no su reemplazo: aquel
 * baja UNA tabla plana de una hoja para analizar en otra herramienta, este es
 * el que el cliente pone al lado del suyo para comparar. Los dos salen del
 * mismo cálculo del servidor. Por eso el texto del botón tiene que
 * distinguirlos: son dos .xlsx del mismo inventario, y bajar el equivocado se
 * descubre recién al abrirlo.
 *
 * Acá viven las dos decisiones puras que no pueden quedar adentro del JSX: SI
 * se puede bajar (y si no, POR QUÉ) y CÓMO SE LLAMA el archivo que llegó.
 */
import type { EstadoInventario } from '../puertos/repositorios';
import type { EstadoExportacion } from './exportar-diferencias';

export type { EstadoExportacion };

/**
 * ¿Se puede bajar la planilla, y si no, qué se le dice a quien vino a bajarla?
 *
 * Mismo criterio que `exportar-diferencias.ts#estadoExportacion`, del que
 * hereda la lección: el motivo NUNCA es genérico. "Todavía no contaron nada" y
 * "estás en medio del ajuste" se destraban de formas distintas, y un solo
 * texto para las dos obliga a adivinar en cuál estás.
 *
 * DOS DIFERENCIAS DELIBERADAS con el de diferencias, las dos porque este
 * archivo no es la misma cosa:
 *
 *  1. `en_curso` NO bloquea. El panel de auditoría MUESTRA los cuadros con el
 *     conteo abierto; bloquear el archivo que trae esos mismos números diría
 *     "podés mirarlo pero no bajarlo". Lo que corresponde es decir que es una
 *     foto de lo contado hasta ahora (ver `notaExportacionCuadros`), no
 *     esconder el botón.
 *  2. Cero diferencias TAMPOCO bloquea. El de diferencias se bloquea ahí
 *     porque saldría un .xlsx con solo los encabezados; este sale con las
 *     cuatro hojas diciendo "Sin ítems en este cuadro", que es una afirmación
 *     útil y verdadera: el inventario cuadró y no hay nada que descontar.
 *
 * Lo que SÍ bloquea es no tener con qué comparar: `itemsAuditables` son los
 * ítems con stock del ERP Y algún conteo (`auditoria.ts#esAuditable`). Con
 * cero, las cuatro hojas saldrían vacías y el archivo afirmaría "no falta
 * nada" sin que nadie haya contado -- un vacío leído como éxito, que es el
 * error más caro que tuvo esta app.
 */
export function estadoExportacionCuadros(estado: EstadoInventario, itemsAuditables: number): EstadoExportacion {
  if (estado === 'anulado') {
    return {
      puedeExportar: false,
      motivo: 'Este inventario se anuló antes de cerrar el conteo, así que nunca tuvo cuadros que repartir.',
    };
  }
  if (estado === 'ajuste_auditor') {
    // El ajuste final cambia valores contados, y cada corrección puede mover
    // un ítem de un cuadro a otro. Un archivo bajado a mitad de camino se
    // manda por correo y queda como si fuera el definitivo.
    return {
      puedeExportar: false,
      motivo:
        'Estás haciendo el ajuste final: cada corrección puede mover un ítem de un cuadro a otro. La planilla definitiva sale cuando cierres el ajuste.',
    };
  }
  if (itemsAuditables === 0) {
    return {
      puedeExportar: false,
      motivo:
        'Todavía no hay ningún ítem con stock del sistema y conteo cargado. La planilla saldría diciendo que no falta nada, sin que nadie haya contado.',
    };
  }
  return { puedeExportar: true };
}

/**
 * LA SALVEDAD, cuando se puede bajar pero el número todavía se puede mover.
 * `null` = no hay nada que aclarar.
 *
 * Con el conteo abierto los cuadros se arman con el conteo final de cada
 * producto, y ese "final" es el último que exista HOY: una ronda más lo cambia.
 * Quien manda el archivo tiene que saber que está mandando una foto, no el
 * cierre.
 */
export function notaExportacionCuadros(estado: EstadoInventario): string | null {
  if (estado === 'en_curso') {
    return 'El conteo sigue abierto: la planilla sale con lo contado hasta ahora, y una ronda más puede cambiarla.';
  }
  return null;
}

/**
 * EL NOMBRE DEL ARCHIVO QUE MANDÓ EL SERVIDOR, leído del header.
 *
 * POR QUÉ NO SE RECALCULA ACÁ, como sí hace
 * `exportar-diferencias.ts#nombreArchivoDiferencias`: ese lo rearma en el
 * teléfono porque los tres datos del patrón (sucursal, período, inventario) ya
 * estaban en la pantalla del Historial. El panel de auditoría NO los tiene --
 * `RepositorioInventario.activo()` devuelve el `inventarioId` y el estado, sin
 * período ni nombre de sucursal. Y leerlo del header deja UN solo dueño del
 * nombre (el backend, `historial.exportar-cuadros.ts#nombreArchivoCuadros`),
 * así que no hay dos formatos que se puedan desalinear con el tiempo.
 *
 * Importa que llegue: el cliente recibe cinco de estos por correo en el mismo
 * día, y con `download.xlsx` no distingue la tienda ni el mes.
 *
 * Soporta las dos formas que puede mandar un servidor -- `filename="x.xlsx"` y
 * `filename*=UTF-8''x.xlsx` (RFC 5987, con porcentaje) -- y prefiere la
 * segunda, que es la que conserva los acentos. Devuelve `null` cuando no vino
 * el header o no se le puede sacar un nombre: quien llama decide qué poner, y
 * acá NO se inventa uno que parezca venir del servidor.
 */
export function nombreDeContentDisposition(valor: string | null | undefined): string | null {
  if (!valor) return null;

  // `filename*` primero: es la forma que viaja bien con acentos. El `''` del
  // medio es el campo de idioma del RFC, casi siempre vacío.
  const extendido = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(valor);
  if (extendido?.[2] !== undefined) {
    const crudo = extendido[2].trim();
    // Un porcentaje mal formado tira `URIError`. Un nombre roto no justifica
    // tumbar una descarga que ya llegó: se cae al `filename` simple de abajo.
    try {
      const decodificado = sanear(decodeURIComponent(crudo));
      if (decodificado !== null) return decodificado;
    } catch {
      /* sigue con `filename` */
    }
  }

  const simple = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(valor);
  if (simple === null) return null;
  return sanear((simple[2] ?? simple[1] ?? '').trim());
}

/**
 * El nombre se usa para CREAR UN ARCHIVO en la caché del teléfono, así que un
 * separador de rutas ahí escribiría fuera de la carpeta. Se queda con el
 * último tramo y nada más: no se "arregla" el nombre, se descarta lo que no
 * puede ser un nombre.
 */
function sanear(nombre: string): string | null {
  const ultimo = nombre.split(/[/\\]/).pop()?.trim() ?? '';
  if (ultimo === '' || ultimo === '.' || ultimo === '..') return null;
  return ultimo;
}

/**
 * Con qué nombre se guarda si el header no vino: dice qué es y de qué
 * inventario, que es lo único que el teléfono sabe con certeza. No imita el
 * patrón del cliente (sucursal y período) -- un nombre a medias que PARECE el
 * del servidor es peor que uno visiblemente mínimo.
 */
export function nombreCuadrosDeRespaldo(inventarioId: number): string {
  return `inventario-cuadros-inv${inventarioId}.xlsx`;
}

/**
 * LOS DOS DATOS QUE PIDE `estadoExportacionCuadros`, CUANDO LA PANTALLA NO LOS
 * TIENE A MANO.
 *
 * El panel de auditoría los tiene los dos antes de dibujar el botón: entra
 * pidiendo `RepositorioInventario.activo()` (que trae el estado) y
 * `RepositorioAuditoria.resumen()` (que trae los auditables). La LIQUIDACIÓN
 * no: su pregunta es "cómo quedó el último cierre de esta tienda"
 * (`RepositorioLiquidacion.deSucursal`), y ese DTO no trae ninguno de los dos
 * -- los pide aparte, así que puede estar esperándolos o no haberlos
 * conseguido.
 *
 * `datos: null` con `error: null` = todavía se están averiguando.
 */
export interface EntradaExportacionCuadros {
  datos: { estado: EstadoInventario; itemsAuditables: number } | null;
  /** El motivo del servidor si el pedido falló. `null` = no falló. */
  error: string | null;
}

/**
 * LA MISMA REGLA, con la ignorancia contemplada.
 *
 * NO reimplementa nada: en cuanto los dos datos están, delega en
 * `estadoExportacionCuadros` -- hay UNA sola regla de cuándo se puede bajar la
 * planilla, y dos copias se desalinean el día que una cambie. Lo único que
 * agrega son los dos casos en que la pantalla todavía no sabe, y ahí la
 * respuesta es "no se puede, y este es el motivo": nunca `puedeExportar: true`
 * sobre un dato que no llegó, porque eso habilita un botón que va a fallar, y
 * nunca esconder el botón, que deja al Auditor buscando un camino que existe.
 */
export function estadoExportacionCuadrosDe({ datos, error }: EntradaExportacionCuadros): EstadoExportacion {
  // El error primero, igual que `reporte-gerencia.ts#vistaReporteGerencia`: un
  // pedido que falló y uno que no volvió todavía se destraban distinto
  // (reintentar vs esperar), y el motivo tiene que decir cuál de los dos es.
  if (error !== null) {
    return {
      puedeExportar: false,
      motivo: `No se pudo averiguar en qué estado quedó este inventario, así que no se sabe si la planilla saldría completa: ${error}`,
    };
  }
  if (datos === null) {
    return {
      puedeExportar: false,
      motivo: 'Todavía se está averiguando en qué estado quedó el conteo de este inventario.',
    };
  }
  return estadoExportacionCuadros(datos.estado, datos.itemsAuditables);
}
