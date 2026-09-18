/**
 * Adaptador en memoria de RepositorioAsistencia.
 *
 * Es a propósito que viva en memoria (ver sesion-memoria.ts): sirve para
 * demostrar y para probar la pantalla sin backend. Lo que NO hace es decir
 * que sí a todo — reproduce las guardas reales, por la misma razón que
 * lacrado-memoria.ts: un adaptador que siempre acepta hace que la pantalla se
 * pruebe contra un servidor que no existe.
 *
 * Las tres que reproduce:
 *
 *  1. QUIÉN MARCA sale de la SESIÓN ACTIVA, nunca de un parámetro — igual que
 *     la firma del lacrado. Solo Coordinador o Administrador, y el
 *     Coordinador solo en SU sucursal.
 *  2. A QUIÉN se le marca: solo al PERSONAL DE TIENDA de esa sucursal
 *     (coordinador y conteo). Desde el commit 233f4b7 el auditor y el
 *     administrador no son personal de tienda: no se les marca asistencia ni
 *     se les cobra multa, y marcarles una acá los metería en una planilla de
 *     la que están afuera.
 *  3. LA HORA DE ENTRADA NO SE PISA. Marcar de nuevo a alguien que ya entró
 *     deja la hora de la PRIMERA marca. La hora que vale es la de cuando
 *     llegó, no la del último toque de pantalla — y es el dato que defiende a
 *     la persona si alguien discute su jornada.
 *
 * LO QUE NO PUEDE REPRODUCIR, y conviene saberlo: que el inventario siga
 * `en_curso`. El inventario en memoria (`_compartido.ts#InventarioDemo`) no
 * guarda estado — solo sus hojas —, así que acá se puede marcar asistencia
 * sobre un inventario que el servidor ya habría cerrado. Esa guarda la
 * sostiene el backend y solo el backend. Se deja dicho en vez de simularlo
 * con un estado inventado, que es la clase de mentira que después nadie
 * revisa.
 */

import { obtenerInventario, simularLatencia } from './_compartido';
import { sesionMemoria } from './sesion-memoria';
import type { AsistenciaInventario, MarcaAsistencia, RepositorioAsistencia } from '../puertos/repositorios';

/** `inventarioId -> "colaboradorId|dia" -> marca`. La clave compuesta ES el `@@unique` del servidor. */
const marcasPorInventario = new Map<number, Map<string, MarcaAsistencia>>();

const clave = (colaboradorId: number, dia: string): string => `${colaboradorId}|${dia}`;

function marcasDe(inventarioId: number): Map<string, MarcaAsistencia> {
  let marcas = marcasPorInventario.get(inventarioId);
  if (!marcas) {
    marcas = new Map();
    marcasPorInventario.set(inventarioId, marcas);
  }
  return marcas;
}

/** Solo para tests: deja el adaptador como recién arrancado. */
export function limpiarAsistenciaMemoria(): void {
  marcasPorInventario.clear();
}

/**
 * Las dos guardas de escritura, juntas: quién puede marcar y a quién.
 *
 * Devuelve el padrón de tienda ya resuelto porque las dos operaciones lo
 * necesitan igual — separarlas dejaría dos lugares donde acordarse de
 * validar, y uno se olvida.
 */
async function validarEscritura(inventarioId: number, colaboradorId: number): Promise<void> {
  const inventario = await obtenerInventario(inventarioId);
  if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

  const sesion = await sesionMemoria.sesionActiva();
  if (!sesion) {
    throw new Error('No hay sesión activa: la asistencia se registra siempre contra quien está logueado.');
  }
  const quien = sesion.colaborador;
  if (quien.rol !== 'coordinador' && quien.rol !== 'administrador') {
    throw new Error('Solo el Coordinador o un Administrador pueden registrar la asistencia del inventario.');
  }
  // El Administrador no tiene sucursal (ver tipos.ts#Sesion) y entra a todas;
  // el Coordinador solo a la suya. Se compara sin `!`: si alguna vez llegara
  // null en un coordinador, negar es lo correcto.
  if (quien.rol === 'coordinador' && sesion.sucursal?.id !== inventario.sucursalId) {
    throw new Error('Solo el Coordinador de la sucursal del inventario puede registrar su asistencia.');
  }

  const personal = await sesionMemoria.colaboradores(inventario.sucursalId);
  if (!personal.some((c) => c.id === colaboradorId)) {
    throw new Error(
      `El colaborador ${colaboradorId} no es personal de tienda de esta sucursal: no entra al inventario ni a su planilla.`,
    );
  }
}

export const asistenciaMemoria: RepositorioAsistencia = {
  async deInventario(inventarioId): Promise<AsistenciaInventario> {
    await simularLatencia();
    const inventario = await obtenerInventario(inventarioId);
    if (!inventario) throw new Error(`Inventario ${inventarioId} no encontrado.`);

    const marcas = [...marcasDe(inventarioId).values()];
    // Ascendente: la tira de días de la pantalla es una línea de tiempo, y
    // `YYYY-MM-DD` ordena alfabéticamente igual que cronológicamente.
    const dias = [...new Set(marcas.map((m) => m.dia))].sort();

    return {
      dias,
      marcas,
      // El padrón de TIENDA, el mismo que ve el login: sin auditores ni
      // administradores (ver la cabecera de este archivo).
      personal: (await sesionMemoria.colaboradores(inventario.sucursalId)).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        rol: c.rol,
      })),
    };
  },

  async marcar(inventarioId, colaboradorId, dia) {
    await simularLatencia();
    await validarEscritura(inventarioId, colaboradorId);

    const marcas = marcasDe(inventarioId);
    // Ya entró: NO se pisa la hora. Este `return` es toda la idempotencia.
    if (marcas.has(clave(colaboradorId, dia))) return;

    marcas.set(clave(colaboradorId, dia), { colaboradorId, dia, registradoEn: new Date().toISOString() });
  },

  async quitar(inventarioId, colaboradorId, dia) {
    await simularLatencia();
    await validarEscritura(inventarioId, colaboradorId);
    // `delete` de algo que no está no truena: borrar dos veces deja el mismo
    // estado, así que un reintento tras un timeout no puede fallar.
    marcasDe(inventarioId).delete(clave(colaboradorId, dia));
  },
};
