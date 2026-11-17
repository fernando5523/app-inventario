import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOTIVO_MINIMO,
  STOCK_NO_SE_CORRIGE,
  armarFilas,
  elegirArchivoXlsx,
  errorDeMotivo,
  faseDeCierre,
  motivoSinCorregir,
  ordinal,
  puedeCorregirLoContado,
  sinCuadrar,
  textoDeAdvertencia,
  textoItemSalioDeRonda,
  textoRondaQueYaNoExiste,
  textoStockDeLaMedicion,
  totalUnidades,
} from './reglas'
import type { InventarioActivo, ItemDeLaMatriz, ProductoDeHoja } from './tipos'

const inventario = (over: Partial<InventarioActivo> = {}): InventarioActivo => ({
  inventarioId: 8088,
  estado: 'en_curso',
  rondaActiva: 2,
  ultimaRondaCerrada: 1,
  totalHojas: 2,
  items: 60,
  ...over,
})

describe('en qué momento del cierre está el inventario', () => {
  it('sin inventario abierto no hay fase', () => {
    expect(faseDeCierre(null)).toBeNull()
  })

  it('el ajuste del auditor gana sobre todo lo demás', () => {
    expect(faseDeCierre(inventario({ estado: 'ajuste_auditor' }))).toBe('ajuste')
  })

  it('cualquier estado que no sea en curso ni ajuste ya cerró', () => {
    for (const estado of ['conteo_cerrado', 'liquidado', 'lacrado', 'anulado'] as const) {
      expect(faseDeCierre(inventario({ estado }))).toBe('cerrado')
    }
  })

  it('sin hojas repartidas no hay conteo que haya terminado', () => {
    expect(faseDeCierre(inventario({ totalHojas: 0, rondaActiva: null }))).toBe('sin-hojas')
  })

  it('contando: la ronda vigente es más alta que la última cerrada', () => {
    expect(faseDeCierre(inventario({ rondaActiva: 2, ultimaRondaCerrada: 1 }))).toBe('contando')
  })

  /**
   * EL BORDE EXACTO. `rondaActiva` es `max(numeroConteo)` y sigue siendo un
   * número después de cerrar: con todo cuadrado no se crea la ronda siguiente,
   * así que sin la marca propia esto se leería como "todavía contando".
   */
  it('rondas cerradas: la última cerrada alcanzó a la vigente', () => {
    expect(faseDeCierre(inventario({ rondaActiva: 2, ultimaRondaCerrada: 2 }))).toBe('rondas-cerradas')
  })
})

describe('cuándo está abierta la vía de corrección', () => {
  it('se corrige contando y con las rondas cerradas', () => {
    expect(puedeCorregirLoContado('contando')).toBe(true)
    expect(puedeCorregirLoContado('rondas-cerradas')).toBe(true)
  })

  /** La ventana se cierra al empezar el ajuste: lo sostiene el servidor con un 409. */
  it('no se corrige en el ajuste, ni cerrado, ni sin hojas', () => {
    expect(puedeCorregirLoContado('ajuste')).toBe(false)
    expect(puedeCorregirLoContado('cerrado')).toBe(false)
    expect(puedeCorregirLoContado('sin-hojas')).toBe(false)
    expect(puedeCorregirLoContado(null)).toBe(false)
  })

  it('mientras se puede, no hay motivo que dar', () => {
    expect(motivoSinCorregir('contando')).toBeNull()
    expect(motivoSinCorregir('rondas-cerradas')).toBeNull()
  })

  /**
   * ESTE PORTAL ES DEL AUDITOR: el texto del ajuste le habla a él. Decirle "el
   * auditor ya empezó" AL AUDITOR lo dejaría buscando a otra persona.
   */
  it('en el ajuste el motivo le habla al auditor, no de un tercero', () => {
    const motivo = motivoSinCorregir('ajuste') ?? ''
    expect(motivo).toContain('Ya empezaste el ajuste final')
    expect(motivo).toContain('Ajuste final del conteo')
    expect(motivo).not.toContain('El auditor ya empezó')
  })

  /** Cada motivo se destraba distinto: ninguno puede compartir texto con otro. */
  it('los tres motivos son textos distintos', () => {
    const motivos = (['ajuste', 'cerrado', 'sin-hojas'] as const).map((f) => motivoSinCorregir(f))
    expect(new Set(motivos).size).toBe(3)
  })

  /** Se le muestra al Auditor: nada de endpoint, backend ni API. */
  it('ningún motivo habla de detalles técnicos', () => {
    for (const fase of ['ajuste', 'cerrado', 'sin-hojas'] as const) {
      const texto = (motivoSinCorregir(fase) ?? '').toLowerCase()
      for (const tecnico of ['endpoint', 'backend', 'api', '409', 'http']) {
        expect(texto).not.toContain(tecnico)
      }
    }
  })
})

