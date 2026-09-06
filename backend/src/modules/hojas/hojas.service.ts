/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * sesion.service.ts). La logica pura vive en hojas.permisos.ts y
 * hojas.calculos.ts, testeadas sin base.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { estadoParaElFront, estadoTrasContar, totalUnidades, validarFactores } from './hojas.calculos';
import { validarAlcance, validarEscrituraDeHoja, validarLecturaDeHoja } from './hojas.permisos';
import type { GuardarConteoInput, ListarHojasQuery } from './hojas.schema';

// ---------------------------------------------------------------------------
// DTOs -- espejan mobile/lib/dominio/tipos.ts, NO el schema de Prisma.
//
// El front ya tiene su dominio; este backend lo SIRVE, no lo redefine (ver
// shared/tipos.ts). Por eso `estado` sale como "en-proceso" y no "en_proceso",
// y por eso `asignados` es un array de nombres y no dos columnas de ids.
// ---------------------------------------------------------------------------

export interface EmpaqueDto {
  nombre: string;
  factor: number;
  codigoBarras?: string;
}

export interface ProductoDto {
  id: number;
  codigo: string;
  codigoBarras: string;
  descripcion: string;
  /**
   * SIEMPRE al menos uno (`mobile/lib/dominio/tipos.ts#Producto.empaques`).
   * `[0]` = el que se ofrece primero al abrir el modal (Empaque.orden).
   */
  empaques: EmpaqueDto[];
  ubicacion?: string;
  /**
   * Categoria de Dynamics ("GALLETAS", "DETERGENTES EN POLVO"). Es UBICACION,
   * no stock: dice en que sector de la tienda esta el producto, y por eso no
   * viola el conteo ciego.
   *
   * Se omite cuando el ERP no la tiene, nunca se manda null -- mismo criterio
   * que `ubicacion`.
   *
   * SIN ESTO la hoja se rotula con su categoria dominante pero cada renglon
   * no dice de cual es, y en una hoja que cruza el limite entre dos sectores
   * el operario no sabe donde cambia. Estuvo guardandose en la base y sin
   * llegar a la pantalla hasta que se probo con el catalogo real.
   */
  categoria?: string;
}

/** tipos.ts#LineaEmpaque. */
export interface LineaEmpaqueDto {
  empaqueNombre: string;
  cantidad: number;
}

export interface ConteoDto {
  productoId: number;
  /** Varias lineas por producto (tipos.ts#Conteo.empaques): "2 cajas + 3 packs". */
  empaques: LineaEmpaqueDto[];
  sueltas: number;
  confirmadoPorEscaner: boolean;
  contadoEn: string;
}

export interface HojaDto {
  id: number;
  inventarioId: number;
  numero: string;
  zona: string;
  gondola: string;
  tamano: number;
  estado: 'pendiente' | 'en-proceso' | 'finalizada';
  sync: 'local' | 'sincronizando' | 'sincronizado' | 'error';
  asignados: string[];
  /**
   * ADITIVO (2026-09-06): los ids de `asignados`, en el MISMO orden --
   * `asignadoAId` es el id de `asignados[0]`, `asignadoA2Id` el de
   * `asignados[1]`. Antes de esto el cliente solo tenía el NOMBRE para
   * decidir "es mía" (`hojas_estructura.asignados`, mobile), y un nombre
   * es frágil: dos colaboradores con el mismo nombre en dos sucursales
   * distintas, o un cambio de nombre, rompen el filtro sin que nadie lo
   * note (ver el hallazgo real de hojas cruzadas entre Luzuriaga y
   * Bolívar, 2026-09-06). El id es la identidad dura que ya usa el
   * backend (`Colaborador.id`) y nunca cambia ni se repite.
   *
   * `asignados` (los nombres) NO se quita: sigue siendo lo que se
   * MUESTRA en pantalla ("Asignado: Elena Príncipe") -- los ids son para
   * FILTRAR, los nombres para LEER.
   */
  asignadoAId: number | null;
  asignadoA2Id: number | null;
  /**
   * ADITIVO (2026-09-06): cuantos productos de ESTA hoja no tienen ningun
   * Conteo cargado. Es el dato con el que el Coordinador valida antes de
   * cerrar la ronda -- decision del cliente: un FILTRO en Gestion de hojas,
   * no una notificacion.
   *
   * Se calcula acá y no en el cliente aunque `productos`/`conteos` viajen
   * completos: la pregunta "cuantos faltan" la hacen varias pantallas y
   * repetir el recorrido en cada una es como se desincronizan dos numeros
   * que deberian ser el mismo.
   *
   * OJO CON EL SIGNIFICADO EN UNA HOJA FINALIZADA: `finalizar` (min-4, en
   * curso) registra 0 en los productos sin conteo, asi que una hoja cerrada
   * deberia terminar en `productosSinConteo: 0`. Mientras eso no este, una
   * finalizada puede traer N > 0 -- son las que se cerraron antes de ese
   * cambio. Por eso el filtro de la pantalla aplica a hojas NO finalizadas:
   * ahi el numero significa "falta contar esto", que es lo accionable.
   */
  productosSinConteo: number;
  productos: ProductoDto[];
  conteos: ConteoDto[];
}

