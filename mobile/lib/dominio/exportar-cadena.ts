/**
 * EL .xlsx CON EL DETALLE POR PRODUCTO DE TODA LA CADENA: una fila por ítem
 * con diferencia, de todas las tiendas del período, con su cuadro y su tienda
 * en columnas.
 *
 * Pedido del usuario mirando la tabla de tiendas del panel de auditoría:
 * *"Incluir los sobrantes y faltantes en la tabla, así puede sacar sus cálculos
 * y exportar el detalle de sobrantes y faltantes por productos"*. La tabla da
 * los totales por tienda; este archivo es el respaldo que los explica ítem por
 * ítem, y es con lo que el Auditor arma sus cuentas en Excel.
 *
 * ---------------------------------------------------------------------------
 * ES EL TERCER .xlsx DE LA APP, Y NINGUNO REEMPLAZA A OTRO
 * ---------------------------------------------------------------------------
 *   - `exportar-diferencias.ts` -> tabla plana de UN inventario.
 *   - `exportar-cuadros.ts`     -> la planilla del cliente, con los cuatro
 *                                  cuadros y la hoja de descuento, de UN
 *                                  inventario.
 *   - este                      -> tabla plana de LA CADENA: todas las tiendas
 *                                  del período en una sola hoja, con la columna
 *                                  Sucursal distinguiendo cada fila.
 *
 * Por eso el botón de este archivo NO es el mismo que el de la planilla, y los
 * dos conviven en la pantalla: bajar el equivocado se descubre recién al
 * abrirlo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTE SÍ SE PUEDE BAJAR EN MEDIO DEL AJUSTE
 * ---------------------------------------------------------------------------
 * `estadoExportacionCuadros` bloquea la planilla cuando el inventario está en
 * `ajuste_auditor`, y con razón: esa planilla es la definitiva del mes, y una
 * bajada a mitad de camino se manda por correo y queda como si fuera el cierre.
 *
 * Este archivo es lo contrario: es la herramienta CON la que se hace el
 * ajuste. Bloquearlo mientras el Auditor ajusta sería esconderlo exactamente
 * en el único momento en que se necesita -- y encima la cadena tiene diez
 * tiendas en estados distintos, así que no existe "el estado" del archivo.
 *
 * La honestidad va en `notaExportacionCadena`, no en un botón apagado: se dice
 * que los números todavía se pueden mover, y se deja bajar.
 */
import type { EstadoInventario, ResumenTiendaCadena, TotalCadena } from '../puertos/repositorios';
import type { EstadoExportacion } from './exportar-diferencias';

export type { EstadoExportacion };

/** Los estados en los que una tienda todavía puede cambiar sus diferencias. */
const ESTADOS_QUE_SE_MUEVEN: readonly EstadoInventario[] = ['en_curso', 'ajuste_auditor'];

/**
 * ¿Se puede bajar el detalle de la cadena, y si no, POR QUÉ?
 *
 * Los tres motivos son distintos a propósito -- se destraban de formas
 * distintas y un solo texto para los tres obliga a adivinar en cuál estás. Es
 * la misma lección que ya dejaron los otros dos exportadores.
 *
 * LO QUE BLOQUEA ES QUE EL ARCHIVO SALDRÍA CON SOLO LOS ENCABEZADOS. Una tabla
 * plana vacía que se manda por correo se lee como "no falta nada": el error más
 * caro que tuvo esta app fue justamente un vacío leído como éxito (11.835 ítems
 * reportados como 100% cuadrados). Un archivo que no afirma nada no se entrega.
 */
export function estadoExportacionCadena(total: TotalCadena): EstadoExportacion {
  if (total.conInventario === 0) {
    return {
      puedeExportar: false,
      motivo:
        'Ninguna tienda abrió el inventario de este período todavía. El archivo saldría con los encabezados solos.',
    };
  }
  if (total.auditables === 0) {
    return {
      puedeExportar: false,
      motivo:
        'Todavía no hay ningún ítem con stock del sistema y conteo cargado. El archivo diría que no falta nada, sin que nadie haya contado.',
    };
  }
  if (total.cuadrados >= total.auditables) {
    // No es un error ni un "todavía": es un resultado, y hay que decirlo como
    // resultado. El Auditor que vino a bajar el detalle tiene que enterarse de
    // que cuadró todo, no encontrarse un botón apagado sin explicación.
    return {
      puedeExportar: false,
      motivo:
        'Todas las tiendas cuadraron contra el ERP: no hay faltantes ni sobrantes que detallar en este período.',
    };
  }
  return { puedeExportar: true };
}

/**
 * LA SALVEDAD cuando se puede bajar pero los números todavía se pueden mover.
 * `null` = no hay nada que aclarar.
 *
 * Nombra CUÁNTAS tiendas siguen abiertas, no un "puede cambiar" genérico: con
 * diez tiendas en la cadena, saber que son dos y no nueve es la diferencia
 * entre mandar el archivo y esperar. La lista de nombres no va -- están en la
 * tabla, arriba del botón.
 */
export function notaExportacionCadena(tiendas: readonly ResumenTiendaCadena[]): string | null {
  const enMovimiento = tiendas.filter(
    (t) => t.estado !== null && ESTADOS_QUE_SE_MUEVEN.includes(t.estado),
  ).length;
  if (enMovimiento === 0) return null;
  return enMovimiento === 1
    ? 'Una tienda todavía está contando o ajustando: sus cifras pueden cambiar.'
    : `${enMovimiento} tiendas todavía están contando o ajustando: sus cifras pueden cambiar.`;
}

/**
 * Con qué nombre se guarda si el servidor no mandó el `Content-Disposition`.
 *
 * El nombre bueno lo manda el backend (`diferencias-cadena-2026-09.xlsx`) y se
 * lee del header con `nombreDeContentDisposition`, por la misma razón que en la
 * planilla de cuadros: un solo dueño del formato. Acá el período SÍ se conoce
 * -- llegó en la respuesta de la cadena -- así que el respaldo puede nombrarlo
 * sin inventar nada.
 */
export function nombreCadenaDeRespaldo(anio: number, mes: number): string {
  return `diferencias-cadena-${anio}-${String(mes).padStart(2, '0')}.xlsx`;
}
