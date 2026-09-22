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
import type { CorregirConteoInput, GuardarConteoInput, ListarHojasQuery } from './hojas.schema';
import { validarCorreccion, type EstadoConAjuste } from '../inventarios/ajuste.permisos';
import { sacarDeLaRondaSiguienteSiCuadro, type SalidaDeLaRonda } from '../inventarios/rondas.service';
import { puedeVerLaMatriz } from '../auditoria/auditoria.permisos';
import type { EstadoInventario } from '../historial/historial.permisos';
import { registrarAuditoria } from '../../shared/auditoria';

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

  /**
   * Antes de leer nada: el inventario tiene que ser de la sucursal del actor.
   *
   * EL AUDITOR TAMBIEN PASA, y hasta ahora no pasaba. Esta condicion decia
   * solo `rol !== 'administrador'`, y el auditor -- que por decision del
   * cliente (2026-09-09) audita TODA la cadena y no pertenece a ninguna
   * tienda -- se comia un 404 en cualquier inventario que no fuera el de la
   * sucursal vieja de su ficha.
   *
   * SE ARREGLA PORQUE DEJABA UN ESTADO INCOHERENTE QUE INTRODUJIMOS NOSOTROS:
   * desde que el Auditor entro a `ROLES_QUE_CORRIGEN` (ajuste.permisos.ts),
   * podia CORREGIR un conteo que no podia LEER. `validarCorreccion` lo deja
   * escribir -- usa `ajuste.permisos.ts#validarSucursal`, que si lo exceptua
   * -- y este listado le devolvia 404. Escribir sin poder leer no es un
   * permiso de mas ni de menos: es una pantalla que no puede existir.
   *
   * Y no abre nada nuevo: el Auditor YA ve la matriz de auditoria de
   * cualquier sucursal (`auditoria.permisos.ts#validarSucursal`), que
   * contiene `stockErp` -- el dato mas sensible del sistema. Negarle las
   * hojas de conteo de esa misma tienda mientras se le muestra el stock del
   * ERP era la incoherencia, no el arreglo.
   *
   * El recorte sigue en pie para `coordinador` y `conteo`: salir de la propia
   * sucursal esta prohibido, o cualquiera leeria el inventario de otra tienda
   * cambiando un id en la URL.
   */
  if (actor.rol !== 'administrador' && actor.rol !== 'auditor' && actor.sucursalId !== inventario.sucursalId) {
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
    /**
     * EL TEXTO CAMBIO PORQUE LA REGLA CAMBIO A MEDIAS.
     *
     * Decia "no se puede corregir el conteo" y eso ya es falso: el
     * Coordinador y el Auditor SI pueden, por
     * `PATCH /:id/conteos/:productoId/corregir`, con la hoja finalizada
     * incluida (decision del cliente). Lo que sigue cerrado es ESTA puerta
     * -- la de quien cuenta en la gondola --, y sigue cerrada por lo mismo de
     * siempre: una hoja finalizada es un hecho declarado por quien la conto, y
     * un conteo que llega tarde de la cola offline no puede reabrirla en
     * silencio.
     *
     * Decir "no se puede" a secas mandaba a la persona equivocada a dar la
     * vuelta larga: el mensaje ahora dice quien SI puede.
     */
    throw new Conflicto(
      'La hoja ya está finalizada: quien contó no puede seguir cargando en ella. ' +
        'Si hay un valor mal cargado, el Coordinador o el Auditor pueden corregirlo dejando el motivo.',
    );
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
     * DECISIÓN DEL CLIENTE (2026-09-11), vuelta atrás de fb2e224: acá el
     * servidor rellenaba con 0 cada producto sin contar al finalizar ("si
     * no hay el producto, es 0"). Después el cliente decidió otra regla, en
     * la app (76394fd): 'Finalizar' no aparece hasta que TODOS los
     * productos tengan valor, porque un 0 significa "lo vi y no había", y
     * eso lo tiene que decir la PERSONA, no el sistema. Un relleno
     * automático es exactamente lo que esa regla prohíbe -- rellenar en
     * silencio es afirmar en nombre de alguien que nunca miró ese renglón.
     *
     * Por eso ahora el servidor RECHAZA en vez de rellenar: así la regla
     * vale aunque alguien llegue por otro camino que la pantalla de Contar
     * (un cliente viejo, un script, la cola offline reintentando algo que
     * quedó a medias). 409 y no 400: la hoja no está mal formada, está
     * incompleta -- misma familia que "hoja finalizada" de más arriba, un
     * conflicto de estado, no un error de la solicitud.
     *
     * Sin transacción: ya no hay dos escrituras que mantener juntas (antes
     * eran los 0 + el cambio de estado) -- que quedaban abajo era la ÚNICA
     * razón para envolverlas.
     */
    const sinContar = await prisma.producto.findMany({
      where: { hojaId, conteos: { none: {} } },
      select: { id: true },
    });

    if (sinContar.length > 0) {
      // "Falta" impersonal, invariante: el sujeto de la oración no es
      // "productos" (que concordaría con "faltan"), es "contar N productos"
      // como bloque -- "falta contar 2 productos", no "faltan contar 2 productos".
      throw new Conflicto(
        `Todavía falta contar ${sinContar.length} producto${sinContar.length === 1 ? '' : 's'} de esta hoja. ` +
          'Cada producto necesita un valor antes de finalizar -- si no había nada, se carga 0 a mano.',
      );
    }

    await prisma.hojaConteo.update({
      where: { id: hojaId },
      data: { estado: 'finalizada', sync: 'sincronizado' },
    });
  }

  return detalle(actor, hojaId);
}