describe('el motivo del cambio', () => {
  it('vacío pide escribirlo, y dice para qué', () => {
    const error = errorDeMotivo('   ') ?? ''
    expect(error).toContain('queda registrado')
  })

  /** El piso es nuestro y es más alto que el del servidor (3): con 1 pasa un ".". */
  it('un motivo corto no alcanza, y el mensaje dice cuánto falta', () => {
    expect(errorDeMotivo('x')).toContain(String(MOTIVO_MINIMO))
    expect(errorDeMotivo('.')).not.toBeNull()
    expect(errorDeMotivo('mal')).not.toBeNull()
  })

  it('con el mínimo ya sirve, sin contar los espacios de los bordes', () => {
    expect(errorDeMotivo('  mal cargado  ')).toBeNull()
    expect(errorDeMotivo('12345')).toBeNull()
  })
})

describe('cuántas unidades suma un conteo', () => {
  const empaques: ProductoDeHoja['empaques'] = [
    { nombre: 'Emp.12', factor: 12 },
    { nombre: 'Emp.6', factor: 6 },
  ]

  it('los empaques por su factor, más las sueltas', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Emp.12', cantidad: 2 }], sueltas: 3 }, empaques)).toBe(27)
  })

  it('suma más de un empaque a la vez', () => {
    const conteo = {
      empaques: [
        { empaqueNombre: 'Emp.12', cantidad: 1 },
        { empaqueNombre: 'Emp.6', cantidad: 2 },
      ],
      sueltas: 1,
    }
    expect(totalUnidades(conteo, empaques)).toBe(25)
  })

  it('solo sueltas también es un conteo', () => {
    expect(totalUnidades({ empaques: [], sueltas: 7 }, empaques)).toBe(7)
  })

  /**
   * Una línea cuyo empaque no existe en el producto se IGNORA. Contarla como 0
   * daría un total que parece bueno y está mal; el caso no debería ocurrir y
   * por eso es una red, no una rama de negocio.
   */
  it('una línea con un empaque que el producto no tiene no se inventa un factor', () => {
    expect(totalUnidades({ empaques: [{ empaqueNombre: 'Emp.99', cantidad: 5 }], sueltas: 2 }, empaques)).toBe(2)
  })
})

describe('contra qué stock se midió la fila', () => {
  it('con el stock de su propia ronda no hay nada que explicar', () => {
    expect(
      textoStockDeLaMedicion({ stockErp: 10, rondaDelConteo: 1, rondaDelStock: 1, cayoALaRonda1: false }),
    ).toBeNull()
  })

  it('sin stock no se explica nada', () => {
    expect(
      textoStockDeLaMedicion({ stockErp: null, rondaDelConteo: 2, rondaDelStock: null, cayoALaRonda1: false }),
    ).toBeNull()
  })

  /**
   * "Faltan 3" contra el stock del día y "faltan 3" contra el del día 22 no son
   * la misma afirmación, y de eso sale un descuento: la caída se dice con
   * palabras.
   */
  it('la caída a la ronda 1 se dice con palabras', () => {
    const texto = textoStockDeLaMedicion({ stockErp: 10, rondaDelConteo: 3, rondaDelStock: 1, cayoALaRonda1: true }) ?? ''
    expect(texto).toContain('3er conteo')
    expect(texto).toContain('1er conteo')
  })

  it('el stock propio de una ronda posterior también se nombra', () => {
    const texto = textoStockDeLaMedicion({ stockErp: 8, rondaDelConteo: 2, rondaDelStock: 2, cayoALaRonda1: false }) ?? ''
    expect(texto).toContain('2do conteo')
  })

  /** Sin tecnicismos: quien lee no sabe qué es un ERP. */
  it('habla del sistema, no del ERP', () => {
    const texto = textoStockDeLaMedicion({ stockErp: 10, rondaDelConteo: 3, rondaDelStock: 1, cayoALaRonda1: true }) ?? ''
    expect(texto).not.toContain('ERP')
    expect(texto).toContain('sistema')
  })
})

