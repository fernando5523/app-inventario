/**
 * Quien ve el historico, quien puede firmar el cierre y en que estado se
 * puede hacer cada cosa. CERO Prisma aca -- misma razon que
 * usuarios.permisos.ts: son las reglas que sostienen el conteo ciego y el
 * control de dos personas, asi que tienen que poder testearse sin base de
 * datos (ver historial.permisos.test.ts).
 */

import { Conflicto, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado, Rol } from '../../shared/tipos';

/** Estados del inventario (prisma/schema.prisma#EstadoInventario). */
export type EstadoInventario = 'en_curso' | 'conteo_cerrado' | 'liquidado' | 'lacrado' | 'anulado';

/**
 * Quien lee el historico. `conteo` y `coordinador` NO estan, y no es una
 * omision: es la misma regla de conteo ciego que sostiene todo el sistema.
 * Un contador que ve el resultado del inventario anterior -- o el de la
 * hoja de al lado -- ya no esta contando a ciegas, esta confirmando un
 * numero que vio antes. Ellos ven lo suyo del inventario EN CURSO, nada mas.
 */
export const ROLES_CON_ACCESO_AL_HISTORICO: Rol[] = ['administrador', 'auditor'];

/**
 * Quien puede firmar el cierre del mes.
 *
 * PENDIENTE DE CONFIRMAR CON EL CLIENTE: las dos fuentes se contradicen. La
 * reunion nombra a Gilmer (auditor) y Michell, y la Decision del Cliente 1
 * de docs/pantallas.md aclara que Michell es COORDINADOR -- eso haria la
 * doble validacion auditor + coordinador. La maqueta ya validada
 * (mobile/design/lacrado.html) muestra dos auditores: "Gilmer Quispe ·
 * Auditor" y "Rosa Melgarejo · Auditora".
 *
 * Se toma la lectura restrictiva (auditor/administrador) porque el costo de
 * los dos errores no es simetrico: si sobra un rol, alguien que no
 * corresponde cierra el mes de forma irreversible; si falta, se agrega en
 * una linea cuando el cliente conteste.
 */
export const ROLES_QUE_APRUEBAN_CIERRE: Rol[] = ['administrador', 'auditor'];

// ---------------------------------------------------------------------------
// Alcance de lectura
// ---------------------------------------------------------------------------

/**
 * Que sucursal puede consultar este actor.
 *
 * CORRECCION DEL CLIENTE (2026-09-09): el auditor audita LA CADENA, no una
 * tienda -- accede a TODAS las sucursales, igual que el administrador (ve
 * todo si no filtra, y puede filtrar por la que quiera). Antes quedaba
 * recortado a la suya e ignoraba el query param; era la regla al reves.
 *
 * Devuelve `undefined` cuando no hay que filtrar (sin filtro pedido).
 */
export function resolverSucursalConsultable(
  actor: ColaboradorAutenticado,
  sucursalIdPedida: number | undefined,
): number | undefined {
  if (actor.rol === 'administrador' || actor.rol === 'auditor') return sucursalIdPedida;

  throw new Prohibido('Tu rol no tiene acceso al historico de inventarios.');
}

/**
 * Igual que `resolverSucursalConsultable`, para el consolidado de VARIAS
 * tiendas (2026-09-09): compone la misma regla, valor por valor, sin
 * cambiarla -- el administrador recibe eco de lo que pidió (o `undefined` =
 * todas, si no pidió nada), el auditor SIEMPRE termina con la suya sola,
 * pida lo que pida. `Set` para no repetir un id si por lo que sea vino dos
 * veces en la query.
 */
export function resolverSucursalesConsultables(actor: ColaboradorAutenticado, idsPedidos: number[] | undefined): number[] | undefined {
  if (idsPedidos === undefined) {
    const resuelto = resolverSucursalConsultable(actor, undefined);
    return resuelto === undefined ? undefined : [resuelto];
  }
  const resueltos = new Set<number>();
  for (const id of idsPedidos) {
    resueltos.add(resolverSucursalConsultable(actor, id)!);
  }
  return [...resueltos];
}

/**
 * Lanza Prohibido si el actor no puede mirar un inventario de esa sucursal.
 *
 * CORRECCION DEL CLIENTE (2026-09-09): el auditor accede a TODAS las
 * sucursales, igual que el administrador -- ya no hay recorte por tienda
 * para este rol. Sigue habiendo un motivo para rechazar: el rol en si
 * (conteo/coordinador no tienen acceso al historico, regla de conteo ciego).
 */
