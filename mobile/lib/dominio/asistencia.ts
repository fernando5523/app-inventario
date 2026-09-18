/**
 * LA ASISTENCIA AL INVENTARIO, como reglas puras.
 *
 * Vive acá y no dentro de la pantalla por la misma razón que
 * `reparto-visible.ts`: es una regla de negocio, no presentación, y así se
 * prueba sin montar nada (ver asistencia.test.ts).
 *
 * ---------------------------------------------------------------------------
 * EL CAMBIO QUE ESTO ACOMPAÑA
 * ---------------------------------------------------------------------------
 * Hasta ahora el sistema ADIVINABA quién asistió: "tiene una hoja con al
 * menos un conteo, entonces vino". El costo aceptado era que quien vino y no
 * llegó a contar figuraba como ausente -- y se le descontaba del sueldo.
 *
 * Desde ahora el Coordinador REGISTRA la entrada, persona por persona y día
 * por día, y la multa se cobra POR DÍA FALTADO en vez de un monto fijo por
 * persona ausente.
 *
 * ---------------------------------------------------------------------------
 * LOS DÍAS DEL INVENTARIO NO SE ELIGEN
 * ---------------------------------------------------------------------------
 * Son los días DISTINTOS que tienen al menos una marca. Nadie tipea "este
 * inventario duró 3 días": ese número es el DENOMINADOR de la multa de todo
 * el personal, así que sale de los hechos registrados y de ningún otro lado.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA CUENTA, NO DOS
 * ---------------------------------------------------------------------------
 * El servidor manda `dias` junto con las marcas (ver `AsistenciaInventario`
 * en puertos/repositorios.ts). Este archivo NO los vuelve a derivar: la
 * pantalla usa el que vino. Derivarlo de nuevo acá sería la segunda copia de
 * la misma fórmula, y el día que difieran nadie va a saber cuál creer -- la
 * misma trampa que ya se pagó cara cuando el encabezado de Liquidación y la
 * planilla firmada armaban el neto cada uno por su cuenta.
 *
 * Lo único que se calcula acá es cuántos de esos días marcó CADA persona: esa
 * desagregación el servidor no la manda, y la pantalla la necesita para poder
 * decir "2 de 3 días" en cada fila.
 */

import { pluralizar } from './plural';

/** Una marca de entrada. Solo entrada: no hay marca de salida. */
export interface MarcaDeAsistencia {
  colaboradorId: number;
  /** El día de la jornada, `YYYY-MM-DD`. Sin hora -- la hora está en `registradoEn`. */
  dia: string;
  /** ISO 8601: cuándo se registró la entrada. */
  registradoEn: string;
}

/**
 * Una fila de la lista del Coordinador: la persona, cuántos días lleva y si
 * ya entró el día que se está mirando.
 *
 * Genérica en `P` para no atarse al tipo del padrón: este archivo no importa
 * nada del puerto ni de la red, igual que el resto de `lib/dominio` (ver la
 * cabecera de dominio/tipos.ts).
 */
export interface FilaAsistencia<P> {
  persona: P;
  /** Días DISTINTOS de TODO el inventario en los que esta persona tiene marca. */
  diasAsistidos: number;
  /** Su marca del día mirado, o `null` si todavía no registró la entrada. */
  marcaDelDia: MarcaDeAsistencia | null;
}

/**
 * Cuántos días distintos marcó cada persona. `Map` y no una lista: la
 * pregunta que hace quien llama es "¿cuántos lleva ESTA persona?", y con una
 * lista esa respuesta cuesta un recorrido por cada colaborador.
 *
 * Cuenta días DISTINTOS y no marcas: dos marcas del mismo día son un día. El
 * `@@unique(inventarioId, colaboradorId, dia)` del servidor ya lo impide,
 * pero la cuenta no puede depender de que una restricción de otra capa siga
 * existiendo -- si algún día se afloja, acá nadie cobraría dos días por haber
 * fichado dos veces la misma mañana.
 */
export function diasAsistidosPorColaborador(marcas: readonly MarcaDeAsistencia[]): Map<number, number> {
  const diasPorPersona = new Map<number, Set<string>>();
  for (const marca of marcas) {
    const dias = diasPorPersona.get(marca.colaboradorId) ?? new Set<string>();
    dias.add(marca.dia);
    diasPorPersona.set(marca.colaboradorId, dias);
  }
  return new Map([...diasPorPersona].map(([id, dias]) => [id, dias.size]));
}

