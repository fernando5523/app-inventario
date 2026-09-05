/**
 * Reparto EXACTO de una bolsa de plata entre varias personas.
 *
 * PURO -- sin Prisma ni Express -- para poder probar la propiedad que importa
 * (ver reparto-de-fondo.test.ts). Mismo criterio que `dominio/lote.ts`.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA QUE RESUELVE
 * ---------------------------------------------------------------------------
 * El fondo de multas por inasistencia SE REDISTRIBUYE entre quienes sí
 * asistieron -- es la regla textual del cliente. Repartirlo como
 * `redondear(fondo / asistentes)` y aplicarle ese mismo número a cada uno NO
 * cumple la regla cuando la división no da exacta:
 *
 *     S/80 entre 7 personas  ->  11.4285...  ->  11.43 c/u  ->  se reparten 80.01
 *     S/40 entre 9 personas  ->   4.4444...  ->   4.44 c/u  ->  se reparten 39.96
 *
 * En el primer caso la empresa PONE un centavo; en el segundo SE QUEDA con
 * cuatro. Ninguna de las dos es lo que se acordó. Y el primero no es
 * hipotético: es el ejemplo real que dio Gilmer en la reunión de requisitos
 * (11 personas, 4 faltas, S/80 entre 7 asistentes = S/11.43 c/u).
 *
 * Son centavos, y aun así hay que arreglarlo por algo más grande que el
 * monto: si alguien suma los bonos de una planilla y no le da el total de las
 * multas, deja de confiar en el sistema entero. Un número que no cierra se
 * nota, y a partir de ahí todo lo demás queda bajo sospecha.
 */

/**
 * Cuánto le toca a cada persona, con la suma EXACTAMENTE igual al fondo.
 *
 * Trabaja en CENTAVOS enteros y no en soles con decimales: `0.1 + 0.2` no da
 * `0.3` en punto flotante, y acá el objetivo es justamente que una suma
 * cierre al centavo. Con enteros el reparto es exacto por construcción, no
 * por suerte del redondeo.
 *
 * EL SOBRANTE VA POR ID ASCENDENTE, y el criterio importa tanto como el
 * monto: si dependiera del orden en que la base devolvió las filas, la misma
 * liquidación podría dar distinto en dos corridas. Un centavo que se mueve
 * solo es peor que un centavo mal repartido -- el primero hace dudar de todo
 * el cálculo. Por eso se ordena explícitamente acá y no se confía en el
 * orden de entrada.
 *
 * Los ids se devuelven en un Map: quien llama arma su planilla en el orden
 * que quiera sin que eso cambie a quién le tocó el centavo.
 *
 * @param fondo   Monto total a repartir, en soles (ej. 80.00).
 * @param ids     Personas entre las que se reparte. Vacío = no se reparte nada.
 */
export function repartirExacto(fondo: number, ids: readonly number[]): Map<number, number> {
  const reparto = new Map<number, number>();

  // Sin nadie a quien repartir, no se reparte. El fondo queda sin distribuir
  // y quien llama tiene que saberlo -- ver `sobranteSinRepartir`.
  //
  // En la práctica esto pasa solo si NADIE asistió al inventario: todos
  // pagan multa y no hay a quién redistribuirla. Es un caso degenerado (si no
  // fue nadie, tampoco hubo inventario), pero devolver un reparto vacío es
  // más honesto que inventar un destinatario.
  if (ids.length === 0) return reparto;

  // A centavos, redondeando una sola vez y al principio.
  const centavosTotales = Math.round(fondo * 100);
  const base = Math.trunc(centavosTotales / ids.length);
  const sobran = centavosTotales - base * ids.length;

  // Orden estable y explícito: id ascendente. No el orden de entrada.
  const ordenados = [...ids].sort((a, b) => a - b);

  for (const [indice, id] of ordenados.entries()) {
    // Los primeros `sobran` reciben un centavo más. Con `sobran` negativo
    // (fondo negativo, que no debería pasar) la comparación deja a todos con
    // la base y el sobrante queda visible en `sobranteSinRepartir`.
    const centavos = base + (indice < sobran ? 1 : 0);
    reparto.set(id, centavos / 100);
  }

  return reparto;
}

/**
 * Lo que quedó sin repartir. Con `repartirExacto` y al menos una persona
 * SIEMPRE es 0 -- existe para poder afirmarlo en un test y para el único
 * caso donde no lo es: cuando no hay nadie entre quien repartir.
 */
export function sobranteSinRepartir(fondo: number, reparto: ReadonlyMap<number, number>): number {
  let repartido = 0;
  for (const monto of reparto.values()) repartido += Math.round(monto * 100);
  return (Math.round(fondo * 100) - repartido) / 100;
}

/**
 * El bono "de cartel": lo que muestra el encabezado de la pantalla ("−S/7.50
 * de descuento adicional para cada asistente").
 *
 * Es el piso del reparto, no el promedio: si a algunos les toca un centavo
 * más, el encabezado dice el número que TODOS reciben como mínimo y la
 * planilla muestra el de cada uno. Decir un promedio con decimales que nadie
 * recibe sería peor que decir el piso.
 */
export function bonoBase(fondo: number, cantidadDePersonas: number): number {
  if (cantidadDePersonas <= 0) return 0;
  return Math.trunc(Math.round(fondo * 100) / cantidadDePersonas) / 100;
}
