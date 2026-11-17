import type {
  ArchivoElegido,
  EstadoDelInventario,
  FilaCorregible,
  InventarioActivo,
  ItemDeLaMatriz,
  LineaEmpaque,
  MotivoAdvertenciaFila,
  ProductoDeHoja,
  StockDeLaMedicion,
} from './tipos'

/**
 * Las reglas de "Corregir lo contado" que no se pueden escribir dentro del JSX:
 * cuándo está abierta la vía, qué decir cuando no, y cuánto suma un conteo.
 *
 * SON LAS MISMAS que `mobile/lib/dominio/ajuste-final.ts`, con los MISMOS
 * textos. No se reinventaron: están discutidas con el cliente una por una, y
 * dos redacciones distintas de la misma regla es como se abre la puerta a que
 * una de las dos insinúe algo que la otra niega.
 *
 * Están en un archivo aparte y probadas porque son reglas con bordes —cuatro
 * fases, dos roles, un mínimo de caracteres— y adentro de un componente no se
 * puede probar ninguna.
 */

/**
 * LO QUE NUNCA SE CORRIGE: el stock del ERP.
 *
 * Copia LITERAL de `STOCK_NO_SE_CORRIGE` en `mobile/lib/dominio/ajuste-final.ts`.
 * Se copia y no se importa porque el portal no comparte código con la app
 * móvil (otro bundle, otro `tsconfig`), pero el texto es el mismo a propósito:
 * es regla textual del cliente —corregir lo CONTADO no es corregir el STOCK— y
 * la dicen la pantalla y su formulario.
 */
export const STOCK_NO_SE_CORRIGE =
  'El stock viene del sistema y no se corrige desde aquí: está para comparar. Lo que cambias es lo que se contó.'

/**
 * En qué momento del cierre está el inventario. Es lo que decide si la vía de
 * corrección está abierta, y no alcanza con el estado: `en_curso` cubre desde
 * "todavía no hay hojas" hasta "todas las rondas cerradas esperando al
 * Auditor", y en esas dos se puede hacer distinto.
 */
export type FaseDeCierre = 'sin-hojas' | 'contando' | 'rondas-cerradas' | 'ajuste' | 'cerrado'

export function faseDeCierre(inventario: InventarioActivo | null): FaseDeCierre | null {
  if (inventario === null) return null
  const { estado, rondaActiva, totalHojas, ultimaRondaCerrada } = inventario
  if (estado === 'ajuste_auditor') return 'ajuste'
  if (estado !== 'en_curso') return 'cerrado'
  // Sin hojas no hay conteo que haya terminado ni ronda que cerrar: va primero
  // para que ninguna de las dos ramas de abajo lo pueda reclamar.
  if (totalHojas === 0) return 'sin-hojas'
  if (rondaActiva === null) return 'rondas-cerradas'
  /**
   * LA MARCA PROPIA DEL CIERRE. `rondaActiva` es `max(numeroConteo)` y sigue
   * siendo un número después de cerrar: cuando queda algo que recontar el
   * cierre crea la ronda siguiente y eso hacía de marca implícita, pero con
   * todo cuadrado no se crea ninguna. Se lee la marca en vez de deducirla.
   *
   * No es `cerrado`: el inventario sigue `en_curso` esperando al Auditor, y en
   * esa ventana todavía se corrige.
   */
  if (ultimaRondaCerrada !== null && ultimaRondaCerrada >= rondaActiva) return 'rondas-cerradas'
  return 'contando'
}

/**
 * La ventana de corrección es la MISMA para el Coordinador y para el Auditor.
 * Lo que los diferencia no es cuándo sino QUÉ VEN: el Auditor ve el stock del
 * ERP y el Coordinador no (conteo ciego). Eso lo decide el servidor en lo que
 * devuelve, no esta función.
 */
export function puedeCorregirLoContado(fase: FaseDeCierre | null): boolean {
  return fase === 'contando' || fase === 'rondas-cerradas'
}

/**
 * POR QUÉ NO SE PUEDE CORREGIR AHORA, en términos del negocio y nunca del
 * sistema. `null` cuando sí se puede.
 *
 * El texto del ajuste cambia según QUIÉN lee. Este portal es del Auditor, así
 * que es la variante de auditor: decirle "el auditor ya empezó" AL AUDITOR lo
 * dejaría buscando a otra persona que no existe.
 */
export function motivoSinCorregir(fase: FaseDeCierre | null): string | null {
  if (fase === 'ajuste') {
    return 'Ya empezaste el ajuste final de este inventario: desde aquí no se corrige más. Los valores definitivos se fijan en Ajuste final del conteo.'
  }
  if (fase === 'cerrado') {
    return 'El conteo de este inventario ya cerró: los valores quedaron firmes y son los que usa la liquidación.'
  }
  if (fase === 'sin-hojas') {
    return 'Este inventario todavía no tiene hojas repartidas, así que no hay nada contado que corregir.'
  }
  return null
}