describe('qué se le dice después de corregir', () => {
  it('el caso normal: ahora cuadra y sale de la ronda', () => {
    const texto = textoItemSalioDeRonda({ codigo: '100150', ronda: 2, hojaBorrada: false, rondaBorrada: false })
    expect(texto).toContain('100150')
    expect(texto).toContain('2do conteo')
    expect(texto).toContain('cuadra')
  })

  it('si su hoja quedó sin ítems, se dice', () => {
    expect(textoItemSalioDeRonda({ codigo: 'A', ronda: 2, hojaBorrada: true, rondaBorrada: false })).toContain('hoja')
  })

  /** La ronda borrada gana sobre la hoja: es la consecuencia más grande. */
  it('si era el último ítem de la ronda, eso es lo que se dice', () => {
    const texto = textoItemSalioDeRonda({ codigo: 'A', ronda: 3, hojaBorrada: true, rondaBorrada: true })
    expect(texto).toContain('ya no hace falta')
  })

  it('cuando la ronda que se miraba desapareció, se dice a cuál se volvió', () => {
    const texto = textoRondaQueYaNoExiste(3, 2)
    expect(texto).toContain('3er conteo')
    expect(texto).toContain('2do conteo')
  })
})

describe('las filas de la pantalla', () => {
  const producto = (id: number, codigo: string, categoria?: string): ProductoDeHoja => ({
    id,
    codigo,
    codigoBarras: `BAR${id}`,
    descripcion: `PRODUCTO ${codigo}`,
    empaques: [{ nombre: 'Emp.12', factor: 12 }],
    ...(categoria === undefined ? {} : { categoria }),
  })

  /**
   * EL ÍTEM TAL COMO LO DEVUELVE LA MATRIZ, y el `productoId` NO es el de la
   * hoja a propósito: la matriz entrega siempre el de la RONDA 1, y las hojas
   * de un reconteo traen otro para el mismo artículo. El cruce se hace por
   * CÓDIGO; un fixture donde los dos ids coincidieran escondería justo eso.
   */
  const item = (codigo: string, over: Partial<ItemDeLaMatriz> = {}): ItemDeLaMatriz => ({
    productoId: 7045,
    codigo,
    descripcion: 'D',
    hoja: '001',
    stockErp: 10,
    conteos: [8],
    conteoFinal: 8,
    diferenciaUnidades: -2,
    veredicto: 'falta',
    stockDeLaMedicion: { stockErp: 10, rondaDelConteo: 1, rondaDelStock: 1, cayoALaRonda1: false },
    ...over,
  })

  const hoja = {
    id: 500,
    numero: '001',
    productos: [producto(1, '100150', 'ACEITES ENVASADOS'), producto(2, '100151', 'LICOR-VINO TINTO DULCE')],
    conteos: [
      { productoId: 1, empaques: [{ empaqueNombre: 'Emp.12', cantidad: 1 }], sueltas: 2, confirmadoPorEscaner: false, contadoEn: 'x' },
    ],
  }

  it('cruza las hojas con la matriz y calcula lo contado', () => {
    const filas = armarFilas([hoja], [item('100150')])
    expect(filas).toHaveLength(2)
    expect(filas[0].hojaId).toBe(500)
    expect(filas[0].numeroHoja).toBe('001')
    // 1 × 12 + 2 sueltas.
    expect(filas[0].contado).toBe(14)
    expect(filas[0].item?.veredicto).toBe('falta')
  })

  /**
   * Un producto sin conteo queda con `contado: null`, nunca con 0: "nadie lo
   * contó" es distinto de "contó cero", y un 0 ahí se leería como una
   * afirmación de quien fue a la góndola.
   */
  it('un producto sin conteo no se cuenta como cero', () => {
    const filas = armarFilas([hoja], [item('100150')])
    expect(filas[1].conteo).toBeNull()
    expect(filas[1].contado).toBeNull()
  })

  /** Un producto que la matriz no trajo queda sin stock y sin diferencia. */
  it('un producto que la matriz no trajo queda sin item', () => {
    const filas = armarFilas([hoja], [item('100150')])
    expect(filas[1].item).toBeNull()
  })

  /**
   * EL BUG DEL 2026-10-13: la categoría salía de `zona`, que es la del BLOQUE
   * con el que se armó la hoja y vale lo mismo para todos sus ítems. Un vino
   * aparecía como detergente. La fila conserva la del PRODUCTO, que es la que
   * viene de Dynamics y es distinta ítem por ítem.
   */
  it('cada fila conserva la categoría de SU producto, no una del lote', () => {
    const filas = armarFilas([hoja], [item('100150'), item('100151')])
    expect(filas.map((f) => f.producto.categoria)).toEqual(['ACEITES ENVASADOS', 'LICOR-VINO TINTO DULCE'])
    expect(new Set(filas.map((f) => f.producto.categoria)).size).toBe(2)
  })

  it('sin cuadrar son los que tienen diferencia contra el stock', () => {
    const filas = armarFilas([hoja], [item('100150', { veredicto: 'falta' }), item('100151', { veredicto: 'cuadrado' })])
    expect(sinCuadrar(filas).map((f) => f.producto.id)).toEqual([1])
  })

  /** Los de empresa también esperan una decisión, aunque la empresa los absorba. */
  it('los de empresa cuentan como sin cuadrar', () => {
    const filas = armarFilas([hoja], [item('100150', { veredicto: 'empresa' })])
    expect(sinCuadrar(filas)).toHaveLength(1)
  })

  it('los que no tiene la matriz no se cuentan como sin cuadrar: no hay con qué afirmarlo', () => {
    const filas = armarFilas([hoja], [])
    expect(sinCuadrar(filas)).toHaveLength(0)
  })

  /**
   * -------------------------------------------------------------------------
   * EL BUG QUE MENTÍA EN SILENCIO: el cruce iba por `productoId`
   * -------------------------------------------------------------------------
   * El mismo artículo es un `Producto` distinto en cada hoja de cada ronda, y
   * la matriz devuelve el de la RONDA 1. Los números son los del inventario
   * 8078 medidos contra la base: el código 100150 es el producto 7045 en la
   * ronda 1 y el 8030 en la 2.
   *
   * Cruzando por id, corregir la ronda 2 o cualquier posterior dejaba `item`
   * en null para TODAS las filas -- sin stock, sin diferencia y con "Sin
   * cuadrar" vacío --, y sin un solo error a la vista. Este caso falla si
   * alguien vuelve a cruzar por id.
   */
  it('encuentra el ítem al corregir una ronda posterior a la primera', () => {
    // La hoja es de la ronda 2: su producto es el 8030, no el 7045 que trae la matriz.
    const hojaDeLaRonda2 = {
      id: 305,
      numero: '001',
      productos: [producto(8030, '100150')],
      conteos: [{ productoId: 8030, empaques: [], sueltas: 4, confirmadoPorEscaner: false, contadoEn: 'x' }],
    }

    const [fila] = armarFilas([hojaDeLaRonda2], [item('100150', { stockErp: 6 })])

    expect(fila.item).not.toBeNull()
    expect(fila.item?.stockErp).toBe(6)
    expect(sinCuadrar([fila])).toHaveLength(1)
  })
})