export interface CorreccionDeConteoDto {
  conteo: ConteoDto;
  /** Unidades que quedan tras la correccion. */
  total: number;
  /** Las que habia antes: lo que se acaba de pisar. */
  totalAnterior: number;
  /**
   * SOLO PARA QUIEN YA PODIA VER LA MATRIZ de este inventario (el Auditor, el
   * administrador). Para el Coordinador la clave NO VIENE -- no viene en
   * `null`, no viene. Ver el comentario de `corregirConteo`.
   */
  stockErp?: number | null;
  /** `total - stockErp`. Viaja junto con `stockErp` o no viaja. */
  diferencia?: number | null;
  /**
   * EL ITEM SALIO DE LA RONDA SIGUIENTE porque la correccion lo hizo cuadrar.
   * `null` = no salio de ningun lado, que es el caso normal.
   *
   * Va en la respuesta y no solo en el log porque es LO QUE EL CLIENTE PIDIO
   * VER: *"puedes corregirlo para que ya no salga en mi segundo conteo"*. Sin
   * esto, quien corrige no tiene forma de saber si consiguió lo que fue a
   * buscar -- y la diferencia entre que salga y que no depende de si alguien
   * ya empezó esa ronda, que es algo que quien corrige no puede ver.
   */
  salioDeLaRonda?: SalidaDeLaRonda | null;
}

