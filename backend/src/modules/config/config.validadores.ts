/**
 * Regla de negocio por clave de configuracion -- CERO Prisma aca, misma
 * razon que usuarios.permisos.ts: se puede testear sin base de datos
 * (ver config.validadores.test.ts).
 */

import { parsear, serializar } from '../d365/d365.almacenes-inventario';
import { SolicitudInvalida } from '../../shared/errores';
import type { ClaveConfiguracion } from './config.schema';

export type TipoConfig = 'entero' | 'decimal' | 'texto';

/**
 * Un validador por clave: recibe el `valor` crudo del request (string o
 * numero, ya lo saco de encima config.schema.ts) y devuelve la
 * representacion canonica en STRING que se guarda en la columna `valor`
 * (ver prisma/schema.prisma#Configuracion) -- o lanza si no cumple la
 * regla de negocio de esa clave puntual.
 */
export const VALIDADORES: Record<ClaveConfiguracion, (valorCrudo: string | number) => string> = {
  TAMANO_HOJA_DEFECTO: (valorCrudo) => {
    const n = Number(valorCrudo);
    if (![20, 30, 50].includes(n)) {
      throw new SolicitudInvalida('TAMANO_HOJA_DEFECTO debe ser 20, 30 o 50 (mobile/lib/dominio/tipos.ts#TAMANOS_HOJA).');
    }
    return String(n);
  },
  CANTIDAD_CONTEOS_CICLO: (valorCrudo) => {
    const n = Number(valorCrudo);
    if (!Number.isInteger(n) || n < 1) {
      throw new SolicitudInvalida('CANTIDAD_CONTEOS_CICLO debe ser un entero mayor o igual a 1.');
    }
    return String(n);
  },
  /**
   * Lista de codigos separados por coma. Se guarda NORMALIZADA (mayusculas,
   * sin repetidos, ordenada) para que dos escrituras equivalentes no queden
   * como valores distintos en la base y en el log de auditoria.
   *
   * Se acepta la lista VACIA: es como se apaga el filtro (ver `filtrar`, que
   * con lista vacia devuelve todos los almacenes). Bloquear el vaciado
   * dejaria sin salida a quien se equivoco y se quedo sin almacenes validos.
   */
  ALMACENES_INVENTARIO: (valorCrudo) => {
    if (typeof valorCrudo !== 'string') {
      throw new SolicitudInvalida('ALMACENES_INVENTARIO es una lista de codigos separados por coma.');
    }
    const codigos = parsear(valorCrudo);
    const invalido = codigos.find((c) => !/^[A-Z0-9_]{2,20}$/.test(c));
    if (invalido !== undefined) {
      throw new SolicitudInvalida(
        `"${invalido}" no parece un codigo de almacen de Dynamics (letras, numeros y guion bajo, 2 a 20 caracteres).`,
      );
    }
    return serializar(codigos);
  },
  UMBRAL_MEDIA_UNIDAD_PAQUETE: (valorCrudo) => {
    const n = Number(valorCrudo);
    // 0 excluido (todo faltante contaria como paquete) y 1 excluido (nunca
    // contaria como paquete): el rango util es estrictamente (0, 1).
    if (!Number.isFinite(n) || n <= 0 || n >= 1) {
      throw new SolicitudInvalida('UMBRAL_MEDIA_UNIDAD_PAQUETE debe ser un numero entre 0 y 1 (ej. 0.5 = mitad del paquete).');
    }
    return String(n);
  },
};

/** Convierte el `valor` guardado (siempre string) a su tipo real para la respuesta HTTP. */
export function parsearValor(valor: string, tipo: TipoConfig): number | string {
  if (tipo === 'entero') return parseInt(valor, 10);
  if (tipo === 'decimal') return parseFloat(valor);
  return valor;
}
