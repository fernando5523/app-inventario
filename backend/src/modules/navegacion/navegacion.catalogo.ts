/**
 * EL CATALOGO DE ACCESOS Y TABS, portado del movil.
 *
 * ---------------------------------------------------------------------------
 * QUE ES ESTO Y POR QUE VIVE EN EL BACKEND
 * ---------------------------------------------------------------------------
 * Hasta este cambio, las tarjetas del home y la barra de abajo estaban
 * HARDCODEADAS en `mobile/components/navegacion/{accesos,tabs}.ts`. El cliente
 * pidio poder manejarlas por rol desde la pantalla del Administrador --
 * "dejar los roles que ya tenemos y sus accesos ... no esta hardcodeado".
 *
 * Este archivo es la mitad estable de eso: QUE elementos existen y como se
 * llaman. Lo que el Administrador cambia -- orden y prendido/apagado -- vive
 * en la base (`ConfiguracionNavegacion`), no acá.
 *
 * LA SIEMBRA ES ESTE ORDEN, TAL CUAL. El dia 1 despues del cambio los cuatro
 * roles ven exactamente lo mismo que veian antes. Si alguien reordena este
 * archivo sin migrar la base, la siembra de una instalacion nueva deja de
 * coincidir con la de una vieja.
 *
 * ---------------------------------------------------------------------------
 * ESTO ES PRESENTACION, NO AUTORIZACION
 * ---------------------------------------------------------------------------
 * Esconder una tarjeta es una comodidad; mostrarla NO es un permiso. Quien
 * decide que puede hacer cada rol sigue siendo el backend: el `requiereRol`
 * de cada router y los `*.permisos.ts`. Apagar un acceso no le saca a nadie
 * un permiso, y prenderlo no se lo da.
 *
 * ---------------------------------------------------------------------------
 * LOS COMENTARIOS DE `accesos.ts` VIAJAN COMO `nota`
 * ---------------------------------------------------------------------------
 * El archivo del movil explica POR QUE cada acceso esta donde esta ("va ANTES
 * del ajuste porque es el orden del cierre", "un tab se gana el lugar si se
 * visita varias veces por jornada"). Esa es exactamente la informacion que
 * necesita el Administrador ANTES de mover algo, asi que no se queda en un
 * comentario: viaja en `nota` y la pantalla la muestra.
 */

import type { Rol } from '../../shared/tipos';

/** Una tarjeta del home. `ruta` es su clave estable: identifica el elemento. */
export interface AccesoCatalogo {
  /** La ruta del movil (`/auditor/auditoria`). ES la clave: no se renombra. */
  ruta: string;
  titulo: string;
  sub: string;
  /** Por que esta donde esta. Se le muestra al Administrador que va a reordenar. */
  nota?: string;
}

/** Un tab de la barra de abajo. `name` es su clave estable. */
export interface TabCatalogo {
  /**
   * Tiene que coincidir EXACTO con el nombre del archivo de ruta dentro de
   * `app/<rol>/` (sin extension): es lo que usa expo-router para resolver la
   * pantalla. El icono NO viaja desde acá -- es un componente de
   * lucide-react-native y vive en el mapa compilado del movil, que lo busca
   * por este `name`.
   */
  name: string;
  etiqueta: string;
  nota?: string;
}

/**
 * CUANTOS TABS ENTRAN. Cuatro, y el numero tiene una razon fisica que la
 * pantalla del Administrador le tiene que explicar a quien intente un quinto:
 * con cinco quedan tan angostos que "Armar hojas" no entra sin cortarse.
 * Viene de `mobile/components/navegacion/tabs.ts` y de TabBar.tsx
 * (`numberOfLines={1}`).
 */
export const MAXIMO_TABS = 4;

