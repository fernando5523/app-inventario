/**
 * Cómo se le cuenta al Coordinador QUÉ ENTRÓ al conteo.
 *
 * Antes la pantalla afirmaba siempre lo mismo: "Se contaron los productos
 * activos, con stock en el almacén de la sucursal y que son responsabilidad
 * del personal. El resto quedó afuera." Los tres criterios, en toda corrida.
 *
 * Ninguno de los tres estaba garantizado (hallazgo 2026-09-09):
 *
 *   - El filtro por ESTADO ACTIVO nunca existió. `ReleasedProductsV2` no se
 *     consulta ni se filtra por estado, así que un producto bloqueado para
 *     venta o descontinuado, con stock remanente, entra al conteo igual.
 *   - El de STOCK se cae si la sucursal no tiene almacén configurado.
 *   - El de RESPONSABLE se cae si la entidad de responsables falla o viene
 *     vacía (decisión deliberada del backend: mejor un catálogo de más, que
 *     se ve, que uno vacío por un error de red).
 *
 * Por qué importa tanto: este texto es lo que el Coordinador va a repetir
 * cuando alguien pregunte por qué se contó tal cosa, y sobre estos números se
 * le descuenta plata a la gente. Un criterio afirmado y no aplicado no es una
 * imprecisión de redacción — es la clase de dato que hace que un faltante se
 * cobre sin que nadie sepa de dónde salió.
 *
 * EL TONO NO ES DE ALARMA, a propósito. El Coordinador no hizo nada mal y casi
 * nunca puede arreglar lo que falta (configurar un almacén es del
 * Administrador). Lo que necesita es saber qué entró. Por eso: una línea
 * afirmativa con lo que SÍ se aplicó, y solo si faltó algo, una segunda línea
 * corta que lo aclara sin dramatizar.
 */

import type { CriteriosSnapshot, TipoInventario } from '../puertos/repositorios';

export interface TextoCriterios {
  /** Qué entró. Siempre presente. */
  resumen: string;
  /** Qué no se pudo filtrar. `null` cuando se aplicó todo lo que se puede aplicar hoy. */
  advertencia: string | null;
}

/**
 * `criterios` opcional: un backend viejo que no lo manda NO es "no se filtró
 * nada". Sin el dato no se afirma ningún criterio -- se dice cuántos entraron
 * y nada más, que es la lectura honesta de "no sé qué corrió".
 */
export function textoDeCriterios(
  items: number,
  tipo: TipoInventario,
  criterios: CriteriosSnapshot | undefined,
  formatoMiles: (n: number) => string,
): TextoCriterios {
  const cuantos = `${formatoMiles(items)} ${items === 1 ? 'ítem' : 'ítems'}`;

  if (!criterios) {
    return { resumen: `Entraron ${cuantos} al inventario.`, advertencia: null };
  }

  // Las partes que SÍ se aplicaron, en el orden en que se entienden: primero
  // dónde está la mercadería, después de quién es.
  const aplicados: string[] = [];
  if (criterios.porStock) aplicados.push('tienen stock en el almacén de la tienda');
  if (criterios.porResponsable) aplicados.push('son responsabilidad del personal');
  if (criterios.porEstadoActivo) aplicados.push('están activos en Dynamics');

  const resumen =
    aplicados.length === 0
      ? `Entraron ${cuantos}: todo el catálogo de la empresa, sin filtrar.`
      : `Entraron ${cuantos}: los que ${unirConY(aplicados)}.`;

  // Lo que NO se pudo aplicar. El estado activo se nombra distinto de los
  // otros dos a propósito: los otros fallaron en ESTA corrida y pueden andar
  // en la próxima; el de estado no existe todavía en el sistema, y decir "no
  // se pudo" sugeriría que a veces sí.
  const faltantes: string[] = [];
  if (!criterios.porStock) faltantes.push('sin filtrar por stock (esta tienda no tiene almacén configurado)');
  if (!criterios.porResponsable && tipo === 'mensual') {
    faltantes.push('sin separar lo que asume la empresa (no se pudo leer el responsable de cada ítem)');
  }
  if (!criterios.porEstadoActivo) faltantes.push('incluyendo los que están bloqueados o descontinuados en Dynamics');

  return {
    resumen,
    advertencia: faltantes.length === 0 ? null : `Entraron también ${unirConY(faltantes)}.`,
  };
}

/** "a", "a y b", "a, b y c" — el separador final en palabras, como se habla. */
function unirConY(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}