/**
 * OJO -- CONTEO CIEGO: no hay ningun campo de stock del ERP en estos DTOs, y
 * no se puede agregar. `mobile/lib/dominio/tipos.ts#Producto` no lo tiene a
 * proposito; el stock de Dynamics vive aparte (ItemAuditoria) y solo lo ve el
 * Auditor DESPUES de cerrado el ciclo. Un Contador que viera el stock antes
 * de contar dejaria de estar contando: estaria confirmando.
 */
function aProductoDto(p: {
  id: number;
  codigo: string;
  codigoBarras: string;
  descripcion: string;
  ubicacion: string | null;
  categoria: string | null;
  empaques: { nombre: string; factor: number; codigoBarras: string | null }[];
}): ProductoDto {
  return {
    id: p.id,
    codigo: p.codigo,
    codigoBarras: p.codigoBarras,
    descripcion: p.descripcion,
    // `codigoBarras` de cada empaque se OMITE cuando no hay, nunca se manda
    // null: el tipo del front lo declara opcional. Y va a faltar casi
    // siempre -- los codigos que devuelve Dynamics son todos de unidad
    // suelta, ninguno identifica un empaque (verificado con el catalogo real).
    empaques: p.empaques.map((e) => ({
      nombre: e.nombre,
      factor: e.factor,
      ...(e.codigoBarras === null ? {} : { codigoBarras: e.codigoBarras }),
    })),
    ...(p.ubicacion === null ? {} : { ubicacion: p.ubicacion }),
    ...(p.categoria === null ? {} : { categoria: p.categoria }),
  };
}

function aConteoDto(c: {
  productoId: number;
  empaques: { empaqueNombre: string; cantidad: number }[];
  sueltas: number;
  confirmadoPorEscaner: boolean;
  contadoEn: Date;
}): ConteoDto {
  return {
    productoId: c.productoId,
    empaques: c.empaques.map((l) => ({ empaqueNombre: l.empaqueNombre, cantidad: l.cantidad })),
    sueltas: c.sueltas,
    confirmadoPorEscaner: c.confirmadoPorEscaner,
    contadoEn: c.contadoEn.toISOString(),
  };
}

/** Lo que Prisma trae con productos y conteos incluidos. */
type HojaCompleta = {
  id: number;
  inventarioId: number;
  numero: string;
  zona: string;
  gondola: string;
  tamano: number;
  estado: 'pendiente' | 'en_proceso' | 'finalizada';
  sync: 'local' | 'sincronizando' | 'sincronizado' | 'error';
  asignadoA: { id: number; nombre: string } | null;
  asignadoA2: { id: number; nombre: string } | null;
  productos: Parameters<typeof aProductoDto>[0][];
  conteos: Parameters<typeof aConteoDto>[0][];
};

/**
 * Exportada para `inventarios.service.ts` (pasos 2 y 3 del wizard): ese
 * modulo devuelve las MISMAS hojas despues de crearlas o repartirlas, y
 * duplicar el mapeo significaria que el dia que se agregue un campo al DTO,
 * la pantalla lo vea al listar y no al crear.
 */
