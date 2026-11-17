/**
 * Quien aprueba entra con su cuenta de Entra ID, no con el PIN del inventario:
 * es otra persona (Elizabeth, de oficina), otra pantalla y otra autorizacion.
 * Por eso este modulo tiene su propio middleware y no usa `requiereSesion`.
 *
 * Deja en `req.aprobador` la identidad que viaja a Dynamics como "Decidido
 * por": la cuenta y el nombre salen del token, nunca del cuerpo del pedido.
 */

import type { NextFunction, Request, Response } from 'express';

import { NoAutorizado, Prohibido } from '../../shared/errores';
import { leerConfigEntra } from './consumo-interno.config';
import { PREFIJO_TOKEN_DEV, verificarTokenDev } from './consumo-interno.dev';
import {
  TokenInvalido,
  crearProveedorDeClaves,
  cuentaDeClaims,
  esAprobador,
  verificarTokenEntra,
  type ObtenerClave,
} from './consumo-interno.entra';

export interface IdentidadAprobador {
  cuenta: string;
  nombre: string;
  origen: 'entra' | 'desarrollo';
}

export interface RequestAprobador extends Request {
  aprobador?: IdentidadAprobador;
}

const proveedores = new Map<string, ObtenerClave>();

function proveedorDelTenant(tenantId: string): ObtenerClave {
  let proveedor = proveedores.get(tenantId);
  if (!proveedor) {
    proveedor = crearProveedorDeClaves(tenantId);
    proveedores.set(tenantId, proveedor);
  }
  return proveedor;
}

/** La identidad del token, o el error HTTP que corresponde. Separada del middleware para probarla sin Express. */
export async function identificarAprobador(
  autorizacion: string | undefined,
  env: Record<string, string | undefined> = process.env,
  obtenerClave?: ObtenerClave,
): Promise<IdentidadAprobador> {
  const token = autorizacion?.startsWith('Bearer ') ? autorizacion.slice('Bearer '.length).trim() : '';
  if (token === '') throw new NoAutorizado('Ingresa con tu cuenta para ver las solicitudes.');

  if (token.startsWith(PREFIJO_TOKEN_DEV)) {
    const dev = verificarTokenDev(token, env);
    if (dev === null) throw new NoAutorizado('Tu sesion vencio. Ingresa de nuevo.');
    return { ...dev, origen: 'desarrollo' };
  }

  const config = leerConfigEntra(env);
  let claims;
  try {
    claims = await verificarTokenEntra(token, config, obtenerClave ?? proveedorDelTenant(config.tenantId));
  } catch (error) {
    if (error instanceof TokenInvalido) {
      console.warn(`[consumo-interno] token rechazado: ${error.message}`);
      throw new NoAutorizado('Tu sesion vencio. Ingresa de nuevo.');
    }
    throw error;
  }

  if (!esAprobador(claims, config)) {
    throw new Prohibido('Tu cuenta no esta habilitada para aprobar consumos internos. Pide acceso a sistemas.');
  }
  const cuenta = cuentaDeClaims(claims);
  return { cuenta, nombre: typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name.trim() : cuenta, origen: 'entra' };
}

export function requiereAprobador(req: RequestAprobador, _res: Response, next: NextFunction): void {
  identificarAprobador(req.headers.authorization)
    .then((identidad) => {
      req.aprobador = identidad;
      next();
    })
    .catch(next);
}