describe('el texto de la regla del stock', () => {
  /**
   * COPIA LITERAL de `STOCK_NO_SE_CORRIGE` en la app móvil. Es regla textual
   * del cliente, y dos redacciones distintas de la misma regla abren la puerta
   * a que una insinúe que el stock se toca.
   */
  it('dice que el stock no se corrige y que lo que cambia es lo contado', () => {
    expect(STOCK_NO_SE_CORRIGE).toBe(
      'El stock viene del sistema y no se corrige desde aquí: está para comparar. Lo que cambias es lo que se contó.',
    )
  })
})

describe('los ordinales', () => {
  it('son los mismos que nombran las rondas en la app móvil', () => {
    expect([1, 2, 3, 4, 5].map(ordinal)).toEqual(['1er', '2do', '3er', '4to', '5to'])
  })

  it('más allá del noveno no se inventa una forma rara', () => {
    expect(ordinal(12)).toBe('12º')
  })
})

describe('las advertencias de la importación', () => {
  /**
   * El enum del servidor no se le muestra a nadie, y el texto no dice
   * "advertencia": dice lo que probablemente pasó, que es lo único que permite
   * decidir si hay que volver al archivo.
   */
  it('traduce la única que manda el servidor a lo que probablemente pasó', () => {
    expect(textoDeAdvertencia('motivo-sin-cambio')).toBe(
      'Escribiste un motivo y el número quedó igual: revisa si te faltó cambiarlo.',
    )
  })

  /** Un código nuevo del servidor se muestra crudo: feo, pero no silenciado. */
  it('no se come una advertencia que todavía no sabe traducir', () => {
    expect(textoDeAdvertencia('algo-que-el-servidor-agregue')).toBe('algo-que-el-servidor-agregue')
  })
})

