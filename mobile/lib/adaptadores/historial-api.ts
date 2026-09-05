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
 *   GET /api/historial/inventarios/:id/lacrado/verificacion
 *       → VerificacionDto — verificado contra historial.service.ts#verificarSello
 *       y historial.controller.ts (devuelve el DTO tal cual, sin envoltorio).
 *       409 si el inventario todavía no está lacrado (`Conflicto` del backend).
 *   GET /api/historial/inventarios/:id/diferencias[?limite=&desplazamiento=&tipo=&resueltoEnConteo=]
 *       → { total, limite, desplazamiento, diferencias: DiferenciaDto[] } —
 *       verificado contra historial.service.ts#listarDiferencias.
 *   GET /api/historial/inventarios/:id/liquidacion
 *       → LiquidacionDto — verificado contra historial.service.ts#obtenerLiquidacion.
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
 * Lo mismo aplica a `verificarSello`, con un motivo todavía más fuerte: un
 * mock que responda "intacto" sin haber recalculado nada no sería un dato de
 * demo inocuo, sería fabricar la PROMESA misma que este endpoint existe para
 * sostener. Sin backend, no hay verificación — no una verificación falsa.
 *
 * TRES TRADUCCIONES QUE HACE ESTE ARCHIVO (que es para lo que existe un adaptador):
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
 *
 * 3. `seccionesAlteradas` llega como las claves técnicas del contenido
 *    canónico (`resultado`, `diferencias`, `liquidaciones`, `aprobaciones`,
 *    más metadata como `sucursalId`/`periodoAnio`/`snapshotItems`/etc — ver
 *    historial.lacrado.ts#armarContenidoLacrado). Se traducen a
 *    `SeccionSellada`: `liquidaciones` → `planilla` (es la clave técnica de
 *    lo que el cliente llama "la planilla"), y toda clave de metadata que no
 *    es una de las secciones nombradas se agrupa bajo `datosDelInventario`
 *    — nadie necesita leer "cambió periodoMes", necesita saber que cambió
 *    algo del encabezado del inventario. `Array.from(new Set(...))` dedupe:
 *    si cambian dos claves de metadata, `datosDelInventario` aparece una
 *    sola vez.
 *
 * 4. `diferencias` reordena lo que trae el backend. El servidor pagina
 *    ordenado por UNIDADES (`diferencia` asc, ver listarDiferencias) porque
 *    esa es la pregunta de la pantalla de Auditoría en curso ("cuántas
 *    unidades faltan"). Acá el criterio del histórico es otro -- cuánta
 *    PLATA movió cada ítem -- así que el adaptador reordena por
 *    `Math.abs(montoDiferencia)` descendente; los sin precio (`null`) se
 *    tratan como 0 y quedan al final, porque no mueven nada cuantificable.
 */

import type {
  DetalleInventarioHistorico,
  DiferenciaHistorica,
  EstadoInventario,
  FiltroHistorial,
  InventarioHistorico,
  LiquidacionColaboradorHistorica,
  LiquidacionInventario,
  PaginaHistorial,
  RepositorioHistorial,
  ResultadoInventario,
  ResumenLiquidacion,
  SeccionSellada,
  VerificacionSello,
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

interface VerificacionDto {
  inventarioId: number;
  folio: string;
  lacradoEn: string;
  verificadoEn: string;
  intacto: boolean;
  hashGuardado: string;
  hashRecalculado: string;
  /** Claves técnicas del contenido canónico — ver la traducción 3 de la cabecera. */
  seccionesAlteradas: string[];
  versionDistinta: boolean;
}

/** Ver la traducción 3 de la cabecera. */
const NOMBRE_DE_SECCION: Record<string, SeccionSellada> = {
  resultado: 'resultado',
  diferencias: 'diferencias',
  liquidaciones: 'planilla',
  aprobaciones: 'aprobaciones',
};

function aSeccionesAlteradas(claves: string[]): SeccionSellada[] {
  return Array.from(new Set(claves.map((clave) => NOMBRE_DE_SECCION[clave] ?? 'datosDelInventario')));
}

interface DiferenciaDto {
  codigo: string;
  descripcion: string;
  stockSistema: number;
  conteoFinal: number;
  diferencia: number;
  tipo: 'faltante' | 'sobrante';
  resueltoEnConteo: number;
  precioUnitario: number | null;
  montoDiferencia: number | null;
}

/** El máximo que acepta el endpoint (historial.schema.ts#listarDiferenciasQuerySchema). */
const MAXIMO_DIFERENCIAS = 500;

/** Ver la traducción 4 de la cabecera: orden por plata, no por unidades; sin precio va al final. */
function aDiferencias(dtos: DiferenciaDto[]): DiferenciaHistorica[] {
  return [...dtos].sort((a, b) => Math.abs(b.montoDiferencia ?? 0) - Math.abs(a.montoDiferencia ?? 0));
}

interface LiquidacionColaboradorDto {
  colaboradorId: number;
  nombre: string;
  nombreActual: string;
  dni: string;
  rol: LiquidacionColaboradorHistorica['rol'];
  asistio: boolean;
  cuotaBase: number;
  multaInasistencia: number;
  bonoAsistencia: number;
  totalDescuento: number;
}

interface LiquidacionDto {
  inventarioId: number;
  sucursal: { id: number; nombre: string };
  periodo: string;
  resumen: ResumenLiquidacion | null;
  asistenciaSinRegistrar: boolean;
  ajustesSinRegistrar: boolean;
  planilla: LiquidacionColaboradorDto[];
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

  async verificarSello(inventarioId): Promise<VerificacionSello> {
    const dto = await pedir<VerificacionDto>(`${BASE}/${inventarioId}/lacrado/verificacion`);
    return {
      inventarioId: dto.inventarioId,
      folio: dto.folio,
      lacradoEn: dto.lacradoEn,
      verificadoEn: dto.verificadoEn,
      intacto: dto.intacto,
      hashGuardado: dto.hashGuardado,
      hashRecalculado: dto.hashRecalculado,
      seccionesAlteradas: aSeccionesAlteradas(dto.seccionesAlteradas),
      versionDistinta: dto.versionDistinta,
    };
  },

  async diferencias(inventarioId): Promise<DiferenciaHistorica[]> {
    const dto = await pedir<{ diferencias: DiferenciaDto[] }>(`${BASE}/${inventarioId}/diferencias?limite=${MAXIMO_DIFERENCIAS}`);
    return aDiferencias(dto.diferencias);
  },

  async liquidacion(inventarioId): Promise<LiquidacionInventario> {
    const dto = await pedir<LiquidacionDto>(`${BASE}/${inventarioId}/liquidacion`);
    return {
      inventarioId: dto.inventarioId,
      periodo: dto.periodo,
      resumen: dto.resumen,
      asistenciaSinRegistrar: dto.asistenciaSinRegistrar,
      ajustesSinRegistrar: dto.ajustesSinRegistrar,
      planilla: dto.planilla,
    };
  },
};