/**
 * Mínimo de caracteres del motivo, ya sin espacios de los bordes.
 *
 * El contrato del servidor exige 3; este piso es nuestro y es más alto a
 * propósito. Con un campo obligatorio y sin piso, lo que se escribe es "." o
 * "x" — y entonces el requisito se cumple en la base y no se cumple en la
 * realidad, que es poder explicar el descuento seis meses después.
 */
export const MOTIVO_MINIMO = 5

/** Qué falta para que el motivo sirva. `null` cuando ya sirve. */
export function errorDeMotivo(motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio.length === 0) return 'Escribe por qué cambias este valor: queda registrado junto al cambio.'
  if (limpio.length < MOTIVO_MINIMO) return `Explica un poco más: al menos ${MOTIVO_MINIMO} caracteres.`
  return null
}

/**
 * CUÁNTAS UNIDADES SUMA UN CONTEO: los empaques cerrados por su factor, más las
 * sueltas.
 *
 * Una línea cuyo empaque no existe en el producto se IGNORA en vez de sumar
 * cero en silencio: si el nombre no coincide, el factor es desconocido y
 * contarla como 0 daría un total que parece bueno y está mal. El caso no
 * debería ocurrir —las líneas salen de los empaques del propio producto— y por
 * eso no hay un aviso: es una red, no una rama de negocio.
 */
export function totalUnidades(conteo: { empaques: LineaEmpaque[]; sueltas: number }, empaques: ProductoDeHoja['empaques']): number {
  const factorPorNombre = new Map(empaques.map((e) => [e.nombre, e.factor] as const))
  const deEmpaques = conteo.empaques.reduce((suma, linea) => {
    const factor = factorPorNombre.get(linea.empaqueNombre)
    return factor === undefined ? suma : suma + linea.cantidad * factor
  }, 0)
  return deEmpaques + conteo.sueltas
}

/**
 * POR QUÉ ESTA FILA SE MIDIÓ CONTRA ESE STOCK. `null` cuando no hay nada que
 * explicar: sin stock, con una sola ronda, o cuando el stock es el de la ronda
 * del conteo (el caso normal).
 *
 * LA CAÍDA SE DICE CON PALABRAS y no solo con un rótulo: "faltan 3" contra el
 * stock del día y "faltan 3" contra el del día 22 no son la misma afirmación, y
 * de eso sale un descuento. Quien lo discuta tiene derecho a saber cuál le tocó.
 */
export function textoStockDeLaMedicion(m: StockDeLaMedicion): string | null {
  if (m.stockErp === null || m.rondaDelConteo === null || m.rondaDelStock === null) return null
  if (m.cayoALaRonda1) {
    return `El ${ordinal(m.rondaDelConteo)} conteo no trajo stock propio del sistema: se comparó contra el stock del ${ordinal(1)} conteo.`
  }
  if (m.rondaDelStock > 1) {
    return `Se comparó contra el stock que el sistema dio para el ${ordinal(m.rondaDelStock)} conteo.`
  }
  return null
}

/** "1er", "2do", "3er"… Mismo formato que la app móvil, para que una ronda se llame igual en los dos lados. */
export function ordinal(n: number): string {
  const fijos: Record<number, string> = { 1: '1er', 2: '2do', 3: '3er', 4: '4to', 5: '5to', 6: '6to', 7: '7mo', 8: '8vo', 9: '9no' }
  return fijos[n] ?? `${n}º`
}

/**
 * QUÉ DECIR CUANDO LA CORRECCIÓN SACÓ EL ÍTEM DE LA RONDA SIGUIENTE. Es lo
 * único que el cliente pidió con esas palabras: *"corrígelo para que ya no
 * salga en mi segundo conteo"*. Sin esto, quien corrige guarda y no sabe si lo
 * consiguió.
 */
export function textoItemSalioDeRonda(salida: { codigo: string; ronda: number; hojaBorrada: boolean; rondaBorrada: boolean }): string {
  const conteo = `${ordinal(salida.ronda)} conteo`
  if (salida.rondaBorrada) {
    return `${salida.codigo} ya no sale en el ${conteo}. Era el último ítem que quedaba, así que ese conteo ya no hace falta.`
  }
  if (salida.hojaBorrada) {
    return `${salida.codigo} ya no sale en el ${conteo}. Su hoja quedó sin ítems y se cerró.`
  }
  return `${salida.codigo} ya no sale en el ${conteo}: ahora cuadra contra el stock.`
}

/** Qué decir cuando la ronda que se estaba mirando ya no existe. */
export function textoRondaQueYaNoExiste(pedida: number, vigente: number): string {
  return `El ${ordinal(pedida)} conteo ya no existe en este inventario: se corrigió su último ítem y quedó sin hojas. Se muestra el ${ordinal(vigente)} conteo, que es el vigente.`
}

