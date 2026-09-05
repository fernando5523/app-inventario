/**
 * Adaptador HTTP de RepositorioHistorial.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO — VERIFICADO contra el servidor vivo, no contra el README
 * ---------------------------------------------------------------------------
 * Las dos rutas se llamaron con curl contra http://localhost:3000 el
 * 2026-09-04, con la base sembrada (`npm run prisma:seed-historial`), y la
 * forma de abajo es la que devolvió de verdad:
 *
 *   GET /api/historial/inventarios[?sucursalId=&estado=&limite=&desplazamiento=]
 *       → { total, limite, desplazamiento, inventarios: InventarioDto[] }
 *   GET /api/historial/inventarios/:id
 *       → DetalleDto
 *
 * Todo el router va detrás de `requiereSesion` + `requiereRol('administrador',
 * 'auditor')`. Un Coordinador o un Contador reciben 403 — y está bien que
 * así sea: es la regla de conteo ciego, ver el comentario del puerto.
 *
 * NO hay adaptador en memoria de este puerto, y es deliberado: el histórico
 * es el registro de lo que YA pasó. Un mock que invente inventarios cerrados
 * es exactamente el dato que nadie debería poder fabricar. Sin backend, la
 * pantalla dice que no pudo cargar; no muestra un histórico de mentira.
 *
 * DOS TRADUCCIONES QUE HACE ESTE ARCHIVO (que es para lo que existe un adaptador):
 *
 * 1. `lacrado` en el LISTADO viene como objeto completo o null, pero la
 *    lista solo necesita saber SI hay sello y cuál es el folio. Se aplana a
 *    `folio: string | null` en vez de arrastrar el hash y el registro ERP a
 *    una pantalla que no los muestra.
 *
 * 2. `montoFaltanteNeto` y `cuotaBase` llegan ausentes (no null) cuando el
 *    inventario no está liquidado todavía. Se normalizan a `null` explícito:
 *    `undefined` obligaría a cada pantalla a distinguir "no vino" de "vino
 *    vacío", y son lo mismo — todavía no se calculó. Lo que NO se hace es
 *    convertirlos a 0: "cero de faltante" y "todavía no se sabe" son cosas
 *    distintas, y confundirlas en un inventario es grave.
 */

import type {
  DetalleInventarioHistorico,
  EstadoInventario,
  FiltroHistorial,
  InventarioHistorico,
  PaginaHistorial,
  RepositorioHistorial,
  ResultadoInventario,
} from '../puertos/repositorios';
import { pedir } from './_http';

const BASE = '/api/historial/inventarios';

interface ResultadoDto {
  itemsTotales: number;
  itemsConDiferencia: number;
  itemsCuadrados: number;
  porcentajeCuadrado: number;
  montoFaltanteBruto: number;
  montoFaltanteNeto?: number | null;
  cuotaBase?: number | null;
  itemsSegundoConteo?: number;
  itemsTercerConteo?: number;
  unidadesFaltantes?: number;
  unidadesSobrantes?: number;
  asistenciaSinRegistrar?: boolean;
  ajustesSinRegistrar?: boolean;
}

interface InventarioDto {
  id: number;
  sucursalId: number;
  sucursalNombre: string;
  estado: EstadoInventario;
  periodo: string;
  periodoAnio: number;
  periodoMes: number;
  tamanoHoja: number | null;
  snapshotItems: number;
  cerradoEn: string | null;
  resultado: ResultadoDto | null;
  aprobaciones: number;
  lacrado: { folio: string } | null;
}

interface DetalleDto extends Omit<InventarioDto, 'sucursalId' | 'sucursalNombre' | 'aprobaciones' | 'lacrado'> {
  sucursal: { id: number; nombre: string };
  cerradoPor: { id: number; nombre: string } | null;
  hojas: DetalleInventarioHistorico['hojas'];
  diferencias: number;
  liquidaciones: number;
  aprobaciones: DetalleInventarioHistorico['aprobaciones'];
  lacrado: DetalleInventarioHistorico['lacrado'];
}

/** Ver la traducción 2 de la cabecera: ausente y null son lo mismo, cero NO. */
function aResultado(dto: ResultadoDto | null): ResultadoInventario | null {
  if (!dto) return null;
  return {
    ...dto,
    montoFaltanteNeto: dto.montoFaltanteNeto ?? null,
    cuotaBase: dto.cuotaBase ?? null,
  };
}

function aInventario(dto: InventarioDto): InventarioHistorico {
  return {
    id: dto.id,
    sucursalId: dto.sucursalId,
    sucursalNombre: dto.sucursalNombre,
    estado: dto.estado,
    periodo: dto.periodo,
    periodoAnio: dto.periodoAnio,
    periodoMes: dto.periodoMes,
    tamanoHoja: dto.tamanoHoja,
    snapshotItems: dto.snapshotItems,
    cerradoEn: dto.cerradoEn,
    resultado: aResultado(dto.resultado),
    aprobaciones: dto.aprobaciones,
    folio: dto.lacrado?.folio ?? null,
  };
}

function consulta(filtro?: FiltroHistorial): string {
  if (!filtro) return '';
  const partes: string[] = [];
  if (filtro.sucursalId !== undefined) partes.push(`sucursalId=${filtro.sucursalId}`);
  if (filtro.estado !== undefined) partes.push(`estado=${filtro.estado}`);
  if (filtro.limite !== undefined) partes.push(`limite=${filtro.limite}`);
  if (filtro.desplazamiento !== undefined) partes.push(`desplazamiento=${filtro.desplazamiento}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

export const historialApi: RepositorioHistorial = {
  async listar(filtro) {
    const dto = await pedir<{ total: number; inventarios: InventarioDto[] }>(`${BASE}${consulta(filtro)}`);
    return { total: dto.total, inventarios: dto.inventarios.map(aInventario) };
  },

  async detalle(inventarioId) {
    const dto = await pedir<DetalleDto>(`${BASE}/${inventarioId}`);
    return {
      id: dto.id,
      // El detalle manda `sucursal: {id, nombre}` y el listado manda dos
      // campos planos. Se unifica a la forma del listado: una sola manera
      // de leer la sucursal en toda la app.
      sucursalId: dto.sucursal.id,
      sucursalNombre: dto.sucursal.nombre,
      estado: dto.estado,
      periodo: dto.periodo,
      periodoAnio: dto.periodoAnio,
      periodoMes: dto.periodoMes,
      tamanoHoja: dto.tamanoHoja,
      snapshotItems: dto.snapshotItems,
      cerradoEn: dto.cerradoEn,
      cerradoPor: dto.cerradoPor,
      resultado: aResultado(dto.resultado),
      hojas: Array.isArray(dto.hojas) ? dto.hojas : [],
      diferencias: dto.diferencias,
      liquidaciones: dto.liquidaciones,
      // `Array.isArray`, no `?? []`: en el LISTADO `aprobaciones` es un
      // NÚMERO (cuántas firmas hay) y en el DETALLE es el array con las
      // firmas. Dos formas para el mismo nombre en el mismo módulo es una
      // trampa esperando: si alguna vez llegara el número por acá, un
      // `?? []` lo dejaría pasar y la pantalla haría `.map()` sobre un
      // number. Mejor quedarse sin firmas que reventar el histórico.
      aprobaciones: Array.isArray(dto.aprobaciones) ? dto.aprobaciones : [],
      lacrado: dto.lacrado,
    };
  },
};