/**
 * CORREGIR UN CONTEO YA CARGADO: `PATCH /api/hojas/:id/conteos/:productoId/corregir`.
 *
 * Pedido del cliente: el Coordinador puede corregir los valores que cargaron
 * los contadores, en cualquier conteo. Y el Auditor tambien -- misma
 * potestad, misma ventana, con la unica diferencia de que el ve el stock (ver
 * mas abajo). Reemplaza el valor y queda auditado: quien, con que rol, que,
 * antes, despues y por que.
 *
 * CORREGIR LO CONTADO NO ES CORREGIR EL STOCK. Esto escribe `Conteo` -- lo que
 * una persona afirmo haber visto en la gondola --, nunca
 * `CatalogoItem.stockErp`, que es la foto del ERP y no la edita nadie desde la
 * app. La regla completa esta en la cabecera de `ajuste.permisos.ts`.
 *
 * ---------------------------------------------------------------------------
 * Y SACA EL ITEM DE LA RONDA SIGUIENTE SI LO HIZO CUADRAR
 * ---------------------------------------------------------------------------
 * Es la mitad que faltaba de lo que el cliente pidio: *"puedes corregirlo para
 * que ya no salga en mi segundo conteo"*. Lo hace
 * `rondas.service.ts#sacarDeLaRondaSiguienteSiCuadro`, en la MISMA
 * transaccion, y solo si esa ronda todavia no arranco -- ahi esta el porque
 * completo.
 *
 * ---------------------------------------------------------------------------
 * EN QUE SE DIFERENCIA DE `guardarConteo`, QUE ESCRIBE LA MISMA FILA
 * ---------------------------------------------------------------------------
 *  1. NO EXIGE ESTAR ASIGNADO. `guardarConteo` usa `validarEscrituraDeHoja`,
 *     que pide estar asignado a la hoja para todos los roles: el conteo tiene
 *     que quedar a nombre de quien lo hizo. Corregir es lo contrario por
 *     definicion -- se corrige lo que conto OTRO, y por eso el motivo es
 *     obligatorio y el cambio queda auditado con nombre y rol. La autoria del
 *     conteo original no se pierde: se registra quien la piso.
 *  2. FUNCIONA CON LA HOJA FINALIZADA. Es la mitad del pedido que no se puede
 *     resolver por la puerta de `guardarConteo`, que rechaza con 409.
 *  3. LA VENTANA LA DECIDE EL INVENTARIO, no la hoja: `en_curso`, y se corta
 *     cuando el Auditor inicia su ajuste (ver `ajuste.permisos.ts`).
 *
 * EL STOCK VA SOLO PARA QUIEN YA PODIA VERLO. Decision del cliente: el Auditor
 * SI lo ve mientras corrige -- ya lo tiene en su panel de auditoria, y
 * ocultarselo aca solo lo obligaria a saltar de pantalla para comparar. Al
 * Coordinador se le sigue ocultando: es el conteo ciego, y quien ve contra que
 * corrige deja de corregir un error y pasa a hacer que el inventario cuadre.
 *
 * QUIEN VE QUE no se decide con una lista de roles nueva sino con
 * `auditoria.permisos.ts#puedeVerLaMatriz`, que es LA regla de quien puede
 * mirar el `stockErp` de un inventario. Reusarla tiene una consecuencia que
 * vale la pena nombrar: el dia que esa regla cambie, esta respuesta cambia con
 * ella sin que nadie tenga que acordarse de este archivo. Dos listas separadas
 * serian dos lugares donde el conteo ciego puede romperse de a uno.
 *
 * Las claves se OMITEN cuando no corresponden, no viajan en `null`: un `null`
 * diria "el ERP no trajo stock", que es una afirmacion sobre el dato y no
 * sobre quien pregunta. Son dos cosas distintas y el front tiene que poder
 * distinguirlas (ver la cabecera de auditoria.calculos.ts).
 */
