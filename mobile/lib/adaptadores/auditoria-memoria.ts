/**
 * Adaptador en memoria de RepositorioAuditoria.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts). Reusa los
 * productos REALES ya sembrados en la Hoja #002 (./_compartido.ts) en vez
 * de crear un catálogo paralelo — mismo producto, mismo código, dondequiera
 * que se lo referencie en la app.
 *
 * Los 3 items con ERP/1°/2°/3° conteo son los mismos EXACTOS de
 * mobile/design/auditoria.html (verificados con los tests de
 * dominio/auditoria.test.ts antes de cargarlos acá): no hay stock de
 * Dynamics real para los otros 127 ítems con diferencia que menciona la
 * maqueta — inventar 127 filas más sería el mismo error que ya se evitó
 * en mis-hojas.html/conteo.html con las hojas sin catálogo cargado.
 */

import { obtenerInventario, simularLatencia } from './_compartido';
import { claseEfectiva } from '../dominio/clasificacion';
import { conteoFinal, cuadroDelItem, diferenciaUnidades, resumirAuditoria } from '../dominio/auditoria';
import { ajustesEnMemoria } from './ajuste-memoria';
import type { CuadroDeDiferencias, RepositorioAuditoria, ResumenPorClase } from '../puertos/repositorios';
import type { AtribucionItem, ItemAuditoria } from '../dominio/tipos';

interface SemillaItem {
  codigoBarras: string;
  stockErp: number;
  /** Un elemento por ronda, en orden. `null` = ese ítem no entró a esa ronda. */
  conteos: Array<number | null>;
  esEmpresa: boolean;
  precioVenta: number;
}

/**
 * El empaque de COMPRA de los ítems sembrados, por código de la hoja. Sin esto
 * el mock no podría repartir nada por cuadro: el empaque es el denominador de
 * la razón. Salen de los mismos empaques que ya usa el dataset de conteo.
 */
const EMPAQUE_DEMO: Record<string, number> = { '0051': 12, '0052': 6, '0053': 24 };

/** Códigos de barras de la Hoja #002 (ver _compartido.ts#BASE_PRODUCTOS). */
const SEMILLA: SemillaItem[] = [
  // Fideos Canuto Lavaggi 500g — cuadró en el 2do conteo, no llegó a necesitar un 3ro.
  { codigoBarras: '7750123054', stockErp: 80, conteos: [74, 80, null], esEmpresa: false, precioVenta: 3.2 },
  // Leche Evaporada Gloria Azul 400g — faltante definitivo: -5 unid × S/4.80 = -S/24.00.
  { codigoBarras: '7750123088', stockErp: 96, conteos: [88, 90, 91], esEmpresa: false, precioVenta: 4.8 },
  // Cerveza Cusqueña Trigo 310ml — regla de gerencia: la asume la empresa, no se descuenta a nómina.
  { codigoBarras: '7750999015', stockErp: 54, conteos: [45, 46, 47], esEmpresa: true, precioVenta: 5.2 },
];

/**
 * La lista de conteos con el ajuste del auditor ya aplicado.
 *
 * COPIA, nunca la misma referencia que la semilla: los items de `SEMILLA` son
 * constantes de módulo, y mutarlas dejaría el ajuste de un inventario visible
 * en todos los demás -- incluidos los de otras tiendas.
 */
function conAjuste(conteos: ReadonlyArray<number | null>, ajuste: number | undefined): Array<number | null> {
  const copia = [...conteos];
  if (ajuste === undefined) return copia;
  // Se pisa la ÚLTIMA posición con dato. Si el ítem no se contó en ninguna
  // ronda, el ajuste entra en la primera: el auditor puso un valor donde no
  // había ninguno, que es un caso real (un ítem que nadie llegó a contar).
  const ultima = copia.reduce<number>((mejor, valor, i) => (valor !== null ? i : mejor), -1);
  copia[ultima >= 0 ? ultima : 0] = ajuste;
  return copia;
}

