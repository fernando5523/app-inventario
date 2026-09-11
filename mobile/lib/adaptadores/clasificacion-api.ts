/**
 * Adaptador HTTP de RepositorioClasificacion (backend/src/modules/clasificacion,
 * commit ccf6052). Solo lo usa el Auditor; el backend responde 403 al resto.
 *
 * CONTRATO (verificado contra el service del backend):
 *   GET    /api/clasificacion[?q=&soloClasificados=true&limite=&desplazamiento=]
 *          → { total, limite, desplazamiento, productos: ProductoClasificableDto[] }
 *   PUT    /api/clasificacion/:codigo   body { esEmpresa, nota? } → ClasificacionDto
 *   DELETE /api/clasificacion/:codigo   → 204 (404 si no había clasificación)
 *
 * NO hay adaptador en memoria, igual que RepositorioHistorial: un mock que
 * invente clasificaciones fabricaría el dato que mueve la liquidación. Sin
 * backend, la pantalla dice que no pudo cargar; nunca muestra excepciones de
 * mentira.
 *
 * La forma que devuelve el backend ya calza con el puerto (se diseñó así): el
 * mapeo es casi identidad, pero se hace explícito -- normaliza `clasificacion`
 * a `null` y no deja pasar campos que el puerto no declara.
 */

import type {
  Clasificacion,
  DatosClasificar,
  FiltroClasificacion,
  PaginaClasificacion,
  ProductoClasificable,
  RepositorioClasificacion,
  ResponsableDynamics,
} from '../puertos/repositorios';
import { pedir, pedirSinCuerpo } from './_http';

const BASE = '/api/clasificacion';

interface ClasificacionDto {
  codigo: string;
  esEmpresa: boolean;
  nota: string | null;
  clasificadoPorId: number;
  clasificadoEn: string;
}

interface ProductoDto {
  codigo: string;
  descripcion: string;
  categoria: string | null;
  responsableDynamics: ResponsableDynamics;
  clasificacion: ClasificacionDto | null;
}

interface PaginaDto {
  total: number;
  limite: number;
  desplazamiento: number;
  productos: ProductoDto[];
}

function aClasificacion(dto: ClasificacionDto): Clasificacion {
  return {
    codigo: dto.codigo,
    esEmpresa: dto.esEmpresa,
    nota: dto.nota,
    clasificadoPorId: dto.clasificadoPorId,
    clasificadoEn: dto.clasificadoEn,
  };
}

function aProducto(dto: ProductoDto): ProductoClasificable {
  return {
    codigo: dto.codigo,
    descripcion: dto.descripcion,
    categoria: dto.categoria,
    responsableDynamics: dto.responsableDynamics,
    clasificacion: dto.clasificacion ? aClasificacion(dto.clasificacion) : null,
  };
}

function consulta(filtro?: FiltroClasificacion): string {
  if (!filtro) return '';
  const partes: string[] = [];
  if (filtro.q !== undefined) partes.push(`q=${encodeURIComponent(filtro.q)}`);
  // Solo cuando está PRENDIDO: el backend toma "ausente" como false, y mandar
  // `soloClasificados=false` sería ruido (su schema acepta 'true'|'false', no
  // hace falta el segundo).
  if (filtro.soloClasificados) partes.push('soloClasificados=true');
  if (filtro.limite !== undefined) partes.push(`limite=${filtro.limite}`);
  if (filtro.desplazamiento !== undefined) partes.push(`desplazamiento=${filtro.desplazamiento}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

export const clasificacionApi: RepositorioClasificacion = {
  async buscar(filtro): Promise<PaginaClasificacion> {
    const dto = await pedir<PaginaDto>(`${BASE}${consulta(filtro)}`);
    return {
      total: dto.total,
      limite: dto.limite,
      desplazamiento: dto.desplazamiento,
      productos: dto.productos.map(aProducto),
    };
  },

  async clasificar(codigo, datos: DatosClasificar): Promise<Clasificacion> {
    const dto = await pedir<ClasificacionDto>(`${BASE}/${encodeURIComponent(codigo)}`, {
      metodo: 'PUT',
      cuerpo: {
        esEmpresa: datos.esEmpresa,
        // La clave `nota` se OMITE cuando no vino: mandar `nota: undefined` no
        // aporta, y el backend la trata como opcional.
        ...(datos.nota !== undefined ? { nota: datos.nota } : {}),
      },
    });
    return aClasificacion(dto);
  },

  async desclasificar(codigo): Promise<void> {
    // 204 sin cuerpo.
    await pedirSinCuerpo(`${BASE}/${encodeURIComponent(codigo)}`, { metodo: 'DELETE' });
  },
};
