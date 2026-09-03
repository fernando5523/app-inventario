/**
 * Accesos del home, por rol — incluye los que SÍ son tabs (para poder
 * abrirlos también como tarjeta) y los que NO llegaron a tab por ser
 * cierres de una vez al mes (Liquidación, Lacrado). Las 8 pantallas ya
 * están portadas, así que hoy todos traen `ruta`.
 */

import type { Rol } from '../../lib/dominio/tipos';

export interface DefinicionAcceso {
  titulo: string;
  sub: string;
  /** Opcional solo como cinturón de seguridad para un acceso agregado
   *  antes de portar su pantalla — ver InicioScreen.abrirAcceso. */
  ruta?: string;
}

export const ACCESOS_POR_ROL: Record<Rol, DefinicionAcceso[]> = {
  administrador: [
    { titulo: 'Usuarios', sub: 'Cuentas de todas las sucursales', ruta: '/administrador/usuarios' },
    { titulo: 'Tiendas', sub: 'Alta y estado de las sucursales', ruta: '/administrador/tiendas' },
    { titulo: 'Configuración', sub: 'Parámetros del sistema', ruta: '/administrador/config' },
  ],
  coordinador: [
    { titulo: 'Gestión de hojas', sub: 'Crear y asignar las hojas de conteo', ruta: '/coordinador/hojas' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las 3 pasadas', ruta: '/coordinador/ciclo' },
    { titulo: 'Liquidación y nómina', sub: 'Cierre de fin de mes', ruta: '/coordinador/liquidacion' },
  ],
  conteo: [{ titulo: 'Mis hojas', sub: 'Tu bloque de hojas asignadas', ruta: '/conteo/mis-hojas' }],
  auditor: [
    { titulo: 'Panel de auditoría', sub: 'Comparar los 3 conteos contra el ERP', ruta: '/auditor/auditoria' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las 3 pasadas', ruta: '/auditor/ciclo' },
    { titulo: 'Aprobación y lacrado', sub: 'Firma y cierre del inventario auditado', ruta: '/auditor/lacrado' },
    { titulo: 'Usuarios de mi sucursal', sub: 'Crear y habilitar cuentas', ruta: '/auditor/usuarios' },
  ],
};