/**
 * EL UMBRAL DEL MOCK. El real va CONGELADO en cada inventario
 * (`Inventario.umbralMediaUnidadPaquete`) y no viaja en ninguna respuesta; acá
 * se usa el default del sistema para que la demo sea coherente consigo misma.
 *
 * Es el único lugar del móvil donde vive este número, y a propósito: es un
 * dataset de demostración, no la regla. Contra el backend real el resumen lo
 * calcula el servidor (ver `ResumenAuditoriaServidor` en el puerto).
 */
const UMBRAL_DEMO = 0.5;

function cuadroVacio(): CuadroDeDiferencias {
  return { items: 0, unidadesFaltantes: 0, unidadesSobrantes: 0, valorFaltante: 0, valorSobrante: 0 };
}

/** Suma un ítem a su cuadro. El signo decide el lado; las dos columnas guardan POSITIVOS. */
function acumular(cuadro: CuadroDeDiferencias, unidades: number, precioVenta: number | null): void {
  if (unidades === 0) return;
  cuadro.items += 1;
  const valor = Math.abs(unidades) * (precioVenta ?? 0);
  if (unidades < 0) {
    cuadro.unidadesFaltantes += -unidades;
    cuadro.valorFaltante += valor;
  } else {
    cuadro.unidadesSobrantes += unidades;
    cuadro.valorSobrante += valor;
  }
}

/**
 * El reparto del mock, con la MISMA forma que el del servidor. Usa
 * `UMBRAL_DEMO` porque el real va congelado en el inventario y no viaja: es un
 * dataset de demostración, no la regla.
 */
function atribucionDemo(
  semilla: SemillaItem,
  codigo: string,
  conteos: ReadonlyArray<number | null>,
): AtribucionItem {
  const empaque = EMPAQUE_DEMO[codigo] ?? null;
  const clase = claseEfectiva(null, semilla.esEmpresa ? 'empresa' : 'unidad', empaque);
  const final = conteoFinal({ conteos });
  const diferencia = final === null ? null : final - semilla.stockErp;
  const base: AtribucionItem = {
    clase,
    empaqueUsado: empaque,
    empaqueSimbolo: empaque === null ? null : `Emp.${empaque}`,
    // El mock no tiene correcciones del Auditor: su empaque ES el del snapshot.
    empaqueEsCorregido: false,
    razon: diferencia === null || empaque === null ? null : Math.abs(diferencia) / empaque,
    unidadesAlPersonal: 0,
    unidadesAPaquetes: 0,
    unidadesAEmpresa: 0,
  };
  if (diferencia === null || diferencia === 0) return base;
  if (clase === 'empresa') return { ...base, unidadesAEmpresa: diferencia };
  if (clase === 'paquete' && empaque !== null && Math.abs(diferencia) / empaque > UMBRAL_DEMO) {
    return { ...base, unidadesAPaquetes: diferencia };
  }
  return { ...base, unidadesAlPersonal: diferencia };
}