describe('elegir el archivo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Captura el <input> que crea `elegirArchivoXlsx` para poder dispararle los
   * eventos que en un navegador real dispara la persona.
   */
  function interceptarElInput(): () => HTMLInputElement {
    let creado: HTMLInputElement | null = null
    const original = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((etiqueta: string) => {
      const elemento = original(etiqueta as 'input')
      if (etiqueta === 'input') creado = elemento as HTMLInputElement
      return elemento
    })
    return () => {
      if (creado === null) throw new Error('No se creó ningún input')
      return creado
    }
  }

  it('devuelve el nombre y los bytes del archivo elegido', async () => {
    const tomarInput = interceptarElInput()
    const promesa = elegirArchivoXlsx()
    const input = tomarInput()

    const archivo = new File([new Uint8Array([80, 75, 3, 4])], 'conteos-2026-09-suc3.xlsx')
    Object.defineProperty(input, 'files', { value: [archivo] })
    input.dispatchEvent(new Event('change'))

    const elegido = await promesa
    expect(elegido?.nombre).toBe('conteos-2026-09-suc3.xlsx')
    // Los bytes crudos: son los que viajan al servidor sin que nadie los toque.
    expect([...new Uint8Array(elegido!.bytes)]).toEqual([80, 75, 3, 4])
  })

  /** Cancelar NO es un error: la pantalla no avisa nada. */
  it('resuelve null cuando se cancela el diálogo', async () => {
    const tomarInput = interceptarElInput()
    const promesa = elegirArchivoXlsx()
    tomarInput().dispatchEvent(new Event('cancel'))
    await expect(promesa).resolves.toBeNull()
  })

  /**
   * EL BUG QUE EVITA EL INPUT SUELTO: con uno montado en el JSX, elegir dos
   * veces el MISMO archivo no dispara `change` -- el `value` no cambió -- y la
   * pantalla se queda muda justo cuando el auditor corrigió el Excel y lo
   * volvió a subir con el mismo nombre. Cada llamada crea el suyo.
   */
  it('crea un input nuevo por llamada, así el mismo archivo se puede subir dos veces', async () => {
    const tomarInput = interceptarElInput()
    const archivo = new File([new Uint8Array([1])], 'mismo.xlsx')

    const primera = elegirArchivoXlsx()
    const input1 = tomarInput()
    Object.defineProperty(input1, 'files', { value: [archivo] })
    input1.dispatchEvent(new Event('change'))
    await primera

    const segunda = elegirArchivoXlsx()
    const input2 = tomarInput()
    expect(input2).not.toBe(input1)
    Object.defineProperty(input2, 'files', { value: [archivo] })
    input2.dispatchEvent(new Event('change'))
    await expect(segunda).resolves.toMatchObject({ nombre: 'mismo.xlsx' })
  })
})