export const ACCESOS_CATALOGO: Record<Rol, AccesoCatalogo[]> = {
  administrador: [
    { ruta: '/administrador/usuarios', titulo: 'Usuarios', sub: 'Cuentas de todas las sucursales' },
    { ruta: '/administrador/tiendas', titulo: 'Tiendas', sub: 'Alta y estado de las sucursales' },
    { ruta: '/administrador/config', titulo: 'Configuración', sub: 'Parámetros del sistema' },
    {
      ruta: '/administrador/navegacion',
      titulo: 'Accesos y menús',
      sub: 'Qué ve cada rol en el inicio y en la barra',
      nota:
        'La pantalla que hace que esta lista deje de estar hardcodeada. Va junto a "Configuración" porque es de la ' +
        'misma familia, y no al final, para que "Mi cuenta" siga siendo el último en los cuatro roles. ' +
        'Si la apagás, la única forma de volver a prenderla es desde la base.',
    },
    {
      ruta: '/administrador/historial',
      titulo: 'Historial de inventarios',
      sub: 'Todos los períodos y sus cierres',
      nota:
        'Acceso y NO tab, a propósito: un tab se gana el lugar si se visita varias veces por jornada, ' +
        'y el histórico se mira de vez en cuando — al cerrar el mes, o cuando alguien pregunta por un ' +
        'período viejo. Además el Administrador ya tiene 4 tabs.',
    },
    {
      ruta: '/administrador/mi-cuenta',
      titulo: 'Mi cuenta',
      sub: 'Cambiar tu PIN',
      nota:
        'Mismo motivo que "Historial": cambiar el PIN propio no se hace todos los días, no se gana un ' +
        'tab. Presente en los 4 roles por igual — no es un dato de gestión, es de cualquiera con sesión.',
    },
  ],
  coordinador: [
    {
      ruta: '/coordinador/asistencia',
      titulo: 'Asistencia del inventario',
      sub: 'Marcar la entrada de cada día',
      nota:
        'PRIMERO, y no por orden alfabético: es lo primero que pasa en la jornada — la gente llega y se ' +
        'le marca la entrada. Es acceso y no tab porque el Coordinador ya tiene cuatro: un quinto los ' +
        'deja tan angostos que "Armar hojas" no entra sin cortarse.',
    },
    { ruta: '/coordinador/hojas', titulo: 'Gestión de hojas', sub: 'Crear y asignar las hojas de conteo' },
    { ruta: '/coordinador/ciclo', titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias entre las pasadas' },
    { ruta: '/coordinador/mi-cuenta', titulo: 'Mi cuenta', sub: 'Cambiar tu PIN' },
  ],
  conteo: [
    { ruta: '/conteo/mis-hojas', titulo: 'Mis hojas', sub: 'Tu bloque de hojas asignadas' },
    { ruta: '/conteo/mi-cuenta', titulo: 'Mi cuenta', sub: 'Cambiar tu PIN' },
  ],
  auditor: [
    { ruta: '/auditor/auditoria', titulo: 'Panel de auditoría', sub: 'Comparar los conteos contra el ERP' },
    { ruta: '/auditor/ciclo', titulo: 'Ciclo de conteos', sub: 'Embudo de discrepancias, y abrir otro conteo' },
    {
      ruta: '/auditor/corregir',
      titulo: 'Corregir lo contado',
      sub: 'Arreglar un conteo cargado, viendo el stock',
      nota:
        'ANTES del ajuste, y no es orden alfabético: es el orden del cierre. El Auditor corrige lo ' +
        'contado mientras las rondas siguen abiertas, y recién cuando arranca el ajuste esa vía se le ' +
        'cierra.',
    },
    {
      ruta: '/auditor/ajuste',
      titulo: 'Ajuste final del conteo',
      sub: 'Fijar los valores definitivos contra el stock',
      nota:
        'Acceso y NO tab: se usa una vez por inventario, al cerrar. Va justo después del ciclo porque ' +
        'es donde se decide entrar, y antes de la liquidación: se ajusta, se liquida, se lacra.',
    },
    {
      ruta: '/auditor/liquidacion',
      titulo: 'Liquidación y nómina',
      sub: 'Cierre de fin de mes',
      nota:
        'Decisión del cliente (2026-09-11): la liquidación pasó del Coordinador al Auditor. Va ANTES ' +
        'del lacrado porque es el orden del cierre — el lacrado exige que el inventario esté liquidado.',
    },
    { ruta: '/auditor/lacrado', titulo: 'Aprobación y lacrado', sub: 'Firma y cierre del inventario auditado' },
    { ruta: '/auditor/usuarios', titulo: 'Usuarios de mi sucursal', sub: 'Crear y habilitar cuentas' },
    {
      ruta: '/auditor/clasificacion',
      titulo: 'Clasificación de productos',
      sub: 'Empresa, paquete o unidad: cómo se trata cada faltante',
      nota:
        'Excepciones a la clasificación de Dynamics, por código (las cervezas: van del empleado en D365 ' +
        'pero las asume la empresa). Se evalúa al liquidar, por eso es del Auditor y vive cerca del cierre.',
    },
    { ruta: '/auditor/historial', titulo: 'Historial de inventarios', sub: 'Cierres de mi sucursal, período por período' },
    { ruta: '/auditor/mi-cuenta', titulo: 'Mi cuenta', sub: 'Cambiar tu PIN' },
  ],
};

export const TABS_CATALOGO: Record<Rol, TabCatalogo[]> = {
  administrador: [
    { name: 'index', etiqueta: 'Inicio' },
    { name: 'usuarios', etiqueta: 'Usuarios' },
    { name: 'tiendas', etiqueta: 'Tiendas' },
    { name: 'config', etiqueta: 'Config' },
  ],
  coordinador: [
    { name: 'index', etiqueta: 'Inicio' },
    { name: 'hojas', etiqueta: 'Hojas' },
    {
      name: 'armar',
      etiqueta: 'Armar hojas',
      nota:
        'Pedido del cliente (2026-09-07): el armado (catálogo/crear/asignar) se va a su propia entrada, ' +
        'separado de "Hojas de esta ronda". "Armar hojas" y no "Configurar": dice la ACCIÓN de dominio, ' +
        'en vez de un genérico que en Administrador ya significa otra cosa.',
    },
    { name: 'ciclo', etiqueta: 'Ciclo' },
  ],
  conteo: [
    { name: 'index', etiqueta: 'Inicio' },
    { name: 'mis-hojas', etiqueta: 'Mis hojas' },
    { name: 'contar', etiqueta: 'Contar' },
  ],
  auditor: [
    { name: 'index', etiqueta: 'Inicio' },
    { name: 'auditoria', etiqueta: 'Auditoría' },
    { name: 'ciclo', etiqueta: 'Ciclo' },
    {
      name: 'usuarios',
      etiqueta: 'Usuarios',
      nota:
        'Pedido explícito del cliente: el Auditor también gestiona cuentas de su propia sucursal — ' +
        'comparte pantalla con el Administrador, no es una copia.',
    },
  ],
};