export function aHojaDto(h: HojaCompleta): HojaDto {
  return {
    id: h.id,
    inventarioId: h.inventarioId,
    numero: h.numero,
    zona: h.zona,
    gondola: h.gondola,
    tamano: h.tamano,
    estado: estadoParaElFront(h.estado),
    sync: h.sync,
    // Solo los nombres, y en el orden en que se asignaron. El front muestra
    // nombres (tipos.ts#HojaConteo.asignados: string[]) para LEER; los ids
    // de abajo son para FILTRAR (ver el comentario de HojaDto).
    asignados: [h.asignadoA?.nombre, h.asignadoA2?.nombre].filter((n): n is string => Boolean(n)),
    asignadoAId: h.asignadoA?.id ?? null,
    asignadoA2Id: h.asignadoA2?.id ?? null,
    productosSinConteo: contarSinConteo(h),
    productos: h.productos.map(aProductoDto),
    conteos: h.conteos.map(aConteoDto),
  };
}

/**
 * Productos de la hoja que no tienen NINGUN conteo.
 *
 * Un `Set` y no un `some()` por producto: con 50 productos y 50 conteos, la
 * version cuadratica son 2.500 comparaciones por hoja y el Coordinador pide
 * las 25 hojas de una. No es prematuro -- es la diferencia entre una
 * pantalla que abre y una que se piensa.
 *
 * Cuenta por PRODUCTO, no por conteo: `Conteo` tiene @@unique([hojaId,
 * productoId]) (schema.prisma), asi que no hay dos filas del mismo producto,
 * pero el Set lo deja explicito y sobrevive si esa regla cambia.
 */
function contarSinConteo(h: HojaCompleta): number {
  const contados = new Set(h.conteos.map((c) => c.productoId));
  return h.productos.reduce((n, p) => (contados.has(p.id) ? n : n + 1), 0);
}