export function validarAccesoAInventario(actor: ColaboradorAutenticado, inventario: { sucursalId: number }): void {
  if (actor.rol === 'administrador' || actor.rol === 'auditor') return;

  throw new Prohibido(
    'El historico de inventarios lo consultan el auditor y el administrador. ' +
      'Si necesitas un dato de un cierre anterior, pídeselo a ellos.',
  );
}

// ---------------------------------------------------------------------------
// Inmutabilidad
// ---------------------------------------------------------------------------

/**
 * El guard de aplicacion de la inmutabilidad. El schema lo sostiene por
 * estructura (1:1 con el lacrado, sin `updatedAt`, hash verificable) y la
 * migracion lo va a sostener revocando UPDATE sobre la tabla del sello;
 * esto es lo que impide llegar hasta ahi -- ningun service del proyecto
 * escribe sobre un inventario lacrado sin pasar por aca primero.
 *
 * Es lo que pidio el cliente con todas las letras: un ajuste posterior "va
 * a distorsionar todo el tema del historico", hay que "regularizarlo de ahi
 * hacia adelante" (docs/pantallas.md, Pantalla 7).
 */
export function verificarNoLacrado(inventario: { estado: EstadoInventario }, accion: string): void {
  if (inventario.estado === 'lacrado') {
    throw new Conflicto(
      `El inventario esta lacrado: ${accion} no es posible. Un inventario lacrado es inmutable -- cualquier ajuste entra en el periodo siguiente.`,
    );
  }
  if (inventario.estado === 'anulado') {
    throw new Conflicto(`El inventario fue anulado: ${accion} no es posible.`);
  }
}

// ---------------------------------------------------------------------------
// Control de dos personas: aprobacion del cierre
// ---------------------------------------------------------------------------

export interface AprobacionExistente {
  aprobadorId: number;
}

/**
 * SE LIQUIDA PRIMERO, SE LACRA DESPUES. Decision del cliente, y la unica
 * compatible con lo que el sello contiene.
 *
 * El sello hashea la PLANILLA (historial.service.ts#armarDatosLacrado lee
 * `inv.liquidaciones`): es la parte que mas le importa al colaborador,
 * porque es cuanto le descuentan del sueldo. Firmar antes de liquidar
 * significaba sellar `liquidaciones: []` y que la verificacion respondiera
 * "intacto" para siempre -- un sello sobre un documento vacio, que es peor
 * que no tener sello porque da falsa confianza.
 *
 * `conteo_cerrado` salio de esta lista por eso. No es una guarda mas que
 * alguien puede saltear: el estado NO LO PERMITE, y esa es la diferencia
 * entre un control y un recordatorio. La transicion a `liquidado` la escribe
 * `liquidacion.cierre.ts#liquidar`, que solo persiste la planilla con la
 * asistencia y los ajustes ya cargados.
 *
 * `liquidado` es el unico estado aprobable: `en_curso` seria firmar un
 * resultado que todavia puede cambiar, y `lacrado` ya esta firmado (lo corta
 * antes `verificarNoLacrado`).
 */
const ESTADOS_APROBABLES: EstadoInventario[] = ['liquidado'];

/**
 * EL CONTROL DE DOS PERSONAS, de verdad.
 *
 * El problema que resuelve: hasta ahora la doble validacion era un boton
 * doble -- un auditor podia tocar "Aprobar" en la fila del otro y cerrar el
 * mes solo. Un control de dos personas que una sola persona puede completar
 * no es un control, es un tramite.
 *
 * Por eso esta funcion NO recibe un "aprobadorId": recibe al actor de la
 * SESION. El service la llama con `req.colaborador` (que auth.middleware.ts
 * saca del token, verificado contra la base) y el schema del endpoint
 * rechaza el body que traiga un aprobadorId. Es la misma regla que ya
 * gobierna el rol en todo el proyecto: lo que manda el cliente no define
 * quien es.
 *
 * Consecuencia practica y BUSCADA: hacen falta dos sesiones -- en la
 * practica, dos dispositivos o dos logins -- para lacrar. Eso es
 * exactamente el punto.
 */
