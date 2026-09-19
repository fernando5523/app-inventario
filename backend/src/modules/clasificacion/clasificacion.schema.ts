import { z } from 'zod';

/**
 * El `codigo` es el ItemNumber de Dynamics (ClasificacionProducto.codigo,
 * @unique) -- la identidad estable de un producto entre periodos. La
 * clasificacion se guarda por codigo, NO por inventario: el Auditor no quiere
 * reclasificar lo mismo cada mes.
 */
export const parametrosCodigoSchema = z.object({
  codigo: z.string().trim().min(1, 'El codigo es obligatorio.'),
});
export type ParametrosCodigo = z.infer<typeof parametrosCodigoSchema>;

/**
 * La busqueda de la pantalla del Auditor sobre el catalogo (~11.800 items).
 * Zod solo valida forma; de donde salen los productos buscables lo decide el
 * service (ver clasificacion.service.ts#buscar).
 */
export const buscarQuerySchema = z.object({
  /** Texto libre: matchea codigo, descripcion o categoria, insensible a mayusculas. */
  q: z.string().trim().min(1).optional(),
  /**
   * `true` => solo los productos que YA tienen clasificacion del Auditor (la
   * "lista que vive de mes a mes"). Ausente/`false` => todo el catalogo.
   * Es un query param (string), por eso el enum + transform y no `z.boolean`:
   * `z.coerce.boolean('false')` daria `true`, que es justo lo contrario.
   */
  soloClasificados: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type BuscarQuery = z.infer<typeof buscarQuerySchema>;

/**
 * Clasificar (o reclasificar) un codigo. Es la EXCEPCION del Auditor a lo que
 * dice Dynamics -- el caso de las cervezas: Dynamics las marca del empleado,
 * pero por orden de gerencia las asume la empresa. `nota` es opcional: por
 * que se hizo la excepcion.
 *
 * ---------------------------------------------------------------------------
 * DE BOOLEANO A TRES VIAS
 * ---------------------------------------------------------------------------
 * Pedido textual del cliente (reunion 2, 00:33:25): "ponga empresa y se va al
 * cuadro de empresa, ponga paquetes se va al cuadro de paquetes, unidad se
 * queda ahi unidad para el descuento del personal". Con un booleano la
 * tercera respuesta no se podia dar, y es la que el Auditor necesita cuando
 * falta media caja de algo que se compra por caja.
 *
 * EL CUERPO MANDA `clase`, NO `esEmpresa`, y es a proposito. La invariante
 * dice que `clase == 'empresa'` tiene que coincidir con `esEmpresa == true`
 * mientras las dos columnas existan; si el cuerpo trajera las dos, un cliente
 * podria mandarlas discrepando y la liquidacion quedaria mirando una columna
 * distinta de la otra. Aceptando SOLO la clase, `esEmpresa` se deriva en el
 * service y la invariante se cumple por construccion, no por validacion.
 */
export const clasificarSchema = z
  .object({
    /**
     * FORZAR EL CUADRO, y es OPCIONAL. `empresa` = lo asume la empresa;
     * `paquete` = se le mide el umbral por empaque de compra; `unidad` = se
     * descuenta entero al personal.
     *
     * Ausente o `null` = NO SE FUERZA NINGUNO: lo decide el sistema con la
     * clase del snapshot y el empaque efectivo. Era obligatoria, y eso dejaba
     * sin camino al caso mas comun -- corregir SOLO el empaque, que es el que
     * evita "estar corrigiendo 1:1" (pedido de Gilmer, reunion 2). Para
     * guardar un empaque corregido habia que forzar ademas un cuadro, y el
     * cuadro forzado PISA lo derivado: la correccion quedaba escrita y sin
     * efecto.
     */
    clase: z.enum(['empresa', 'paquete', 'unidad']).nullable().optional(),
    /**
     * EL EMPAQUE DE COMPRA CORREGIDO A MANO. Ausente o `null` = sin corregir:
     * manda el del snapshot.
     *
     * CORREGIR EL EMPAQUE NO ES CORREGIR EL STOCK, y hay que decirlo porque
     * las dos cosas se parecen y no lo son: el stock del ERP no lo edita nadie
     * nunca desde ninguna pantalla. El empaque es un ATRIBUTO del producto
     * ("viene en display de 12") que D365 a veces tiene mal, y que el cliente
     * pidio poder corregir -- textual, reunion 2: "claro que tu edites el
     * empaque y ya cambia el resultado".
     *
     * `.int().min(1)`: un 0 seria una division por cero en la razon del umbral
     * y un negativo no significa nada. Un 1 puesto a mano SI es valido y tiene
     * consecuencia -- afirma "se compra suelto", y con eso el item nunca va al
     * cuadro de paquetes.
     *
     * ES UN PUT, no un PATCH: el cuerpo declara la excepcion ENTERA. Omitirlo
     * BORRA la correccion anterior, igual que pasa con `nota`. La pantalla
     * manda siempre lo que tiene cargado, asi que no hay forma de perder el
     * dato sin haberlo visto en pantalla.
     */
    empaqueCompraCorregido: z.number().int().min(1).nullable().optional(),
    nota: z.string().trim().min(1).max(500).optional(),
  })
  // `.strict()`: un cliente viejo que siga mandando `esEmpresa` falla con 400
  // en vez de que se lo ignoremos en silencio y quede clasificado como otra
  // cosa. Mismo criterio que `cambiarPinSchema` con un id ajeno.
  .strict()
  /**
   * ALGO TIENE QUE DECIR: o fuerza un cuadro, o corrige el empaque.
   *
   * Sin esto, un cuerpo vacio crearia una fila de excepcion que no afirma
   * nada -- y peor: seria `clase NULL + empaqueCompraCorregido NULL`, que es
   * exactamente la forma de una EXCEPCION VIEJA (las de antes de las tres
   * vias, ver schema.prisma). Las dos quedarian indistinguibles y la
   * invariante 2 ("una vieja no se reinterpreta") perderia sentido.
   *
   * Con esta regla, una fila nueva SIEMPRE tiene al menos una de las dos, asi
   * que `clase NULL + empaque NULL` sigue siendo, sin ambiguedad, una vieja.
   */
  .refine((v) => v.clase != null || v.empaqueCompraCorregido != null, {
    message: 'Indica el cuadro o corrige el empaque de compra: asi no hay nada que guardar.',
  });
export type ClasificarInput = z.infer<typeof clasificarSchema>;
