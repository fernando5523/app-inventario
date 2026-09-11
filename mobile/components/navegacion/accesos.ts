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
    // Acceso y NO tab, a propósito: un tab se gana el lugar si se visita
    // varias veces por jornada, y el histórico se mira de vez en cuando —
    // al cerrar el mes, o cuando alguien pregunta por un período viejo.
    // Además el Administrador ya tiene 4 tabs; un quinto los deja tan
    // angostos que "Historial" no entra sin cortarse.
    { titulo: 'Historial de inventarios', sub: 'Todos los períodos y sus cierres', ruta: '/administrador/historial' },
    // Mismo motivo que "Historial": cambiar el PIN propio no es algo que
    // se haga todos los días, no se gana un tab. Presente en los 4 roles
    // por igual — no es un dato de gestión, es de cualquiera con sesión.
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/administrador/mi-cuenta' },
  ],
  coordinador: [
    { titulo: 'Gestión de hojas', sub: 'Crear y asignar las hojas de conteo', ruta: '/coordinador/hojas' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las 3 pasadas', ruta: '/coordinador/ciclo' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/coordinador/mi-cuenta' },
  ],
  conteo: [
    { titulo: 'Mis hojas', sub: 'Tu bloque de hojas asignadas', ruta: '/conteo/mis-hojas' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/conteo/mi-cuenta' },
  ],
  auditor: [
    { titulo: 'Panel de auditoría', sub: 'Comparar los 3 conteos contra el ERP', ruta: '/auditor/auditoria' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las 3 pasadas', ruta: '/auditor/ciclo' },
    // Decisión del cliente (2026-09-11): la liquidación pasó del Coordinador
    // al Auditor. Va ANTES del lacrado porque es el orden del cierre: se
    // liquida primero y se lacra después (el lacrado exige `liquidado`).
    { titulo: 'Liquidación y nómina', sub: 'Cierre de fin de mes', ruta: '/auditor/liquidacion' },
    { titulo: 'Aprobación y lacrado', sub: 'Firma y cierre del inventario auditado', ruta: '/auditor/lacrado' },
    { titulo: 'Usuarios de mi sucursal', sub: 'Crear y habilitar cuentas', ruta: '/auditor/usuarios' },
    // Excepciones a la clasificación de Dynamics, por código (las cervezas:
    // van del empleado en D365 pero las asume la empresa). Se evalúa al
    // liquidar, por eso es del Auditor y vive cerca del cierre.
    { titulo: 'Clasificación de productos', sub: 'Marcar los que asume la empresa, no el empleado', ruta: '/auditor/clasificacion' },
    { titulo: 'Historial de inventarios', sub: 'Cierres de mi sucursal, período por período', ruta: '/auditor/historial' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/auditor/mi-cuenta' },
  ],
};