export async function corregirConteo(
  actor: ColaboradorAutenticado,
  hojaId: number,
  productoId: number,
  input: CorregirConteoInput,
): Promise<CorreccionDeConteoDto> {
  const hoja = await prisma.hojaConteo.findUnique({
    where: { id: hojaId },
    select: {
      id: true,
      inventarioId: true,
      numeroConteo: true,
      inventario: { select: { sucursalId: true, estado: true } },
    },
  });
  if (!hoja) throw new NoEncontrado('Esa hoja no existe.');

  validarCorreccion(actor, {
    sucursalId: hoja.inventario.sucursalId,
    estado: hoja.inventario.estado as EstadoConAjuste,
  });

  const producto = await prisma.producto.findFirst({
    where: { id: productoId, hojaId },
    select: { id: true, codigo: true, empaques: { select: { nombre: true, factor: true } } },
  });
  // De ESTA hoja: sin el `hojaId`, se corregiria la hoja A con un producto de
  // la B (mismo cuidado que en `guardarConteo`).
  if (!producto) throw new NoEncontrado('Ese producto no pertenece a esta hoja.');

  /**
   * TIENE QUE HABER ALGO QUE CORREGIR. Si el producto no tiene conteo, esto no
   * es una correccion: seria CARGAR un conteo a nombre de nadie, sobre un
   * renglon que nunca nadie miro.
   *
   * Es la misma regla que sostiene `finalizar` desde la decision del cliente
   * de 2026-09-11: un 0 significa "lo vi y no habia" y lo tiene que afirmar la
   * PERSONA que fue a la gondola, no el sistema ni quien corrige desde afuera.
   * Si falta contar un renglon, se cuenta -- no se corrige.
   */
  const anterior = await prisma.conteo.findUnique({
    where: { hojaId_productoId: { hojaId, productoId } },
    include: { empaques: true },
  });
  if (!anterior) {
    throw new Conflicto(
      'Ese producto todavía no tiene ningún conteo cargado: no hay nada que corregir. ' +
        'Tiene que contarlo quien esté en la góndola -- un 0 también se carga a mano.',
    );
  }

  validarFactores(producto.empaques);
  const totalAnterior = totalUnidades(anterior, producto.empaques);
  // Se calcula ANTES de escribir: si una linea referencia un empaque que el
  // producto no tiene, `totalUnidades` tira y no se persiste nada a medias.
  const total = totalUnidades(input, producto.empaques);

  const lineas = input.empaques.map((l) => ({ empaqueNombre: l.empaqueNombre, cantidad: l.cantidad }));

  /**
   * EL CAMBIO DE VALOR Y LA LIMPIEZA DE LA RONDA SON UN SOLO HECHO.
   *
   * Si se partieran, el estado que queda cuando falla la segunda mitad es
   * EXACTAMENTE el bug que esto vino a arreglar: correccion aplicada, item
   * todavia en la ronda siguiente esperando que alguien lo recuente al pedo.
   *
   * El registro de `conteo.corregido` tambien entra a la transaccion: un log
   * que afirma una correccion que despues se deshizo es peor que no tener log
   * -- es donde se va a mirar cuando alguien reclame por su descuento.
   */
  const { conteo, salida } = await prisma.$transaction(async (tx) => {
    const conteo = await tx.conteo.update({
      where: { hojaId_productoId: { hojaId, productoId } },
      data: {
        sueltas: input.sueltas,
        /**
         * SE BAJA A false, SIEMPRE. `confirmadoPorEscaner` afirma que el
         * fisico coincide con la linea porque alguien escaneo el codigo en la
         * gondola (schema.prisma#Conteo). Quien corrige esta tecleando un
         * numero desde otro lado: dejar el true del conteo original seria
         * firmar con el escaner un valor que el escaner nunca vio.
         */
        confirmadoPorEscaner: false,
        // `contadoEn` NO se toca: es cuando se conto en la gondola, y corregir
        // no cambia eso. La hora de la correccion queda en el registro de
        // auditoria, que es donde corresponde.
        empaques: { deleteMany: {}, create: lineas },
      },
      include: { empaques: true },
    });

    await registrarAuditoria(
      {
        actorId: actor.colaboradorId,
        accion: 'conteo.corregido',
        entidad: 'conteo',
        entidadId: conteo.id,
        // `rol` ademas de `actorId`: con las dos vias abiertas hace falta
        // poder separar despues una correccion del Coordinador de una del
        // Auditor sin ir a buscar el rol que el colaborador tenia ESE dia --
        // que ademas puede haber cambiado desde entonces.
        //
        // `valorAnterior`/`valorNuevo` en UNIDADES y no la lista de empaques:
        // es el numero que se audita y el que termina en el descuento de
        // alguien. "2 cajas -> 3 cajas" obliga a quien lee el log seis meses
        // despues a saber el factor de la caja para entender que cambio.
        detalle: {
          productoId,
          codigo: producto.codigo,
          ronda: hoja.numeroConteo,
          valorAnterior: totalAnterior,
          valorNuevo: total,
          motivo: input.motivo,
          rol: actor.rol,
        },
      },
      tx,
    );

    /**
     * DESPUES del update y dentro de la misma transaccion: lo que esta funcion
     * lea de la base para decidir si el item cuadra ya incluye la correccion,
     * asi que no hace falta pasarle el valor nuevo a mano. Devuelve `null`
     * cuando no hay nada que sacar, que es el caso normal.
     */
    const salida = await sacarDeLaRondaSiguienteSiCuadro(tx, {
      inventarioId: hoja.inventarioId,
      codigo: producto.codigo,
      rondaCorregida: hoja.numeroConteo,
      actorId: actor.colaboradorId,
    });

    return { conteo, salida };
  });

  const base = { conteo: aConteoDto(conteo), total, totalAnterior, salioDeLaRonda: salida };

  /**
   * El estado va casteado porque `validarCorreccion` ya garantizo que es
   * `en_curso` -- si fuera otro, no se llega hasta aca. El cast existe solo
   * porque el union escrito a mano de `historial.permisos.ts` todavia no suma
   * `ajuste_auditor` (ver `EstadoConAjuste`).
   */
  const veElStock = puedeVerLaMatriz(actor, {
    sucursalId: hoja.inventario.sucursalId,
    estado: hoja.inventario.estado as EstadoInventario,
  });
  if (!veElStock) return base;

  const item = await prisma.catalogoItem.findFirst({
    where: { inventarioId: hoja.inventarioId, codigo: producto.codigo },
    select: { stockErp: true },
  });
  const stockErp = item?.stockErp ?? null;

  return {
    ...base,
    stockErp,
    // null y NO 0 cuando falta el stock: un 0 dice "conto exactamente lo que
    // decia el ERP", y no puede ser tambien el valor de "no hay dato".
    diferencia: stockErp === null ? null : total - stockErp,
  };
}