export function validarPuedeAprobar(
  actor: ColaboradorAutenticado,
  inventario: { sucursalId: number; estado: EstadoInventario },
  aprobacionesExistentes: AprobacionExistente[],
  /**
   * Cuantas firmas DISTINTAS hacen falta -- nunca un 2 fijo aca adentro.
   * Quien llama de verdad (historial.service.ts) siempre lo pasa explicito,
   * leido de `historial.lacrado.ts#APROBACIONES_REQUERIDAS` (configurable
   * por entorno). El default de 2 en esta firma es solo para no obligar a
   * todos los tests existentes a repetirlo -- la produccion nunca depende
   * de el.
   */
  aprobacionesRequeridas: number = 2,
): void {
  validarAccesoAInventario(actor, inventario);

  if (!ROLES_QUE_APRUEBAN_CIERRE.includes(actor.rol)) {
    // Decir que no podes sin decir quien si deja a la persona mirando la
    // pantalla sin saber a quien pedirle.
    throw new Prohibido(
      'Aprobar el cierre lo hace un auditor o el administrador. Pídeles que lo firmen desde su propia sesión.',
    );
  }

  verificarNoLacrado(inventario, 'aprobar el cierre');

  if (!ESTADOS_APROBABLES.includes(inventario.estado)) {
    // Dos mensajes distintos porque la accion que le toca a quien lee es
    // distinta, y decirle "no se puede" sin decirle QUE falta y QUIEN lo hace
    // lo deja mirando la pantalla. Sin el enum crudo de la base: `en_curso`
    // es un valor de Postgres, no algo que la persona pueda accionar.
    if (inventario.estado === 'conteo_cerrado') {
      throw new Conflicto(
        'El inventario todavia no esta liquidado: un auditor tiene que cerrar la planilla en Liquidación y nómina ' +
          'antes de que se pueda firmar el lacrado. El sello incluye lo que se le descuenta a cada ' +
          'persona, asi que firmarlo antes seria sellar una planilla vacia.',
      );
    }
    throw new Conflicto(
      'Todavia no hay nada que aprobar: el conteo sigue abierto. ' +
        'La aprobacion viene despues de cerrar la ultima ronda y de liquidar.',
    );
  }

  // La misma persona no completa el par. La base tambien lo impide
  // (@@unique([inventarioId, aprobadorId])) -- esto existe para devolver un
  // 409 legible en vez de un error crudo de Postgres, no para reemplazarlo.
  if (aprobacionesExistentes.some((a) => a.aprobadorId === actor.colaboradorId)) {
    throw new Conflicto(
      'Ya aprobaste el cierre de este inventario. La segunda aprobacion la tiene que dar OTRA persona, desde su propia sesion.',
    );
  }

  if (aprobacionesExistentes.length >= aprobacionesRequeridas) {
    // No es un error: es que el paso siguiente ya esta habilitado. Decirlo
    // es la diferencia entre un rechazo util y uno que deja a la persona
    // preguntandose que hizo mal.
    throw new Conflicto(
      aprobacionesRequeridas === 1
        ? 'Ya hay una firma registrada: este inventario esta listo para lacrar. No hace falta una segunda aprobacion.'
        : `Ya estan las ${aprobacionesRequeridas} firmas: este inventario esta listo para lacrar. No hace falta una aprobacion mas.`,
    );
  }
}

/** Una hoja que quedo sin cerrar, con lo justo para ir a buscarla. */
export interface HojaSinFinalizar {
  numero: string;
  estado: string;
  /** Nombres de los asignados. Vacio = nadie la tiene asignada. */
  asignados: string[];
}

/** Cuantas hojas se nombran en el mensaje antes de resumir el resto. */
const HOJAS_A_LISTAR = 8;

/**
 * El mensaje del rechazo. Dice CUANTAS y CUALES, con numero de hoja y a
 * quien esta asignada.
 *
 * Un "no se puede lacrar" pelado obliga a quien lo lee a salir a buscar cual
 * de 25 hojas falta, y en la practica termina en que alguien vuelve a pedir
 * el lacrado a ver si ahora si. El numero y el nombre son lo que convierte
 * el error en una tarea concreta.
 */
export function mensajeHojasSinFinalizar(hojas: HojaSinFinalizar[]): string {
  const cuantas = hojas.length;
  const detalle = hojas
    .slice(0, HOJAS_A_LISTAR)
    .map((h) => {
      const quien = h.asignados.length > 0 ? h.asignados.join(' y ') : 'sin asignar';
      return `#${h.numero} (${h.estado}, ${quien})`;
    })
    .join(', ');
  const resto = cuantas > HOJAS_A_LISTAR ? ` y ${cuantas - HOJAS_A_LISTAR} mas` : '';

  return (
    `No se puede lacrar: ${cuantas} ${cuantas === 1 ? 'hoja sigue' : 'hojas siguen'} sin finalizar. ` +
    `Lacrar ahora cerraria el inventario con esos items sin contar, y el faltante se liquida igual. ` +
    `Falta cerrar: ${detalle}${resto}.`
  );
}

