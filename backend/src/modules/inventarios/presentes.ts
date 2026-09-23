/**
 * CUANTOS CONTADORES HAY HOY EN LA TIENDA, para decidir en cuantas hojas se
 * parte una ronda.
 *
 * EN UN SOLO LUGAR a proposito: lo usan los DOS caminos que crean hojas -- la
 * ronda 1 (`inventarios.service.ts#crearHojas`) y las rondas de reconteo
 * (`rondas.service.ts#materializarRonda`). Dos consultas parecidas terminarian
 * dando dos tamaños de hoja distintos para el mismo inventario el dia que una
 * filtre algo que la otra no.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ROL `conteo` Y NO `ROLES_DE_TIENDA`
 * ---------------------------------------------------------------------------
 * `ROLES_DE_TIENDA` incluye al Coordinador, y el Coordinador SI puede recibir
 * una hoja cuando se reparte -- eso no cambia. Pero quien CUENTA la ronda son
 * los contadores, y el numero que se busca acá es "entre cuantas manos se
 * parte el trabajo".
 *
 * Meterlo en la cuenta cambiaria el tamaño de la hoja por una persona que en
 * general no va a contar: con 16 items y 4 contadores mas el Coordinador,
 * saldrian hojas de 3 en vez de 4, y la quinta hoja quedaria sin dueño o
 * forzaria al Coordinador a contar. El reparto (`lote.ts#repartir`) ya decide
 * aparte a quien le toca cada hoja; esta funcion solo dice en cuantos pedazos
 * conviene cortar.
 *
 * ---------------------------------------------------------------------------
 * "PRESENTE" ES ASISTENCIA MARCADA HOY
 * ---------------------------------------------------------------------------
 * Una fila en `asistencia_inventario` con el dia de hoy = esa persona vino a
 * contar hoy. No sirve "el personal activo de la sucursal": el inventario se
 * cuenta con quien aparecio, y el Coordinador lo registra al empezar la
 * jornada (ver `dominio/asistencia.ts`).
 *
 * Cero presentes NO es cero contadores: es "todavia no se tomo asistencia".
 * Quien llama lo trata asi -- `lote.ts#tamanoEfectivoDeHoja` devuelve el
 * tamaño elegido sin tocar nada en ese caso.
 */
import { prisma } from '../../config/database';

/** El dia de HOY en `YYYY-MM-DD`, en UTC -- igual que `aMarcaAsistencia`. */
function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Contadores con asistencia marcada HOY para este inventario.
 *
 * Se cruza contra `Colaborador` por rol: una marca de asistencia de alguien
 * que no es `conteo` (el Coordinador, que tambien se marca) no suma acá.
 */
export async function contadoresPresentesHoy(inventarioId: number): Promise<number> {
  const marcas = await prisma.asistenciaInventario.findMany({
    where: { inventarioId, dia: hoyUtc() },
    select: { colaboradorId: true },
  });
  if (marcas.length === 0) return 0;

  return prisma.colaborador.count({
    where: { id: { in: marcas.map((m) => m.colaboradorId) }, rol: 'conteo', activo: true },
  });
}
