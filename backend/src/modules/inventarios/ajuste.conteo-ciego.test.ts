/**
 * EL COORDINADOR NO VE `stockErp`. NUNCA.
 *
 * Es la regla que sostiene todo el sistema -- los 3 conteos cruzados existen
 * para no conocer ese numero -- y el cambio del ajuste final la pone en
 * riesgo por un camino nuevo: ahora el Coordinador CORRIGE valores, y la
 * tentacion natural al armar esa pantalla es mostrarle contra que esta
 * corrigiendo. Si lo viera, dejaria de corregir errores de conteo y pasaria a
 * hacer que el inventario cuadre.
 *
 * Estos tests verifican la regla en vez de confiar en que los DTO "no lo
 * traen": recorren el JSON serializado completo buscando la clave, asi que
 * tambien cae un `stockErp` anidado tres niveles adentro de un campo que
 * alguien agrego despues.
 */

import { describe, expect, it, vi } from 'vitest';

// `hojas.service.ts` importa `config/database` al cargarse (es el archivo que
// toca Prisma). Acá no se consulta nada: solo se usa `aHojaDto`, que es puro.
vi.mock('../../config/database', () => ({ prisma: {} }));

import { validarAccesoALaMatriz } from '../auditoria/auditoria.permisos';
import type { EstadoInventario } from '../historial/historial.permisos';
import { aHojaDto } from '../hojas/hojas.service';
import type { ColaboradorAutenticado } from '../../shared/tipos';

const BOLIVAR = 3;
const oscar: ColaboradorAutenticado = { colaboradorId: 301, sucursalId: BOLIVAR, rol: 'coordinador' };

/** Todas las claves de un objeto, recursivo, incluidas las de los arrays. */
function clavesProfundas(valor: unknown, acumulado = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const v of valor) clavesProfundas(v, acumulado);
  } else if (valor !== null && typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      acumulado.add(clave);
      clavesProfundas(v, acumulado);
    }
  }
  return acumulado;
}

const hojaDePrisma = {
  id: 1,
  inventarioId: 8039,
  numero: '001',
  zona: 'GALLETAS',
  gondola: '001',
  tamano: 50,
  estado: 'finalizada' as const,
  sync: 'sincronizado' as const,
  asignadoA: { id: 302, nombre: 'Silvia Huerta' },
  asignadoA2: null,
  productos: [
    {
      id: 512,
      codigo: 'ITM-001',
      codigoBarras: '7750001',
      descripcion: 'Galleta Soda 6un',
      ubicacion: null,
      categoria: 'GALLETAS',
      empaques: [{ nombre: 'Caja', factor: 12, codigoBarras: null }],
    },
  ],
  conteos: [
    {
      productoId: 512,
      empaques: [{ empaqueNombre: 'Caja', cantidad: 2 }],
      sueltas: 3,
      confirmadoPorEscaner: false,
      contadoEn: new Date('2026-09-18T10:00:00.000Z'),
    },
  ],
};

describe('la hoja que le llega al Coordinador para corregir', () => {
  it('no trae stockErp en ningun nivel del JSON', () => {
    const claves = clavesProfundas(JSON.parse(JSON.stringify(aHojaDto(hojaDePrisma))));
    expect([...claves]).not.toContain('stockErp');
  });

  /**
   * Ni el stock ni el precio: con `precioVenta` y la cantidad contada se
   * deduce la plata que esta en juego, y de ahi al "ajusta hasta que cierre"
   * hay un paso. Van juntos porque los dos salen de `CatalogoItem` y se
   * dejaron atras en el mismo lugar (`inventarios.service.ts#crearHojas`).
   */
  it('tampoco precioVenta ni nada del snapshot de Dynamics', () => {
    const claves = clavesProfundas(JSON.parse(JSON.stringify(aHojaDto(hojaDePrisma))));
    for (const prohibida of ['stockErp', 'precioVenta', 'esEmpresa', 'diferencia']) {
      expect([...claves]).not.toContain(prohibida);
    }
  });

  it('pero si trae lo que la pantalla de correccion necesita', () => {
    const dto = aHojaDto(hojaDePrisma);
    expect(dto.conteos[0]).toMatchObject({ productoId: 512, sueltas: 3 });
    expect(dto.productos[0]).toMatchObject({ id: 512, descripcion: 'Galleta Soda 6un' });
  });
});

/**
 * LA OTRA PUERTA AL STOCK: la matriz de auditoria. El Coordinador la ve solo
 * cuando el inventario esta CERRADO (`auditoria.permisos.ts`), y el estado
 * nuevo `ajuste_auditor` NO es cerrado -- es el tramo en que el Auditor
 * todavia esta decidiendo valores.
 *
 * Importa mas de lo que parece: con el flujo viejo, cerrar la ultima ronda
 * dejaba el inventario en `conteo_cerrado` y el Coordinador veia la matriz
 * desde ese instante. Ahora el inventario se queda en `en_curso` esperando al
 * Auditor, asi que esa puerta se abre MAS TARDE que antes, nunca antes.
 */
describe('la matriz de auditoria durante el ajuste', () => {
  it('el Coordinador NO la ve con el inventario en ajuste_auditor', () => {
    expect(() =>
      validarAccesoALaMatriz(oscar, {
        sucursalId: BOLIVAR,
        // `as` porque el union escrito a mano de historial.permisos.ts
        // todavia no suma `ajuste_auditor` (es de otro lote). El valor SI
        // existe en Postgres y en el cliente de Prisma.
        estado: 'ajuste_auditor' as EstadoInventario,
      }),
    ).toThrow();
  });

  it('tampoco con el inventario en curso: es la regla de siempre', () => {
    expect(() => validarAccesoALaMatriz(oscar, { sucursalId: BOLIVAR, estado: 'en_curso' })).toThrow();
  });

  it('si la ve una vez cerrado el conteo, que es cuando el ciclo ya no se puede contaminar', () => {
    expect(() =>
      validarAccesoALaMatriz(oscar, { sucursalId: BOLIVAR, estado: 'conteo_cerrado' }),
    ).not.toThrow();
  });
});
