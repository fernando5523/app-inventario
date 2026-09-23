/**
 * REGRESION reportada por min-4 (2026-09-14): la matriz de auditoria leia
 * `CatalogoItem.esEmpresa` (Dynamics) directo, sin la excepcion del Auditor
 * (`ClasificacionProducto`) -- un producto que Gilmer clasificaba como
 * empresa DESPUES del cierre del conteo seguia apareciendo en la matriz como
 * faltante del empleado, mientras la liquidacion (que si pasaba por
 * `liquidacion.reclasificacion.ts`) ya lo excluia. Dos pantallas de la misma
 * app diciendo cosas distintas -- misma familia de bug que el del neto, y
 * arreglado con la MISMA fuente (`aplicarClasificacionVigente`).
 *
 * Prisma mockeado, mismo estilo que el resto del proyecto: no hay Postgres
 * en `npm test`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  catalogoItem: { findMany: vi.fn() },
  hojaConteo: { findMany: vi.fn() },
  diferenciaItem: { findMany: vi.fn() },
  clasificacionProducto: { findMany: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

import type { ColaboradorAutenticado } from '../../shared/tipos';
import { matriz } from './auditoria.service';

const AUDITOR: ColaboradorAutenticado = { colaboradorId: 5, sucursalId: null, rol: 'auditor' };

const CERVEZA = {
  codigo: 'CERVEZA',
  descripcion: 'Cerveza 620ml',
  stockErp: 20,
  precioVenta: { toNumber: () => 10 },
  esEmpresa: false,
  // Sin empaque de compra resoluble: `unidad`, que es el caso de 457 de los
  // primeros 2.000 items reales. Estos tests son sobre la CLASIFICACION
  // empresa/empleado, no sobre el reparto por paquete.
  clase: 'unidad' as const,
  empaqueCompra: null,
  empaqueCompraSimbolo: null,
};

function mockInventario(estado: string): void {
  prismaMock.inventario.findUnique.mockResolvedValue({
    id: 45,
    sucursalId: 1,
    estado,
    // CONGELADO al abrir el inventario (ver schema.prisma). `Decimal` de
    // Prisma, por eso el `toNumber`.
    umbralMediaUnidadPaquete: { toNumber: () => 0.5 },
  });
}

const QUERY_DEFECTO = { filtro: 'todos' as const, desplazamiento: 0, limite: 50 };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.catalogoItem.findMany.mockResolvedValue([CERVEZA]);
  prismaMock.hojaConteo.findMany.mockResolvedValue([]); // nadie la conto: veredicto sin_contar, no afecta esEmpresa
});

describe('matriz: la clasificacion del Auditor se ve, no solo la de Dynamics', () => {
  it('ANTES de liquidar (conteo_cerrado), con la cerveza clasificada como empresa: aparece como empresa', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
  });

  it('ANTES de liquidar, sin clasificar: sigue como la trae Dynamics (empleado)', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(false);
  });

  it('DESPUES de liquidar (liquidado): lee lo CONGELADO en DiferenciaItem, no la clasificacion vigente', async () => {
    mockInventario('liquidado');
    prismaMock.diferenciaItem.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
    expect(prismaMock.clasificacionProducto.findMany).not.toHaveBeenCalled();
  });

  it('lacrado: mismo regimen congelado', async () => {
    mockInventario('lacrado');
    prismaMock.diferenciaItem.findMany.mockResolvedValue([{ codigo: 'CERVEZA', esEmpresa: true }]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; esEmpresa: boolean }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.esEmpresa).toBe(true);
  });
});

/**
 * EL ROTULO DE LA HOJA, agregado el 2026-09-22 para que el Auditor pueda
 * filtrar la matriz por hoja (pedido del usuario mirando la pantalla).
 *
 * La regla no es "la hoja donde se conto" sino LA DE LA RONDA 1, y por eso se
 * testea: la ronda 1 es la unica que cubre el catalogo entero -- las de
 * reconteo se arman por diferencia. Si mandara la ultima, un item que cuadro
 * en la primera pasada y otro que llego a la tercera se mostrarian con hojas
 * de rondas distintas, y "Hoja 003" querria decir dos cosas en la misma lista.
 */
describe('matriz: de que hoja dice que es cada item', () => {
  const productoEnHoja = (id: number, sueltas: number) => ({
    id,
    codigo: 'CERVEZA',
    descripcion: 'Cerveza 620ml',
    empaques: [],
    conteos: [{ sueltas, empaques: [] }],
  });

  it('manda la hoja de la RONDA 1, aunque el item se haya recontado en otra', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
    // LA DE RECONTEO VA SEGUNDA A PROPOSITO, y es lo que hace que este test
    // sirva: si la regla fuera "gana la ultima que se recorre" -- o sea, sin
    // la guarda de `numeroConteo === 1` -- la hoja saldria '007' y esto
    // fallaria. Con la de reconteo primero, las dos implementaciones dan
    // '003' y el test no distinguiria nada.
    prismaMock.hojaConteo.findMany.mockResolvedValue([
      { numeroConteo: 1, numero: '003', zona: 'LICOR - CERVEZAS', productos: [productoEnHoja(90, 20)] },
      { numeroConteo: 2, numero: '007', zona: 'RECONTEO', productos: [productoEnHoja(91, 18)] },
    ]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; hoja: string }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.hoja).toBe('003');
  });

  it('viaja VACIA cuando ninguna hoja finalizada incluye al item: no se inventa un numero', async () => {
    mockInventario('conteo_cerrado');
    prismaMock.clasificacionProducto.findMany.mockResolvedValue([]);
    prismaMock.hojaConteo.findMany.mockResolvedValue([]);

    const r = (await matriz(AUDITOR, 45, QUERY_DEFECTO)) as { matriz: Array<{ codigo: string; hoja: string }> };

    expect(r.matriz.find((i) => i.codigo === 'CERVEZA')?.hoja).toBe('');
  });
});