export const INCLUIR_TODO = Prisma.validator<Prisma.HojaConteoInclude>()({
  // `id` además de `nombre` (aditivo): ver el comentario de `HojaDto.asignadoAId`.
  asignadoA: { select: { id: true, nombre: true } },
  asignadoA2: { select: { id: true, nombre: true } },
  /**
   * ORDEN DE LOS PRODUCTOS DENTRO DE LA HOJA: por CATEGORIA y despues por
   * codigo. No es cosmetico -- es el recorrido que hace la persona.
   *
   * Estuvo ordenado solo por `codigo` y se veia bien, porque los codigos de
   * Dynamics agrupan por familia CASI siempre. Casi. Medido sobre el
   * catalogo real (hoja 006 de MARKET BOLIVAR): 8 categorias y **11 vueltas
   * a un sector ya barrido** -- detergentes, desinfectantes, chocolates,
   * y de nuevo detergentes. El operario cruzaba el local once veces dentro
   * de UNA hoja.
   *
   * Las hojas se CREAN ordenadas por categoria (inventarios.service.ts), asi
   * que sin este orderBy el trabajo de ordenarlas se perdia al leerlas.
   *
   * `nulls: 'last'`: los que el ERP no clasifico van al final, juntos, igual
   * que en dominio/lote.ts#ordenarParaContar. Sin esto Postgres los pone
   * PRIMERO en ASC, y la hoja arrancaria por lo que nadie sabe donde esta.
   *
   * `orden: 'asc'` en empaques por otra razon: Postgres no garantiza orden
   * estable sin ORDER BY, y `[0]` importa (es el empaque que se ofrece
   * primero al abrir el modal).
   */
  productos: {
    orderBy: [{ categoria: { sort: 'asc', nulls: 'last' } }, { codigo: 'asc' }],
    include: { empaques: { orderBy: { orden: 'asc' } } },
  },
  conteos: { include: { empaques: true } },
  // `Prisma.validator` y no `as const`: con `as const` el `orderBy` queda
  // `readonly` y Prisma pide un array mutable; sin nada, TypeScript infiere
  // `string` donde hacen falta los literales `'asc'`. El validator da las
  // dos cosas -- literales y mutable -- y ademas valida la forma contra el
  // schema en tiempo de compilacion.
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export async function listar(actor: ColaboradorAutenticado, query: ListarHojasQuery): Promise<HojaDto[]> {
  validarAlcance(actor, query.alcance);

  const inventario = await prisma.inventario.findUnique({
    where: { id: query.inventarioId },
    select: { id: true, sucursalId: true },
  });
  if (!inventario) throw new NoEncontrado('Ese inventario no existe.');

  // Antes de leer nada: el inventario tiene que ser de la sucursal del actor.
  if (actor.rol !== 'administrador' && actor.sucursalId !== inventario.sucursalId) {
    throw new NoEncontrado('Ese inventario no existe.');
  }

  /**
   * `mias` filtra EN LA CONSULTA, no despues en memoria. No es una
   * optimizacion: filtrar despues significa que las hojas ajenas viajaron
   * desde la base hasta este proceso, y basta un `console.log` o un error
   * que serialice el objeto para que el conteo de otro quede expuesto. Lo
   * que no se pide, no se trae.
   */
  const filtroDeAlcance =
    query.alcance === 'mias'
      ? { OR: [{ asignadoAId: actor.colaboradorId }, { asignadoA2Id: actor.colaboradorId }] }
      : {};

  const hojas = await prisma.hojaConteo.findMany({
    where: {
      inventarioId: query.inventarioId,
      numeroConteo: query.ronda,
      ...(query.numero ? { numero: query.numero } : {}),
      ...filtroDeAlcance,
    },
    orderBy: { numero: 'asc' },
    include: INCLUIR_TODO,
  });

  return hojas.map(aHojaDto);
}

/** Busca la hoja y valida el acceso de lectura. Uso interno del modulo. */
async function hojaParaLeer(actor: ColaboradorAutenticado, hojaId: number): Promise<HojaCompleta> {
  const hoja = await prisma.hojaConteo.findUnique({
    where: { id: hojaId },
    include: { ...INCLUIR_TODO, inventario: { select: { sucursalId: true } } },
  });
  if (!hoja) throw new NoEncontrado('Esa hoja no existe.');

  validarLecturaDeHoja(actor, {
    sucursalId: hoja.inventario.sucursalId,
    asignadoAId: hoja.asignadoAId,
    asignadoA2Id: hoja.asignadoA2Id,
  });
  return hoja;
}

export async function detalle(actor: ColaboradorAutenticado, hojaId: number): Promise<HojaDto> {
  return aHojaDto(await hojaParaLeer(actor, hojaId));
}

export async function productosDeHoja(actor: ColaboradorAutenticado, hojaId: number): Promise<ProductoDto[]> {
  return (await hojaParaLeer(actor, hojaId)).productos.map(aProductoDto);
}

/**
 * Busca dentro de ESA hoja. Devolver 404 cuando el codigo no pertenece a la
 * hoja no es un detalle tecnico: es el caso de la gondola, donde el producto
 * de al lado entra en cuadro del escaner, y el front lo traduce a "este
 * codigo no pertenece a la hoja" en vez de contar el item equivocado.
 *
 * Matchea contra el codigo de la UNIDAD suelta y tambien contra el del
 * EMPAQUE: la caja de 12 puede traer un codigo propio, y escanearla tiene que
 * resolver al mismo producto.
 */
export async function productoPorCodigoBarras(
  actor: ColaboradorAutenticado,
  hojaId: number,
  codigo: string,
): Promise<ProductoDto> {
  await hojaParaLeer(actor, hojaId);

  const producto = await prisma.producto.findFirst({
    where: { hojaId, OR: [{ codigoBarras: codigo }, { empaques: { some: { codigoBarras: codigo } } }] },
    include: { empaques: { orderBy: { orden: 'asc' } } },
  });
  if (!producto) throw new NoEncontrado('Ese codigo no pertenece a esta hoja.');

  return aProductoDto(producto);
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * GUARDA O CORRIGE el conteo de un producto. Devuelve el total calculado
 * junto al conteo -- calculado, nunca leido de una columna (ver
 * hojas.calculos.ts).
 *
 * IDEMPOTENTE. Es la regla que sostiene toda la cola de sincronizacion del
 * telefono: cuando vuelve el WiFi, la cola reintenta, y el MISMO conteo puede
 * llegar dos o tres veces. Un conteo duplicado corrompe el inventario, y todo
 * este sistema existe para que los numeros cierren.
 *
 * Se resuelve con un `upsert` sobre `@@unique([hojaId, productoId])`, que ya
 * existe en el schema: la identidad de un conteo ES el par (hoja, producto),
 * no una fila nueva por envio. Mandar el mismo conteo N veces deja
 * exactamente el mismo estado que mandarlo una.
 *
 * No hace falta que el cliente mande un id de operacion, y es mejor asi: la
 * cola del front ya deduplica por (hojaId, tipo, productoId) --
 * sqlite-cola.ts#claveDedup-- o sea que las dos puntas coinciden en cual es
 * la identidad de la operacion, sin un identificador extra que mantener
 * sincronizado entre ambas.
 */
export async function guardarConteo(
  actor: ColaboradorAutenticado,
  hojaId: number,
  productoId: number,
  input: GuardarConteoInput,
): Promise<{ conteo: ConteoDto; total: number; estadoHoja: HojaDto['estado'] }> {
  const hoja = await prisma.hojaConteo.findUnique({
    where: { id: hojaId },
    select: {
      id: true,
      estado: true,
      asignadoAId: true,
      asignadoA2Id: true,
      inventario: { select: { sucursalId: true } },
    },
  });
  if (!hoja) throw new NoEncontrado('Esa hoja no existe.');

  validarEscrituraDeHoja(actor, {
    sucursalId: hoja.inventario.sucursalId,
    asignadoAId: hoja.asignadoAId,
    asignadoA2Id: hoja.asignadoA2Id,
  });

  /**
   * UNA HOJA FINALIZADA ES INMUTABLE. Decision del cliente: se corrige
   * mientras no este finalizada, despues no.
   *
   * 409 y no 400 a proposito: el dato que mando el telefono NO esta mal --
   * puede ser un conteo perfectamente valido que quedo en la cola offline y
   * llego tarde, despues de que alguien finalizara la hoja. Es un CONFLICTO
   * de estado, no un error de forma, y la app necesita distinguirlos para
   * decidir que hacer con un conteo que ya tenia guardado local y el servidor
   * rechaza (ver backend/README.md).
   */
  if (hoja.estado === 'finalizada') {
    throw new Conflicto('La hoja ya esta finalizada: no se puede corregir el conteo.');
  }

  const producto = await prisma.producto.findFirst({
    where: { id: productoId, hojaId },
    select: { id: true, empaques: { select: { nombre: true, factor: true } } },
  });
  // El producto tiene que ser DE ESTA HOJA: sin el `hojaId` en el where, se
  // podria escribir un conteo de la hoja A usando un producto de la hoja B.
  if (!producto) throw new NoEncontrado('Ese producto no pertenece a esta hoja.');

  validarFactores(producto.empaques);
  // Se calcula ANTES de escribir nada: si una linea referencia un empaque
  // que el producto no tiene, `totalUnidades` tira y no se persiste un
  // conteo a medio validar (ver el comentario de esa funcion).
  const total = totalUnidades(input, producto.empaques);

  const datosComunes = {
    sueltas: input.sueltas,
    confirmadoPorEscaner: input.confirmadoPorEscaner,
    contadoEn: input.contadoEn,
  };
  const lineas = input.empaques.map((l) => ({ empaqueNombre: l.empaqueNombre, cantidad: l.cantidad }));

  /**
   * Transaccion: el conteo y el cambio de estado de la hoja son un solo
   * hecho. Si se guardara el conteo y fallara el estado, la hoja quedaria
   * "pendiente" con items contados -- y el avance que ve el operario mentiria.
   *
   * `deleteMany` + `create` en el update: cada guardado reemplaza la lista
   * de lineas ENTERA, no la mezcla con la anterior -- mismo criterio que
   * ModalConteo.tsx, que siempre manda el estado completo del borrador, no
   * un delta. Corregir "me equivoque, era 1 caja no 2" no puede dejar
   * lineas viejas huerfanas.
   */
  const [conteo] = await prisma.$transaction([
    prisma.conteo.upsert({
      where: { hojaId_productoId: { hojaId, productoId } },
      create: { hojaId, productoId, ...datosComunes, empaques: { create: lineas } },
      update: { ...datosComunes, empaques: { deleteMany: {}, create: lineas } },
      include: { empaques: true },
    }),
    prisma.hojaConteo.update({
      where: { id: hojaId },
      data: { estado: estadoTrasContar(hoja.estado), sync: 'sincronizado' },
    }),
  ]);

  return {
    conteo: aConteoDto(conteo),
    total,
    estadoHoja: estadoParaElFront(estadoTrasContar(hoja.estado)),
  };
}

/**
 * PUNTO DE NO RETORNO. Despues de esto `guardarConteo` rechaza con 409.
 *
 * Tambien es idempotente, y por la misma razon que el conteo: `finalizar` es
 * un item mas de la cola offline (sqlite-cola.ts, tipo 'finalizar') y se
 * reintenta igual. Finalizar dos veces devuelve la hoja finalizada, no un
 * error -- si tirara 409, la cola dejaria el item en `error` para siempre
 * por haber hecho exactamente lo que se le pidio.
 */
export async function finalizar(actor: ColaboradorAutenticado, hojaId: number): Promise<HojaDto> {
  const hoja = await prisma.hojaConteo.findUnique({
    where: { id: hojaId },
    select: {
      id: true,
      estado: true,
      asignadoAId: true,
      asignadoA2Id: true,
      inventario: { select: { sucursalId: true } },
    },
  });
  if (!hoja) throw new NoEncontrado('Esa hoja no existe.');

  validarEscrituraDeHoja(actor, {
    sucursalId: hoja.inventario.sucursalId,
    asignadoAId: hoja.asignadoAId,
    asignadoA2Id: hoja.asignadoA2Id,
  });

  if (hoja.estado !== 'finalizada') {
    /**
     * DECISIÓN DEL CLIENTE (2026-09-05): al finalizar, un renglón SIN CONTAR
     * no queda como "faltan N" -- se registra un Conteo en 0 explícito ("si
     * no hay el producto, es 0"). Es una AFIRMACIÓN de quien finaliza la hoja
     * ("miré la góndola, no hay"), no el cero automático que
     * `dominio/ciclo-conteos.ts` (115-127) prohíbe para lo que NADIE miró:
     * ahí sigue vigente que un ítem jamás mirado NO se asume cero -- lo que
     * cambia es que finalizar ES ese acto humano de mirar y cerrar.
     *
     * Ojo, deja desactualizada una premisa escrita en otro lado: el
     * comentario de `rondas.service.ts#cerrar` ("Este cierre NO los da por
     * cero") describe el estado ANTERIOR a este cambio. El cierre sigue sin
     * tocar nada -- es `finalizar` el que ahora deja esos 0, y el cierre los
     * trata como cualquier conteo real: 0 vs stock > 0 = diferencia y va a
     * recontar; 0 vs stock 0 = cuadra (ver ciclo-conteos.ts#destinoTrasRonda).
     *
     * Se registran los 0 con el actor que finaliza (la hoja ya es suya:
     * `validarEscrituraDeHoja` lo exige arriba) -- el Conteo no lleva
     * colaborador propio, la autoría vive en el asignado de la hoja.
     *
     * En la MISMA transacción que el cambio de estado: escribir los 0 y que
     * fallara el `finalizada` dejaría ceros inventados en una hoja sin cerrar.
     * `createMany` + `skipDuplicates` sobre @@unique([hojaId, productoId]) es
     * lo que lo hace seguro contra la carrera con un conteo REAL que llegue
     * entre la lectura de `sinContar` y esta escritura: si ya existe un
     * Conteo para ese producto, se saltea y NUNCA lo pisa con 0.
     */
    const sinContar = await prisma.producto.findMany({
      where: { hojaId, conteos: { none: {} } },
      select: { id: true },
    });
    const contadoEn = new Date();

    await prisma.$transaction([
      prisma.conteo.createMany({
        data: sinContar.map((p) => ({ hojaId, productoId: p.id, sueltas: 0, contadoEn })),
        skipDuplicates: true,
      }),
      prisma.hojaConteo.update({
        where: { id: hojaId },
        data: { estado: 'finalizada', sync: 'sincronizado' },
      }),
    ]);
  }

  return detalle(actor, hojaId);
}
