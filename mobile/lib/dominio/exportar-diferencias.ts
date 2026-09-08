/**
 * El nombre del archivo .xlsx de faltantes/sobrantes -- pedido del cliente:
 * identifica tienda + período + inventario, SIN espacios ni acentos, porque
 * es lo que se manda por WhatsApp y un nombre con "í"/" " puede llegar
 * recodificado distinto según el cliente de mensajería del otro lado.
 *
 * Mismo criterio (y mismo formato de salida) que el backend
 * (historial.exportar.ts#nombreArchivoExportDiferencias). Se recalcula acá
 * en vez de leer el header `Content-Disposition` de la respuesta: los tres
 * datos que hacen falta ya están en pantalla (DetalleInventarioHistorico),
 * así que el puerto no necesita devolver más que los bytes.
 */
import type { EstadoInventario } from '../puertos/repositorios';

/**
 * Si se puede exportar, y si no, POR QUÉ Y CÓMO SE DESTRABA.
 *
 * `motivo` nunca es genérico: "todavía no cerró el conteo" y "cerró y no hubo
 * diferencias" son dos situaciones distintas, una se destraba sola con el
 * tiempo y la otra no se destraba nunca porque no hay nada roto. Un solo
 * texto para las dos obligaría a quien lo lee a averiguar en cuál está.
 */
export type EstadoExportacion = { puedeExportar: true } | { puedeExportar: false; motivo: string };

/**
 * ¿Hay algo que exportar, y si no, qué decirle a quien vino a exportar?
 *
 * Nace de dos huecos vistos el 2026-09-08:
 *
 *  1. Con el inventario cerrado y CERO diferencias, el botón seguía vivo y
 *     habría generado un .xlsx con solo los encabezados. Un archivo vacío que
 *     se manda por WhatsApp es peor que no tener el botón: el que lo recibe no
 *     sabe si el inventario cuadró o si la exportación falló.
 *  2. Con el inventario en curso, la sección entera desaparecía sin decir
 *     nada. El Auditor que entra buscando exportar no encontraba ni el botón
 *     ni una explicación -- y "no está" no es lo mismo que "todavía no".
 *
 * Vive en dominio y no adentro del JSX porque son cuatro ramas con bordes, y
 * dentro de un ternario anidado no se puede probar ninguna.
 */
export function estadoExportacion(estado: EstadoInventario, cantidadDiferencias: number): EstadoExportacion {
  if (estado === 'en_curso') {
    return {
      puedeExportar: false,
      motivo: 'El conteo sigue abierto: las diferencias se calculan al cerrar el ciclo. Vas a poder exportar cuando esté cerrado.',
    };
  }
  if (estado === 'anulado') {
    // Un inventario anulado se abandonó sin llegar a cerrar, así que nunca
    // tuvo diferencias calculadas. Decir "cuadró contra el ERP" acá sería
    // afirmar un resultado que no existe.
    return {
      puedeExportar: false,
      motivo: 'Este inventario se anuló antes de cerrar el conteo, así que no tiene diferencias calculadas para exportar.',
    };
  }
  if (cantidadDiferencias === 0) {
    // Cerrado y sin diferencias es una BUENA noticia, no un bloqueo: no hay
    // nada que destrabar ni que esperar. El texto lo dice así, sin sonar a
    // error ni a que falte un paso.
    return {
      puedeExportar: false,
      motivo: 'Este inventario cuadró contra el ERP: no hay diferencias que exportar.',
    };
  }
  return { puedeExportar: true };
}

export function nombreArchivoDiferencias(sucursal: string, periodoAnio: number, periodoMes: number, inventarioId: number): string {
  const slugSucursal =
    sucursal
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal';
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `diferencias-${slugSucursal}-${periodo}-inv${inventarioId}.xlsx`;
}