/**
 * Lanza si no se puede ejecutar el lacrado. Cuenta aprobadores DISTINTOS,
 * no filas: aunque el unique de la base ya lo garantice, contar filas seria
 * confiar en que la restriccion esta puesta -- y esta es la ultima puerta
 * antes de un cierre irreversible.
 */
export function validarPuedeLacrar(
  actor: ColaboradorAutenticado,
  inventario: {
    sucursalId: number;
    estado: EstadoInventario;
    yaLacrado: boolean;
    /**
     * false = quedan hojas sin sincronizar. El puerto del front lo dice
     * textual: "no se puede lacrar con datos que no llegaron a Dynamics".
     * Sellar un inventario al que todavia le faltan conteos por subir es
     * firmar un resultado incompleto -- y como el lacrado es inmutable, esos
     * conteos ya no entran nunca.
     */
    todoSincronizado: boolean;
    /**
     * Hojas de la ronda que NO estan finalizadas. Vacio es la condicion para
     * lacrar.
     *
     * Es una cosa DISTINTA de `todoSincronizado`, y confundirlas es como se
     * lacra un inventario a medio contar:
     *   - `sync`   = si el conteo llego al servidor
     *   - `estado` = si la persona dio por terminada la hoja
     *
     * Una hoja puede estar perfectamente sincronizada y tener 12 de 50 items
     * contados. El servidor la ve al dia; la gondola no. Y como el lacrado es
     * el punto de no retorno, esos 38 items entran a la liquidacion como
     * faltante -- un faltante inventado que alguien paga de su sueldo.
     */
    hojasSinFinalizar: HojaSinFinalizar[];
  },
  aprobaciones: AprobacionExistente[],
  /** Mismo parametro y mismo criterio que `validarPuedeAprobar` de arriba. */
  aprobacionesRequeridas: number = 2,
): void {
  validarAccesoAInventario(actor, inventario);

  if (!ROLES_QUE_APRUEBAN_CIERRE.includes(actor.rol)) {
    throw new Prohibido(
      'Lacrar el inventario lo hace un auditor o el administrador. Pídeles que lo firmen desde su propia sesión.',
    );
  }

  if (inventario.yaLacrado || inventario.estado === 'lacrado') {
    throw new Conflicto(
      'Este inventario ya esta lacrado y no se puede modificar. ' +
        'Cualquier ajuste entra en el inventario del mes siguiente.',
    );
  }
  verificarNoLacrado(inventario, 'lacrar');

  if (!ESTADOS_APROBABLES.includes(inventario.estado)) {
    throw new Conflicto(
      'Todavia no se puede lacrar: el inventario sigue en curso. ' +
        'Antes hay que cerrar las 3 rondas de conteo y liquidar el mes.',
    );
  }

  const aprobadoresDistintos = new Set(aprobaciones.map((a) => a.aprobadorId));
  if (aprobadoresDistintos.size < aprobacionesRequeridas) {
    throw new Conflicto(
      `Faltan aprobaciones: el lacrado exige ${aprobacionesRequeridas} de personas distintas y hay ${aprobadoresDistintos.size}.`,
    );
  }

  /**
   * Antes que el de sincronizacion: una hoja sin finalizar NO se arregla
   * sola. Hay que ir a la gondola, contarla y cerrarla — asi que es lo
   * primero que la persona tiene que saber.
   */
  if (inventario.hojasSinFinalizar.length > 0) {
    throw new Conflicto(mensajeHojasSinFinalizar(inventario.hojasSinFinalizar));
  }

  // Ultimo chequeo, y va al final a proposito: es el que mas probablemente
  // se resuelva solo esperando la WiFi de la tienda, asi que primero se le
  // dice a la persona lo que SI tiene que arreglar.
  if (!inventario.todoSincronizado) {
    throw new Conflicto(
      'Quedan hojas sin sincronizar: no se puede lacrar con conteos que todavia no llegaron al servidor. Espera a que termine la sincronizacion y vuelve a intentar.',
    );
  }
}

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

/** Valida un mes calendario. Se usa en los filtros del historico. */
export function validarPeriodo(anio: number, mes: number): void {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new SolicitudInvalida('El anio del periodo tiene que ser un entero entre 2000 y 2100.');
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new SolicitudInvalida('El mes del periodo tiene que ser un entero entre 1 y 12.');
  }
}
