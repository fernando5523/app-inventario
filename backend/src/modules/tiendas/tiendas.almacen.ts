/**
 * Resolucion del almacen de Dynamics al crear o editar una tienda. PURO --
 * sin Prisma, sin Express, sin red -- para testearlo sin base ni ERP (mismo
 * criterio que hojas.calculos.ts).
 *
 * POR QUE ESTO EXISTE Y NO ALCANZA CON VALIDAR EL FORMATO.
 *
 * "MD11_CENT" y "MD11_CNET" tienen los dos la forma correcta. El segundo, si
 * no existe, hace que el snapshot no traiga stock de nada; y si existe pero
 * es de otra tienda, trae el stock EQUIVOCADO -- la auditoria compara contra
 * numeros que parecen validos y nadie se entera hasta que el inventario no
 * cuadra a fin de mes, con once personas ya habiendo contado.
 *
 * Por eso el codigo se verifica contra la lista real del ERP
 * (`GET /api/d365/almacenes`, entidad `Warehouses`) antes de guardarlo. La
 * pantalla ofrece esa misma lista para ELEGIR, no un campo de texto: el
 * servidor es el ultimo candado, la pantalla el primero.
 */

import { SolicitudInvalida } from '../../shared/errores';

export interface AlmacenDisponible {
  codigo: string;
  nombre: string;
}

export interface AlmacenResuelto {
  almacenId: string;
  almacenNombre: string;
}

/**
 * Encuentra el almacen en la lista del ERP y devuelve su codigo Y su nombre.
 *
 * El nombre se copia a la sucursal a proposito: asi mostrar una tienda no
 * exige una llamada a Dynamics, y ademas queda constancia de QUE se eligio
 * -- si mañana en el ERP renombran el almacen, la tienda sigue diciendo con
 * cual se la configuro. Misma razon que DiferenciaItem.descripcion.
 *
 * La comparacion es sin distinguir mayusculas porque un codigo tipeado en
 * minusculas es la misma intencion; el que se guarda es SIEMPRE el del ERP,
 * con su capitalizacion original -- si se guardara lo que vino del cliente,
 * dos tiendas podrian quedar con "md11_cent" y "MD11_CENT" para el mismo
 * almacen y cualquier comparacion posterior fallaria.
 */
export function resolverAlmacen(codigoPedido: string, disponibles: AlmacenDisponible[]): AlmacenResuelto {
  const buscado = codigoPedido.trim().toLowerCase();
  const encontrado = disponibles.find((a) => a.codigo.toLowerCase() === buscado);

  if (encontrado === undefined) {
    // El mensaje sugiere los parecidos: casi siempre es un dedazo, y decir
    // "no existe" a secas obliga a ir a buscar la lista a otro lado.
    const parecidos = disponibles
      .filter((a) => a.codigo.toLowerCase().startsWith(buscado.slice(0, 3)))
      .slice(0, 5)
      .map((a) => a.codigo);

    const sugerencia =
      parecidos.length > 0
        ? ` ¿Quisiste decir alguno de estos? ${parecidos.join(', ')}.`
        : ' Consultá la lista en GET /api/d365/almacenes.';

    throw new SolicitudInvalida(
      `El almacen "${codigoPedido}" no existe en Dynamics.${sugerencia} Un almacen mal escrito trae el stock de otra tienda y el error recien se nota cuando el inventario no cuadra.`,
    );
  }

  return { almacenId: encontrado.codigo, almacenNombre: encontrado.nombre };
}

/**
 * Si esta sucursal puede traer stock del ERP. Sin almacen configurado la
 * respuesta es no, y el snapshot lo tiene que rechazar en vez de traer un
 * catalogo con todo el stock en null que parece un inventario vacio.
 */
export function puedeTraerStock(sucursal: { almacenId: string | null }): boolean {
  return sucursal.almacenId !== null && sucursal.almacenId !== '';
}

/** El error que ve el Coordinador cuando aprieta "traer snapshot" sin almacen. */
export function mensajeSinAlmacen(nombreSucursal: string): string {
  return (
    `La tienda "${nombreSucursal}" no tiene un almacen de Dynamics asociado, asi que no se puede traer su stock. ` +
    'Un administrador tiene que elegirlo en la gestion de tiendas (PATCH /api/tiendas/:id con almacenId).'
  );
}