/**
 * La lista completa que dibuja la pantalla, en el ORDEN DEL PADRÓN.
 *
 * Arranca del personal y no de las marcas a propósito: quien todavía no
 * marcó ningún día tiene que aparecer igual, con 0. Armarla desde las marcas
 * dejaría invisible justo a quien falta registrar -- que es la única razón
 * por la que alguien abre esta pantalla.
 */
export function filasDeAsistencia<P extends { id: number }>(
  personal: readonly P[],
  marcas: readonly MarcaDeAsistencia[],
  dia: string,
): FilaAsistencia<P>[] {
  const porPersona = diasAsistidosPorColaborador(marcas);
  return personal.map((persona) => ({
    persona,
    diasAsistidos: porPersona.get(persona.id) ?? 0,
    marcaDelDia: marcas.find((m) => m.colaboradorId === persona.id && m.dia === dia) ?? null,
  }));
}

/** Cuántas personas del padrón ya tienen su entrada registrada ese día. */
export function presentesEnElDia<P extends { id: number }>(filas: readonly FilaAsistencia<P>[]): number {
  return filas.filter((f) => f.marcaDelDia !== null).length;
}

/**
 * "2 de 3 días" -- el numerador Y el denominador juntos, siempre.
 *
 * Nunca un "2 días" suelto: 2 de 2 y 2 de 5 son la diferencia entre cobrar
 * bono y pagar tres días de multa, y sin el denominador esa fila no dice
 * nada de lo que de verdad le pasa a la persona.
 *
 * Con un `null` devuelve "—" y no un 0: un dato que no se pudo traer no es
 * "asistió cero días" (ver la regla de honestidad en la skill trujillo-ui).
 * Con CERO días de inventario tampoco se afirma una fracción: mientras nadie
 * registre una entrada, el inventario todavía no tiene días.
 */
export function textoDiasAsistidos(diasAsistidos: number | null, diasDelInventario: number | null): string {
  if (diasAsistidos === null || diasDelInventario === null) return '—';
  if (diasDelInventario === 0) return 'Sin días registrados';
  return `${diasAsistidos} de ${diasDelInventario} ${pluralizar(diasDelInventario, 'día', 'días')}`;
}

/**
 * Cuántos días faltó: los del inventario menos los que marcó, nunca
 * negativo.
 *
 * Es la cantidad que multiplica la tarifa, así que el piso en 0 no es
 * defensivo por las dudas: una marca de un día que después se borró del
 * inventario dejaría un asistido > inventario, y un faltado negativo se
 * convertiría en una multa NEGATIVA -- o sea, en plata a favor de alguien
 * por un día que no existió.
 */
export function diasFaltados(diasDelInventario: number, diasAsistidos: number): number {
  return Math.max(0, diasDelInventario - diasAsistidos);
}

/**
 * LA MULTA: `días faltados x tarifa por día`. Nunca negativa.
 *
 * Espeja `multaPorInasistencia` de `backend/src/dominio/asistencia.ts`, con
 * la misma firma y el mismo nombre. Está duplicada A PROPÓSITO y no
 * importada, por lo mismo que `reparto-visible.ts#resumirAsistencia`: no hay
 * lib compartida entre backend y mobile, y una regla de una línea duplicada
 * sale más barata que el andamiaje para compartirla. Si el día de mañana la
 * regla cambia, estos dos archivos se tocan juntos -- el nombre idéntico es
 * lo que hace que se encuentren.
 *
 * Que la pantalla la recalcule en vez de recibirla ya sumada no contradice la
 * regla de "la cuenta que se muestra es la que se guarda": el `monto` de la
 * fila —lo que de verdad se le descuenta— sigue viniendo del servidor. Esto
 * es el desglose de por qué ese monto es ese, con la misma fórmula y los
 * mismos tres datos que usó el servidor para armarlo. Si alguna vez no
 * coincidieran, se vería en la propia fila: la multa al lado del monto.
 */
export function multaPorInasistencia(diasInventario: number, diasAsistidos: number, tarifaPorDia: number): number {
  return diasFaltados(diasInventario, diasAsistidos) * tarifaPorDia;
}