export const auditoriaMemoria: RepositorioAuditoria = {
  /**
   * El mismo resumen que devuelve el servidor, armado sobre los ítems
   * sembrados. Reparte por cuadro con `UMBRAL_DEMO`: sin eso, un mock que
   * devolviera cuadros en cero mostraría "S/0 al personal" sobre un dataset
   * con faltantes, que es justo la clase de mentira que este repo evita.
   */
  async resumen(inventarioId) {
    const items = await auditoriaMemoria.matriz(inventarioId);
    const porClase: ResumenPorClase = { unidad: cuadroVacio(), paquete: cuadroVacio(), empresa: cuadroVacio() };
    let valorFaltante = 0;
    let valorSobrante = 0;
    let unidadesFaltantes = 0;
    let unidadesSobrantes = 0;
    let sinPrecio = 0;

    for (const item of items) {
      const diferencia = diferenciaUnidades(item);
      if (diferencia === null || diferencia === 0) continue;
      // EL MISMO REPARTO QUE YA TIENE LA FILA: se lee, no se vuelve a decidir.
      // Si el resumen repartiera por su cuenta, el mock podría mostrar una
      // fila en un cuadro y el total en otro -- justo el bug que la pantalla
      // real evita pidiéndole los dos al servidor.
      const cuadro = cuadroDelItem(item.atribucion);
      const destino = cuadro === 'paquetes' ? 'paquete' : cuadro === 'empresa' ? 'empresa' : 'unidad';
      acumular(porClase[destino], diferencia, item.precioVenta);

      const valor = Math.abs(diferencia) * (item.precioVenta ?? 0);
      if (item.precioVenta === null) sinPrecio += 1;
      if (diferencia < 0) {
        unidadesFaltantes += -diferencia;
        valorFaltante += valor;
      } else {
        unidadesSobrantes += diferencia;
        valorSobrante += valor;
      }
    }

    const local = resumirAuditoria(items);
    return {
      items: local.total,
      cuadrados: local.cuadrados,
      conFalta: local.conFalta,
      deEmpresa: local.deEmpresa,
      sinDatoErp: local.sinDatoErp,
      sinContar: local.sinContar,
      // Del resumen local, que lo cuenta con la MISMA regla que el servidor
      // (`conteoFinal` no nulo) -- no `total - sinContar`, que se comería los
      // ítems sin ERP que sí se contaron.
      contados: local.contados,
      // El mock no tiene `claseForzada`: su clase efectiva es la del ítem.
      contadosDeEmpresa: items.filter((it) => conteoFinal(it) !== null && it.atribucion.clase === 'empresa').length,
      auditables: local.auditables,
      porcentajeCuadrado: local.auditables === 0 ? 0 : (local.cuadrados / local.auditables) * 100,
      porcentajeAuditable: local.total === 0 ? 0 : (local.auditables / local.total) * 100,
      unidadesFaltantes,
      unidadesSobrantes,
      valorFaltante,
      valorSobrante,
      // Lo que NO sale por paquetes ni lo absorbe la empresa.
      valorFaltanteDescontable: porClase.unidad.valorFaltante,
      sinPrecio,
      porClase,
    };
  },

  async matriz(inventarioId) {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) return [];

    const hoja002 = inventario.hojas.find((h) => h.numero === '002');
    if (!hoja002) return [];

    // Lo que el auditor ya ajustó en este inventario. El ajuste REEMPLAZA el
    // último valor contado -- es literalmente lo que pidió el cliente
    // ("cambiar los valores contados del último conteo") -- así que no se
    // agrega una columna: se pisa la última que tiene dato. Una columna extra
    // haría que la matriz muestre una ronda que nadie contó.
    const ajustes = ajustesEnMemoria(inventarioId);

    const items: ItemAuditoria[] = [];
    for (const semilla of SEMILLA) {
      const producto = hoja002.productos.find((p) => p.codigoBarras === semilla.codigoBarras);
      if (!producto) continue; // catálogo de la hoja todavía no cargado — no se inventa el producto acá tampoco.
      const conteosDelItem = conAjuste(semilla.conteos, ajustes.get(producto.id));
      items.push({
        productoId: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        zona: hoja002.zona,
        // La demo tiene una sola hoja con catálogo, así que todos sus ítems
        // salen de ella: es coherente, no un relleno.
        hoja: hoja002.numero,
        precioVenta: semilla.precioVenta,
        stockErp: semilla.stockErp,
        conteos: conteosDelItem,
        esEmpresa: semilla.esEmpresa,
        // El mock reparte con el mismo criterio que el servidor, con el umbral
        // por defecto (ver UMBRAL_DEMO): un mock que devolviera la atribución
        // en cero mostraría "sin dato" sobre ítems que sí tienen diferencia.
        atribucion: atribucionDemo(semilla, producto.codigo, conteosDelItem),
      });
    }
    return items;
  },
};
