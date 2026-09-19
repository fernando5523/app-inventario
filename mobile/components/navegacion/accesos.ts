/**
 * Accesos del home, por rol — incluye los que SÍ son tabs (para poder
 * abrirlos también como tarjeta) y los que NO llegaron a tab por ser
 * cierres de una vez al mes (Liquidación, Lacrado). Las 8 pantallas ya
 * están portadas, así que hoy todos traen `ruta`.
 *
 * ===========================================================================
 * ESTE MAPA YA NO ES LA FUENTE DE VERDAD, PERO NO SE BORRA: ES EL RESPALDO
 * ===========================================================================
 * Desde que el Administrador maneja los accesos por rol (pedido del cliente:
 * *"que estos pueden ser manejados por el administrador por medio de roles al
 * igual que los menús ... no está hardcodeado"*), la lista que manda la trae
 * el backend — `GET /api/navegacion/mia`, ver `lib/adaptadores/navegacion-api.ts`.
 *
 * Este archivo queda como **el respaldo para cuando esa configuración no
 * llega**: sin señal, backend caído, respuesta rara. Y no es una precaución
 * teórica — estas tiendas tienen WiFi mala, y un home en blanco es una
 * persona parada en la góndola sin poder contar.
 *
 * NO LO BORRES POR "CÓDIGO MUERTO". Hay un test del backend
 * (`navegacion.espejo.test.ts`) que lee este archivo como texto y falla si su
 * contenido o su orden se separan del catálogo del servidor — justamente para
 * que el respaldo siga siendo el mismo home que se ve con señal.
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
    // La pantalla que hace que esta lista deje de estar hardcodeada. Va JUNTO
    // a "Configuración" porque es de la misma familia -- parámetros del
    // sistema -- y no al final, para que "Mi cuenta" siga siendo el último en
    // los cuatro roles.
    { titulo: 'Accesos y menús', sub: 'Qué ve cada rol en el inicio y en la barra', ruta: '/administrador/navegacion' },
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
    // PRIMERO, y no por orden alfabético: es lo primero que pasa en la
    // jornada -- la gente llega y se le marca la entrada. Y es acceso y no
    // tab porque el Coordinador ya tiene cuatro (ver tabs.ts): un quinto los
    // deja tan angostos que "Armar hojas" no entra sin cortarse.
    { titulo: 'Asistencia del inventario', sub: 'Marcar la entrada de cada día', ruta: '/coordinador/asistencia' },
    { titulo: 'Gestión de hojas', sub: 'Crear y asignar las hojas de conteo', ruta: '/coordinador/hojas' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las pasadas', ruta: '/coordinador/ciclo' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/coordinador/mi-cuenta' },
  ],
  conteo: [
    { titulo: 'Mis hojas', sub: 'Tu bloque de hojas asignadas', ruta: '/conteo/mis-hojas' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/conteo/mi-cuenta' },
  ],
  auditor: [
    { titulo: 'Panel de auditoría', sub: 'Comparar los conteos contra el ERP', ruta: '/auditor/auditoria' },
    { titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias, y abrir otro conteo', ruta: '/auditor/ciclo' },
    // Acceso y NO tab: se usa una vez por inventario, al cerrar. Va JUSTO
    // después del ciclo porque es donde se decide entrar (el ajuste se inicia
    // desde ahí) y antes de la liquidación, que es el orden real del cierre:
    // se ajusta, se liquida, se lacra.
    // ANTES del ajuste, y no es orden alfabético: es el orden del cierre. El
    // Auditor corrige lo contado mientras las rondas siguen abiertas, y recién
    // cuando arranca el ajuste esa vía se le cierra (la pantalla lo explica).
    { titulo: 'Corregir lo contado', sub: 'Arreglar un conteo cargado, viendo el stock', ruta: '/auditor/corregir' },
    { titulo: 'Ajuste final del conteo', sub: 'Fijar los valores definitivos contra el stock', ruta: '/auditor/ajuste' },
    // Decisión del cliente (2026-09-11): la liquidación pasó del Coordinador
    // al Auditor. Va ANTES del lacrado porque es el orden del cierre: se
    // liquida primero y se lacra después (el lacrado exige `liquidado`).
    { titulo: 'Liquidación y nómina', sub: 'Cierre de fin de mes', ruta: '/auditor/liquidacion' },
    { titulo: 'Aprobación y lacrado', sub: 'Firma y cierre del inventario auditado', ruta: '/auditor/lacrado' },
    { titulo: 'Usuarios de mi sucursal', sub: 'Crear y habilitar cuentas', ruta: '/auditor/usuarios' },
    // Excepciones a la clasificación de Dynamics, por código (las cervezas:
    // van del empleado en D365 pero las asume la empresa). Se evalúa al
    // liquidar, por eso es del Auditor y vive cerca del cierre.
    // El subtítulo DECÍA "los que asume la empresa, no el empleado", que era el
    // booleano viejo: desde las tres vías la pantalla también decide si un
    // faltante se mide por paquete. Un acceso que promete menos de lo que hay
    // adentro es una función que nadie encuentra.
    { titulo: 'Clasificación de productos', sub: 'Empresa, paquete o unidad: cómo se trata cada faltante', ruta: '/auditor/clasificacion' },
    { titulo: 'Historial de inventarios', sub: 'Cierres de mi sucursal, período por período', ruta: '/auditor/historial' },
    { titulo: 'Mi cuenta', sub: 'Cambiar tu PIN', ruta: '/auditor/mi-cuenta' },
  ],
};