/**
 * Arma las filas de la pantalla cruzando las hojas con la matriz.
 *
 * Las hojas dan el `hojaId` y el conteo que hay cargado; la matriz da el stock
 * y el veredicto. Un producto que la matriz no trajo queda con `item: null` y
 * la pantalla lo muestra sin stock y sin diferencia — nunca con un 0, que
 * diría que cuadró.
 *
 * ---------------------------------------------------------------------------
 * EL CRUCE ES POR CÓDIGO, Y ESO ES EL ARREGLO DE UN BUG QUE MENTÍA EN SILENCIO
 * ---------------------------------------------------------------------------
 * El mismo artículo se materializa como un `Producto` DISTINTO en cada hoja de
 * cada ronda; lo único que lo identifica de punta a punta es el CÓDIGO. La
 * matriz devuelve el `productoId` DE LA RONDA 1 (`auditoria.service.ts`: "la
 * ronda 1 manda para productoId/zona/hoja").
 *
 * Cruzando por `productoId`, corregir la ronda 1 funcionaba y de la 2 en
 * adelante no encontraba NINGUNO: el stock del ERP, la columna Diferencia y el
 * filtro "Sin cuadrar" salían vacíos, sin un solo error a la vista. Medido en
 * el inventario 8078: de los productos de la ronda 2 coinciden 0 con los ids
 * de la matriz, de la ronda 3 coinciden 0 y de la 4 coinciden 0.
 */
export function armarFilas(
  hojas: { id: number; numero: string; productos: ProductoDeHoja[]; conteos: { productoId: number; empaques: LineaEmpaque[]; sueltas: number; confirmadoPorEscaner: boolean; contadoEn: string }[] }[],
  matriz: ItemDeLaMatriz[],
): FilaCorregible[] {
  const porCodigo = new Map(matriz.map((i) => [i.codigo, i] as const))
  return hojas.flatMap((hoja) =>
    hoja.productos.map((producto) => {
      const conteo = hoja.conteos.find((c) => c.productoId === producto.id) ?? null
      return {
        hojaId: hoja.id,
        numeroHoja: hoja.numero,
        producto,
        conteo,
        // `totalUnidades` y nunca una suma a mano: es la misma cuenta que usó
        // quien contó, así que lo que se ve acá es exactamente lo que se guardó.
        contado: conteo ? totalUnidades(conteo, producto.empaques) : null,
        // POR CÓDIGO: con `producto.id` esto queda null en toda ronda
        // posterior a la primera. Ver la cabecera.
        item: porCodigo.get(producto.codigo) ?? null,
      }
    }),
  )
}

/** Los que esperan una decisión: tienen diferencia contra el stock. */
export function sinCuadrar(filas: FilaCorregible[]): FilaCorregible[] {
  return filas.filter((f) => f.item !== null && (f.item.veredicto === 'falta' || f.item.veredicto === 'empresa'))
}

/** El estado del inventario es dato de lectura: esta pantalla nunca lo escribe. */
export type { EstadoDelInventario }

// ---------------------------------------------------------------------------
// La corrección masiva por Excel
// ---------------------------------------------------------------------------

/**
 * LA ADVERTENCIA, EN TÉRMINOS DEL NEGOCIO.
 *
 * El servidor manda el enum (`motivo-sin-cambio`); eso no se le muestra a
 * nadie. Y el texto no dice "advertencia": dice lo que probablemente pasó, que
 * es lo único que permite decidir si hay que volver al archivo.
 *
 * El `??` deja pasar un código que el servidor agregue mañana: un enum crudo
 * en pantalla es feo, pero una fila silenciada es un dato perdido.
 */
const TEXTO_ADVERTENCIA: Record<MotivoAdvertenciaFila, string> = {
  'motivo-sin-cambio': 'Escribiste un motivo y el número quedó igual: revisa si te faltó cambiarlo.',
}

export function textoDeAdvertencia(codigo: string): string {
  return TEXTO_ADVERTENCIA[codigo as MotivoAdvertenciaFila] ?? codigo
}

/**
 * ELEGIR EL .xlsx Y LEERLO, con el selector del navegador.
 *
 * Un `<input type="file">` suelto y no uno montado en el JSX: montado, elegir
 * DOS VECES EL MISMO ARCHIVO no dispara `change` —el `value` no cambió— y la
 * pantalla se queda muda justo cuando el auditor corrigió el Excel y lo volvió
 * a subir con el mismo nombre. Uno nuevo por vez no tiene estado que limpiar.
 *
 * `accept` filtra el diálogo, pero quien valida que sea el archivo bueno es el
 * backend, que lo abre y revisa sus columnas: un .xlsx con MIME genérico se
 * tiene que poder elegir igual.
 *
 * Resuelve `null` cuando se cancela, que NO es un error y no se avisa.
 */
export function elegirArchivoXlsx(): Promise<ArchivoElegido | null> {
  return new Promise((resolver, rechazar) => {
    const entrada = document.createElement('input')
    entrada.type = 'file'
    entrada.accept = '.xlsx'
    entrada.addEventListener('cancel', () => resolver(null))
    entrada.addEventListener('change', () => {
      const archivo = entrada.files?.[0]
      if (archivo === undefined) {
        resolver(null)
        return
      }
      archivo
        .arrayBuffer()
        .then((bytes) => resolver({ nombre: archivo.name, bytes }))
        .catch(() => rechazar(new Error('No se pudo leer el archivo elegido. Vuelve a intentarlo.')))
    })
    entrada.click()
  })
}
