/**
 * Unico archivo del modulo que toca Prisma (regla de capas dura, ver
 * sesion.service.ts). La logica pura vive en hojas.permisos.ts y
 * hojas.calculos.ts, testeadas sin base.
 */

import { prisma } from '../../config/database';
import { Conflicto, NoEncontrado } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { estadoParaElFront, estadoTrasContar, validarFactor } from './hojas.calculos';
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
   *
   * Hoy la base guarda UN empaque por producto en columnas planas
   * (prisma/schema.prisma#Producto), asi que este array trae exactamente un
   * elemento. Se sirve como array igual, y no como objeto suelto, porque el
   * dominio del front ya modela varios: cuando el schema crezca a N empaques
   * cambia el MAPEO de aca abajo y no la forma de la respuesta, que es lo
   * que rompe pantallas.
   */
  empaques: EmpaqueDto[];
  ubicacion?: string;
}

export interface ConteoDto {
  productoId: number;
  empaques: number;
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
  empaqueNombre: string;
  empaqueFactor: number;
  empaqueCodigoBarras: string | null;
}): ProductoDto {
  return {
    id: p.id,
    codigo: p.codigo,
    codigoBarras: p.codigoBarras,
    descripcion: p.descripcion,
    // `codigoBarras` del empaque se OMITE cuando no hay, nunca se manda null:
    // el tipo del front lo declara opcional. Y va a faltar casi siempre --
    // los codigos que devuelve Dynamics son todos de unidad suelta, ninguno
    // identifica un empaque (verificado con el catalogo real).
    empaques: [
      {
        nombre: p.empaqueNombre,
        factor: p.empaqueFactor,
        ...(p.empaqueCodigoBarras === null ? {} : { codigoBarras: p.empaqueCodigoBarras }),
      },
    ],
    ...(p.ubicacion === null ? {} : { ubicacion: p.ubicacion }),
  };
}

function aConteoDto(c: {
  productoId: number;
  empaques: number;
  sueltas: number;
  confirmadoPorEscaner: boolean;
  contadoEn: Date;
}): ConteoDto {
  return {
    productoId: c.productoId,
    empaques: c.empaques,
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
  asignadoA: { nombre: string } | null;
  asignadoA2: { nombre: string } | null;
  productos: Parameters<typeof aProductoDto>[0][];
  conteos: Parameters<typeof aConteoDto>[0][];
};

function aHojaDto(h: HojaCompleta): HojaDto {
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
    // nombres (tipos.ts#HojaConteo.asignados: string[]), no ids.
    asignados: [h.asignadoA?.nombre, h.asignadoA2?.nombre].filter((n): n is string => Boolean(n)),
    productos: h.productos.map(aProductoDto),
    conteos: h.conteos.map(aConteoDto),
  };
}

const INCLUIR_TODO = {
  asignadoA: { select: { nombre: true } },
  asignadoA2: { select: { nombre: true } },
  productos: { orderBy: { codigo: 'asc' } },
  conteos: true,
} as const;

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
    where: { hojaId, OR: [{ codigoBarras: codigo }, { empaqueCodigoBarras: codigo }] },
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
    select: { id: true, empaqueFactor: true },
  });
  // El producto tiene que ser DE ESTA HOJA: sin el `hojaId` en el where, se
  // podria escribir un conteo de la hoja A usando un producto de la hoja B.
  if (!producto) throw new NoEncontrado('Ese producto no pertenece a esta hoja.');

  validarFactor(producto.empaqueFactor);

  const datos = {
    empaques: input.empaques,
    sueltas: input.sueltas,
    confirmadoPorEscaner: input.confirmadoPorEscaner,
    contadoEn: input.contadoEn,
  };

  /**
   * Transaccion: el conteo y el cambio de estado de la hoja son un solo
   * hecho. Si se guardara el conteo y fallara el estado, la hoja quedaria
   * "pendiente" con items contados -- y el avance que ve el operario mentiria.
   */
  const [conteo] = await prisma.$transaction([
    prisma.conteo.upsert({
      where: { hojaId_productoId: { hojaId, productoId } },
      create: { hojaId, productoId, ...datos },
      update: datos,
    }),
    prisma.hojaConteo.update({
      where: { id: hojaId },
      data: { estado: estadoTrasContar(hoja.estado), sync: 'sincronizado' },
    }),
  ]);

  return {
    conteo: aConteoDto(conteo),
    total: producto.empaqueFactor * conteo.empaques + conteo.sueltas,
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
    await prisma.hojaConteo.update({
      where: { id: hojaId },
      data: { estado: 'finalizada', sync: 'sincronizado' },
    });
  }

  return detalle(actor, hojaId);
}
