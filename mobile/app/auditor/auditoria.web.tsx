import { router } from 'expo-router';
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Lock,
  PencilLine,
  Store,
  Zap,
} from 'lucide-react-native';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  BotonIcono,
  BotonWeb,
  CeldaTexto,
  ChipIcono,
  EncabezadoPagina,
  FilaDato,
  TablaWeb,
  TarjetaWeb,
  type ColumnaTabla,
} from '../../components/web';
import { Badge, type BadgeVariant, formatoMiles, formatoMoneda, formatoPct, MESES_CORTOS } from '../../components/ui';
import { repositorioAuditoria, repositorioHistorial, repositorioInventario } from '../../lib/contenedor';
import { descargarArchivo } from '../../lib/descargar-archivo';
import { pagaLaEmpresa } from '../../lib/dominio/auditoria';
import {
  estadoExportacionCadena,
  nombreCadenaDeRespaldo,
  notaExportacionCadena,
} from '../../lib/dominio/exportar-cadena';
import {
  estadoExportacionCuadros,
  nombreCuadrosDeRespaldo,
  notaExportacionCuadros,
} from '../../lib/dominio/exportar-cuadros';
import { pluralizar } from '../../lib/dominio/plural';
import { sucursalEnFoco } from '../../lib/dominio/sucursal-en-foco';
import type {
  EstadoInventario,
  ResumenAuditoriaServidor,
  ResumenCadena,
  ResumenTiendaCadena,
  TotalCadena,
} from '../../lib/puertos/repositorios';
import { useSesion } from '../../lib/sesion-contexto';
import { useSucursalAuditada } from '../../lib/sucursal-auditada-contexto';
import { colors, fonts, fontSize, radius, shadow, spacing } from '../../lib/theme';

/**
 * ---------------------------------------------------------------------------
 * EL PANEL DE AUDITORÍA EN WEB
 * ---------------------------------------------------------------------------
 * Clon de `auditoria.tsx` con el diseño que aprobó el usuario: encabezado con
 * miga de pan, la tienda y su estado en una banda, y TRES tarjetas en fila --
 * resultado, empresa y acciones.
 *
 * Los números son LOS MISMOS y salen del mismo `resumen()` del servidor. Lo
 * único que cambia es la forma: en el teléfono es una columna que se scrollea;
 * acá entra todo sin bajar, que es lo que permite decidir de un vistazo.
 *
 * ---------------------------------------------------------------------------
 * "CONTEO FINALIZADO" NO VA EN ROJO
 * ---------------------------------------------------------------------------
 * El mockup pintaba ese cartel de rojo. En este sistema el rojo significa
 * falta o peligro -- el faltante, el botón de lacrar -- y justo debajo hay dos
 * bandas rojas que SÍ son plata que se descuenta. Un "todo listo" del mismo
 * color le enseña al ojo que el rojo no significa nada.
 *
 * Acá el cartel toma el color de LO QUE PASA: verde cuando el ciclo cerró,
 * ámbar mientras espera una decisión, gris cuando todavía se cuenta.
 *
 * ---------------------------------------------------------------------------
 * LA TABLA DE TIENDAS ES EL SELECTOR, Y POR ESO NO HAY SELECTOR
 * ---------------------------------------------------------------------------
 * Pedido del usuario: *"¿podemos mostrar una tabla con todas las sucursales
 * implicadas en el inventario?"*. Antes se veía UNA tienda por vez y para
 * comparar dos había que cambiar el desplegable, mirar, y acordarse del número
 * anterior -- que es cómo se comparan mal cuatro tiendas.
 *
 * Elegir en la tabla y elegir en un desplegable serían DOS controles para lo
 * mismo, y el día que uno se desincronice del otro nadie sabría cuál manda.
 * Así que el `SelectorSucursal` se fue: la fila que se toca es la tienda que
 * muestran las tarjetas de abajo, y el contexto compartido
 * (`useSucursalAuditada`) sigue siendo el mismo de siempre -- elegir acá
 * también cambia Ciclo, Historial y Liquidación.
 *
 * LAS TIENDAS SIN INVENTARIO DEL PERÍODO SE LISTAN IGUAL, con guiones. Es la
 * cobertura del mes: la primera pregunta del Auditor es cuáles faltan, y una
 * tabla que solo trae las que empezaron la contesta al revés.
 *
 * ---------------------------------------------------------------------------
 * NO HAY SELECTOR DE PERÍODO todavía
 * ---------------------------------------------------------------------------
 * El boceto tenía un "[Set 2026 v]" arriba a la derecha. No existe endpoint
 * que diga qué períodos hay, y un desplegable que no hace nada enseña a
 * ignorar la interfaz. Se muestra el período que devolvió el servidor, como
 * dato: la pantalla no lo asume ni lo calcula con el reloj del equipo.
 */
const ANCHO_ANGOSTO = 1180;

/**
 * EL TOPE DE ANCHO del contenido, aunque la ventana tenga 1.900.
 *
 * Sin esto cada fila de "etiqueta a la izquierda, número a la derecha" se
 * estira medio metro y hay que barrer la cabeza para juntar el concepto con su
 * cifra -- *"parecen estirados"*. La matriz es la excepción y usa todo el
 * ancho: ahí el ancho de más son columnas, no aire.
 *
 * Va en cada BLOQUE y como ANCHO FIJO, no como porcentaje: el contenedor del
 * scroll se ajusta a su contenido, así que un `width: 100%` adentro se resuelve
 * contra algo que a su vez depende de él y la página terminaba encogida a la
 * mitad. 1.132 = las tres columnas (430 + 330 + 340) más sus dos separaciones.
 */
const TOPE_ANCHO = 1132;

interface EstadoDelCartel {
  titulo: string;
  detalle: string;
  tono: 'ok' | 'atencion' | 'neutro';
}

/**
 * El cartel de estado, derivado del estado REAL del inventario y no de un
 * texto fijo. Son cinco estados en la base y cada uno habilita cosas
 * distintas: decir "listo para aprobación" sobre un inventario que todavía se
 * está contando manda a alguien a una pantalla que lo va a rechazar.
 */
function cartelDe(estado: EstadoInventario | null): EstadoDelCartel {
  if (estado === null) return { titulo: 'Sin inventario abierto', detalle: 'Esta tienda no tiene un inventario en curso.', tono: 'neutro' };
  if (estado === 'en_curso') return { titulo: 'Conteo en curso', detalle: 'Todavía se está contando: los números pueden cambiar.', tono: 'neutro' };
  if (estado === 'ajuste_auditor') return { titulo: 'Ajuste final en curso', detalle: 'Estás fijando los valores definitivos contra el stock.', tono: 'atencion' };
  if (estado === 'conteo_cerrado') return { titulo: 'Conteo finalizado', detalle: 'Listo para revisión y aprobación.', tono: 'ok' };
  if (estado === 'liquidado') return { titulo: 'Liquidado', detalle: 'La planilla está firme. Falta lacrar.', tono: 'atencion' };
  if (estado === 'lacrado') return { titulo: 'Lacrado', detalle: 'Cerrado y sellado: no se toca más.', tono: 'ok' };
  return { titulo: 'Anulado', detalle: 'Este inventario no produjo resultados.', tono: 'neutro' };
}

/**
 * EL BADGE DE CADA FILA. Sale de `cartelDe`, la MISMA función que pinta el
 * cartel grande de la tienda elegida: si un día el nombre de un estado cambia,
 * cambia en los dos lados o en ninguno.
 *
 * `BadgeEstado` de `components/web` NO sirve acá: tipa su prop como
 * `VeredictoAuditoria` -- los cinco estados de un ÍTEM (cuadrado, falta,
 * empresa, sin dato del ERP, sin contar) -- y estos son los del ciclo de vida
 * de un INVENTARIO. Forzarlos ahí le sacaría a ese tipo la garantía que lo
 * hace valer.
 */
const VARIANTE_DE_TONO: Record<EstadoDelCartel['tono'], BadgeVariant> = {
  ok: 'ok',
  atencion: 'proceso',
  neutro: 'default',
};

function badgeDeTienda(tienda: ResumenTiendaCadena): { etiqueta: string; variante: BadgeVariant } {
  // Sin inventario NO es "sin inventario abierto" (lo que diría `cartelDe`
  // para la tienda elegida): es que esta tienda todavía no abrió el del
  // período, que es otra cosa y es el dato que esta tabla vino a dar.
  if (tienda.inventarioId === null) return { etiqueta: 'Sin inventario', variante: 'espera' };
  const cartel = cartelDe(tienda.estado);
  return { etiqueta: cartel.titulo, variante: VARIANTE_DE_TONO[cartel.tono] };
}

/** "Setiembre 2026" a partir del período que devolvió el servidor. */
function textoPeriodo(periodo: ResumenCadena['periodo']): string {
  return `${MESES_CORTOS[periodo.mes - 1]} ${periodo.anio}`;
}

/** "-S/ 161,70" / "S/ 130,40". El signo lo decide quién llama, no el dato. */
function monto(valor: number | undefined, negativo: boolean): string {
  return valor === undefined ? '—' : `${negativo && valor !== 0 ? '-' : ''}S/ ${formatoMoneda(valor)}`;
}

/**
 * EL TOTAL DE LA CADENA, EN EL SUBTÍTULO DE LA TABLA.
 *
 * Antes eran cuatro tarjetas arriba (Total de la cadena · Al personal · Por
 * paquete · Empresa). El usuario las sacó -- *"quita estos cards"* -- y tenía
 * razón: repetían en grande lo que la tabla dice tienda por tienda, y empujaban
 * la tabla, que es lo que se vino a mirar, media pantalla hacia abajo.
 *
 * Lo que NO se puede perder con ellas es el total de la cadena: sumar once
 * filas a ojo para saber cuánto se descuenta en el mes es exactamente lo que
 * esta pantalla existe para evitar. Así que el total baja a dos renglones
 * pegados al título de la tabla -- misma información, sin el bloque.
 *
 * Los cuadros `paquete` y `empresa` siguen acá aunque no tengan columna: son
 * plata que NO entra al descuento, y la diferencia entre "faltó S/ 161,70" y
 * "se descuenta S/ 4,10" solo se explica nombrándolos.
 */
function resumenDeCadena(total: TotalCadena): string {
  const cobertura = `${total.conInventario} de ${total.tiendas} ${pluralizar(total.tiendas, 'tienda', 'tiendas')} con inventario del período`;
  // Sin auditables NO se muestra un porcentaje: 0 de 0 daría "100%" o "0%" y
  // las dos cosas serían una afirmación sobre un conteo que no existe.
  const cuadre =
    total.auditables === 0
      ? 'todavía no hay ítems auditables'
      : `${formatoMiles(total.cuadrados)} cuadrados de ${formatoMiles(total.auditables)} auditables (${formatoPct((total.cuadrados / total.auditables) * 100)}%)`;
  const plata = [
    `${monto(total.valorFaltante, true)} de faltante`,
    `${monto(total.valorSobrante, false)} de sobrante`,
    `${monto(total.porClase.paquete.valorFaltante, true)} por paquete`,
    `${monto(total.porClase.empresa.valorFaltante, true)} de empresa`,
    `${monto(total.valorADescontar, true)} a descontar`,
  ].join(' · ');
  return `${cobertura} · ${cuadre}\nEn toda la cadena: ${plata}`;
}

/**
 * LAS OCHO COLUMNAS DE LA TABLA DE TIENDAS.
 *
 * ---------------------------------------------------------------------------
 * FALTANTE Y SOBRANTE, LOS DOS, UNO AL LADO DEL OTRO
 * ---------------------------------------------------------------------------
 * Pedido del usuario: *"incluir los sobrantes y faltantes en la tabla, así
 * puede sacar sus cálculos"*. No es una columna de adorno: el descuento del mes
 * es `faltantes + sobrantes` -- los sobrantes COMPENSAN, y esa resta es la
 * cuenta que Gilmer hace a mano en su hoja DESCUENTO (ver
 * `historial.exportar-cuadros.ts` en el backend, con el cruce contra su archivo
 * de julio). Con solo la columna de faltante, la tabla mostraba la mitad de una
 * resta y había que abrir cada tienda para conseguir la otra mitad.
 *
 * El sobrante va en VERDE y sin signo, el faltante en negativo: son plata que
 * se mueve para lados distintos, y pintarlos iguales obliga a leer el
 * encabezado para saber qué significa cada número.
 *
 * `elegida` solo decide el COLOR del nombre: el rojo de marca es, en esta app,
 * el de la opción seleccionada (ver la paleta de la skill). No se usa un tinte
 * de fila porque los tres que ofrece `TablaWeb` significan falta, cuadre y
 * espera -- ninguno significa "esta es la que estás mirando", y pedirle a uno
 * que lo signifique le quita el significado que ya tiene.
 */
function columnasDeTiendas(elegida: number | null): ColumnaTabla<ResumenTiendaCadena>[] {
  /**
   * SIN INVENTARIO DEL PERÍODO, GUION. Nunca el 0 que trae el DTO: un
   * "S/ 0,00" en Faltante sobre una tienda que no contó nada dice que cuadró,
   * que es lo contrario de lo que pasa (ver `ResumenTiendaCadena` en el
   * puerto).
   */
  const cifra = (tienda: ResumenTiendaCadena, texto: () => string): string =>
    tienda.inventarioId === null ? '—' : texto();

  return [
    {
      clave: 'tienda',
      titulo: 'Tienda',
      celda: (tn) => (
        <CeldaTexto fuerte color={tn.sucursalId === elegida ? colors.rojo : undefined}>{tn.sucursal}</CeldaTexto>
      ),
    },
    {
      clave: 'estado',
      titulo: 'Estado',
      ancho: 160,
      celda: (tn) => {
        const badge = badgeDeTienda(tn);
        return <Badge label={badge.etiqueta} variant={badge.variante} />;
      },
    },
    {
      clave: 'items',
      titulo: 'Ítems',
      ancho: 90,
      alinear: 'derecha',
      celda: (tn) => <CeldaTexto numero>{cifra(tn, () => formatoMiles(tn.items))}</CeldaTexto>,
    },
    {
      clave: 'cuadrados',
      titulo: 'Cuadrados',
      ancho: 140,
      alinear: 'derecha',
      // Los dos números juntos: "2.951" solo no dice si es bueno o malo.
      celda: (tn) => (
        <CeldaTexto numero>
          {cifra(tn, () => `${formatoMiles(tn.cuadrados)} de ${formatoMiles(tn.auditables)}`)}
        </CeldaTexto>
      ),
    },
    {
      clave: 'faltante',
      titulo: 'Faltante',
      ancho: 120,
      alinear: 'derecha',
      celda: (tn) => <CeldaTexto numero>{cifra(tn, () => monto(tn.valorFaltante, true))}</CeldaTexto>,
    },
    {
      clave: 'sobrante',
      titulo: 'Sobrante',
      ancho: 120,
      alinear: 'derecha',
      // EN VERDE Y SIN SIGNO: es lo que aparece de más, y compensa el faltante
      // en la cuenta del descuento. En `ok` y no en `falta` porque no es plata
      // que se le saca a nadie -- el mismo color que ya tiene "Sobrante del
      // conteo" en la tarjeta de resultado, abajo.
      celda: (tn) => (
        <CeldaTexto numero color={tn.inventarioId !== null && tn.valorSobrante > 0 ? colors.ok : undefined}>
          {cifra(tn, () => monto(tn.valorSobrante, false))}
        </CeldaTexto>
      ),
    },
    {
      clave: 'personal',
      titulo: 'Al personal',
      ancho: 120,
      alinear: 'derecha',
      // El faltante BRUTO del cuadro único. Queda al lado de "A descontar"
      // porque es lo que la explica: la diferencia entre las dos es el
      // sobrante que el personal recupera, y sin este número el neto parece
      // salido de la nada.
      celda: (tn) => (
        <CeldaTexto numero color={tn.inventarioId !== null && tn.porClase.unidad.valorFaltante > 0 ? colors.falta : undefined}>
          {cifra(tn, () => monto(tn.porClase.unidad.valorFaltante, true))}
        </CeldaTexto>
      ),
    },
    {
      clave: 'descontar',
      titulo: 'A descontar',
      ancho: 130,
      alinear: 'derecha',
      /**
       * LA COLUMNA QUE SE BARRE DE ARRIBA ABAJO: es la plata que efectivamente
       * sale del sueldo de alguien, y de acá sale la cuota de cada persona
       * (`montoFaltanteNeto / colaboradoresAlcanzados`, liquidación).
       *
       * NO ES "Al personal": ese es el faltante bruto del cuadro único. El
       * neto le resta el sobrante del mismo cuadro y los ajustes del mes.
       * Pedido del usuario: *"falta el total a descontar del cálculo del
       * sobrante y faltante por cada tienda"* -- antes había que hacer la
       * resta a mano, tienda por tienda.
       *
       * LO CALCULA EL SERVIDOR (`valorADescontar`). Restar acá dos columnas
       * que ya están a la vista sería tentador y sería una segunda copia de la
       * regla que decide cuánto se le descuenta a la gente -- la misma razón
       * por la que los cuadros no se calculan en el teléfono.
       *
       * PUEDE SER NEGATIVO, o sea a favor del personal, cuando el sobrante
       * supera al faltante. Ahí va en verde y sin el signo de resta: decisión
       * del cliente ya documentada en el backend, el neto se muestra tal cual
       * da y no se recorta a cero.
       */
      celda: (tn) => {
        const aFavor = tn.valorADescontar < 0;
        return (
          <CeldaTexto
            numero
            fuerte
            color={tn.inventarioId === null ? undefined : aFavor ? colors.ok : tn.valorADescontar > 0 ? colors.falta : undefined}
          >
            {cifra(tn, () => (aFavor ? monto(Math.abs(tn.valorADescontar), false) : monto(tn.valorADescontar, true)))}
          </CeldaTexto>
        );
      },
    },
  ];
}

export default function PanelAuditoriaWeb(): JSX.Element {
  const { sesion } = useSesion();
  const { width } = useWindowDimensions();
  const angosto = width < ANCHO_ANGOSTO;

  const { elegida: sucursalElegida, elegir: setSucursalElegida } = useSucursalAuditada();
  const [resumen, setResumen] = useState<ResumenAuditoriaServidor | null>(null);
  const [estado, setEstado] = useState<EstadoInventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventarioId, setInventarioId] = useState<number | null>(null);
  const [bajando, setBajando] = useState(false);
  /**
   * LA BAJADA DEL DETALLE DE LA CADENA, con su propio spinner y su propio
   * aviso. Son DOS archivos distintos en la misma pantalla (la planilla de la
   * tienda elegida y el detalle de todas), y un solo par de estados haría
   * girar el spinner del botón que nadie tocó.
   *
   * El aviso NO va a `errorCadena`: ese reemplaza el bloque entero por una
   * tarjeta de error, así que una descarga fallida se llevaría puesta la tabla
   * que se está mirando.
   */
  const [bajandoCadena, setBajandoCadena] = useState(false);
  const [avisoExport, setAvisoExport] = useState<string | null>(null);

  /**
   * LA CADENA, en su propio estado y con su propia carga.
   *
   * NO depende de la tienda elegida a propósito: elegir una fila no puede
   * volver a pedir la tabla entera. Son dos preguntas distintas -- "cómo va la
   * cadena" y "cómo va ESTA tienda" -- y mezclarlas haría que cada clic en la
   * tabla la recargue y parpadee debajo del dedo.
   *
   * Y su propio `error`: si el panorama de la cadena no carga, el detalle de
   * la tienda elegida se sigue viendo, y al revés. Un solo error para los dos
   * apagaría media pantalla por un problema de la otra mitad.
   */
  const [cadena, setCadena] = useState<ResumenCadena | null>(null);
  const [cargandoCadena, setCargandoCadena] = useState(true);
  const [errorCadena, setErrorCadena] = useState<string | null>(null);

  const cargarCadena = useCallback(async () => {
    if (!sesion) return;
    setErrorCadena(null);
    try {
      // Sin período: lo resuelve el servidor y viene en la respuesta. Ver el
      // encabezado del archivo (no hay selector de período todavía).
      setCadena(await repositorioAuditoria.cadena());
    } catch (e) {
      setCadena(null);
      setErrorCadena(e instanceof Error ? e.message : 'No se pudo cargar el resumen de la cadena.');
    } finally {
      setCargandoCadena(false);
    }
  }, [sesion]);

  useEffect(() => {
    void cargarCadena();
  }, [cargarCadena]);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    const sucursalId = sucursalEnFoco({
      rol: sesion.colaborador.rol,
      sucursalDeSesion: sesion.sucursal?.id ?? null,
      elegida: sucursalElegida,
    });
    if (sucursalId === null) {
      setResumen(null);
      setEstado(null);
      setInventarioId(null);
      setCargando(false);
      return;
    }
    setError(null);
    try {
      const activo = await repositorioInventario.activo(sucursalId);
      if (!activo) {
        setResumen(null);
        setEstado(null);
        setInventarioId(null);
        setCargando(false);
        return;
      }
      setEstado(activo.estado);
      setInventarioId(activo.inventarioId);
      // Solo el resumen: la matriz vive en su propia pantalla desde que se
      // separó, y pedirla acá serían 16 páginas de API para pintar cifras que
      // el servidor ya calcula.
      setResumen(await repositorioAuditoria.resumen(activo.inventarioId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [sesion, sucursalElegida]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!sesion) return <View style={styles.centro} />;

  const sucursalId = sucursalEnFoco({
    rol: sesion.colaborador.rol,
    sucursalDeSesion: sesion.sucursal?.id ?? null,
    elegida: sucursalElegida,
  });
  const cartel = cartelDe(estado);
  const cuadros = resumen?.porClase ?? null;
  const conDiferencia = resumen === null ? 0 : resumen.conFalta + resumen.deEmpresa;

  // El nombre sale de la MISMA respuesta que dibuja la tabla: pedirlo aparte
  // al padrón sería un segundo viaje para un dato que ya llegó, y dos fuentes
  // para el mismo nombre.
  const tiendaElegida = cadena?.tiendas.find((tn) => tn.sucursalId === sucursalId) ?? null;

  /**
   * LA PLANILLA DE CUADROS -- las cuatro hojas del formato mensual: FALTANTES,
   * SOBRANTES, EMPRESA y DESCUENTO. Es el archivo que Gilmer arma a mano y la
   * razón por la que esta pantalla existe.
   *
   * Se me habia caido al rehacer el panel para web: estaba en el telefono y no
   * acá. Lo pregunto el usuario -- *"¿dónde está la opción de exportar en
   * excel?"* -- y tenia razon.
   *
   * El boton NO desaparece cuando no se puede: queda apagado con el motivo.
   * Quien viene a bajar el archivo tiene que encontrar el camino y leer qué
   * falta, no un hueco.
   */
  const planilla = estado === null ? null : estadoExportacionCuadros(estado, resumen?.auditables ?? 0);
  const notaPlanilla = estado === null ? null : notaExportacionCuadros(estado);

  /**
   * EL DETALLE POR PRODUCTO DE TODA LA CADENA -- la otra mitad del pedido:
   * *"exportar el detalle de sobrantes y faltantes por productos"*. La tabla da
   * los totales por tienda; este archivo los explica ítem por ítem, con la
   * tienda, la hoja y el cuadro en columnas, para que el Auditor arme sus
   * cuentas en Excel.
   *
   * Ver `dominio/exportar-cadena.ts` para por qué este SÍ se puede bajar en
   * medio del ajuste mientras la planilla del mes no.
   */
  const exportCadena = cadena === null ? null : estadoExportacionCadena(cadena.total);
  const notaCadena = cadena === null ? null : notaExportacionCadena(cadena.tiendas);

  async function bajarDetalleDeCadena(): Promise<void> {
    if (cadena === null) return;
    setBajandoCadena(true);
    setAvisoExport(null);
    try {
      /**
       * EL PERÍODO VA EXPLÍCITO, aunque el servidor sepa resolverlo solo.
       *
       * Es el que devolvió la respuesta que dibujó la tabla. Sin mandarlo, el
       * servidor lo resolvería otra vez con su reloj -- y una pestaña abierta
       * desde ayer, o un clic pasada la medianoche del 1°, bajaría el detalle
       * de OTRO mes que el que se está mirando. El archivo tiene que ser el de
       * la tabla que se tiene adelante.
       */
      const { bytes, nombreArchivo } = await repositorioAuditoria.exportarDiferenciasCadena(cadena.periodo);
      descargarArchivo(bytes, nombreArchivo ?? nombreCadenaDeRespaldo(cadena.periodo.anio, cadena.periodo.mes));
    } catch (e) {
      setAvisoExport(e instanceof Error ? e.message : 'No se pudo bajar el detalle de la cadena.');
    } finally {
      setBajandoCadena(false);
    }
  }

  async function bajarPlanilla(): Promise<void> {
    if (inventarioId === null) return;
    setBajando(true);
    try {
      const { bytes, nombreArchivo } = await repositorioHistorial.exportarCuadros(inventarioId);
      descargarArchivo(bytes, nombreArchivo ?? nombreCuadrosDeRespaldo(inventarioId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo bajar la planilla.');
    } finally {
      setBajando(false);
    }
  }

  return (
    <ScrollView style={styles.pagina} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
      <EncabezadoPagina
        migas={['Auditoría', 'Panel de auditoría']}
        titulo="Panel de auditoría"
        sub="Compara los conteos físicos contra el ERP en todas tus tiendas, y revisa las diferencias antes de la aprobación."
        onInicio={() => router.push('/auditor')}
        /* EL PERÍODO COMO DATO, no como desplegable: es el que devolvió el
           servidor. Ver el encabezado del archivo. */
        acciones={
          cadena !== null ? (
            <View style={styles.periodo}>
              <Text style={styles.periodoTexto}>{textoPeriodo(cadena.periodo)}</Text>
            </View>
          ) : null
        }
      />

      {/*
        EL PANORAMA DE LA CADENA. Va ARRIBA de la tienda elegida a propósito:
        la pregunta del Auditor al entrar es "cómo viene el mes", no "cómo
        viene esta tienda" -- esa se contesta abajo, después de elegir.
      */}
      {cargandoCadena ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : errorCadena !== null ? (
        <TarjetaWeb titulo="No se pudo cargar el resumen de la cadena" icono={Store} tono="neutro">
          <Text style={styles.error}>{errorCadena}</Text>
          <BotonWeb etiqueta="Reintentar" onPress={() => void cargarCadena()} />
        </TarjetaWeb>
      ) : cadena !== null ? (
        <>
          {/*
            LA TABLA ES EL SELECTOR. Tocar una fila elige esa tienda y las
            tarjetas de abajo pasan a mostrarla (`useSucursalAuditada`, el
            mismo contexto que comparten Ciclo, Historial y Liquidación).

            SIN `tinteDeFila`: los tres tintes de `TablaWeb` significan falta,
            cuadre y espera, y ninguno de los tres es "esta es la que estás
            mirando". La tienda elegida se marca con su nombre en el rojo de
            marca, que en esta app SÍ es el color de la opción seleccionada.
          */}
          <View style={styles.tabla}>
            <TablaWeb<ResumenTiendaCadena>
              titulo="Tiendas del período"
              sub={resumenDeCadena(cadena.total)}
              icono={Store}
              columnas={columnasDeTiendas(sucursalId)}
              filas={cadena.tiendas}
              claveDe={(tn) => String(tn.sucursalId)}
              onAbrirFila={(tn) => setSucursalElegida(tn.sucursalId)}
              vacio={<Text style={styles.vacio}>No hay tiendas en el padrón de la cadena.</Text>}
              pie={(mostradas, total) =>
                `Mostrando ${mostradas} de ${total} ${pluralizar(total, 'tienda', 'tiendas')}`
              }
              /* EXPORTAR VA EN LA TABLA, no en el encabezado de la página: el
                 archivo es el detalle de ESTAS filas, y un botón lejos de lo
                 que baja obliga a adivinar qué alcance tiene.

                 OTRO ÍCONO que el de la planilla de abajo (`Download`): son dos
                 .xlsx distintos en la misma pantalla -- este es la cadena
                 entera, aquel la tienda elegida -- y con el mismo ícono dos
                 veces, bajar el equivocado se descubre recién al abrirlo. */
              herramientas={
                exportCadena !== null ? (
                  <BotonIcono
                    icono={FileSpreadsheet}
                    etiqueta={
                      exportCadena.puedeExportar
                        ? `Exportar el detalle en Excel: una fila por producto con faltante o sobrante, de todas las tiendas del período.${notaCadena === null ? '' : ` ${notaCadena}`}`
                        : `Exportar el detalle en Excel: no disponible todavía. ${exportCadena.motivo}`
                    }
                    onPress={() => void bajarDetalleDeCadena()}
                    cargando={bajandoCadena}
                    deshabilitado={!exportCadena.puedeExportar}
                  />
                ) : null
              }
            />
            {/* EL MOTIVO A LA VISTA, no solo en el tooltip del botón apagado.
                Un ícono gris sin texto manda a pasar el mouse por encima para
                averiguar qué falta, y en la banda de abajo el motivo de la
                planilla lo dice el cartel de estado -- acá no hay cartel. */}
            {exportCadena !== null && !exportCadena.puedeExportar ? (
              <Text style={styles.notaExport}>{exportCadena.motivo}</Text>
            ) : notaCadena !== null ? (
              <Text style={styles.notaExport}>{notaCadena}</Text>
            ) : null}
            {avisoExport !== null ? <Text style={styles.error}>{avisoExport}</Text> : null}
          </View>
        </>
      ) : null}

      {/* LA TIENDA ELEGIDA Y SU ESTADO, en una banda: son el contexto de todo
          lo de abajo. Sin esto, tres tarjetas de números no dicen de qué
          tienda ni de qué momento hablan.

          YA NO HAY DESPLEGABLE: se elige tocando una fila de la tabla de
          arriba. Acá el nombre es un DATO, no un control -- ver el encabezado
          del archivo. */}
      <View style={[styles.banda, angosto && styles.bandaApilada]}>
        <View style={styles.bandaTienda}>
          <ChipIcono icono={Store} />
          <View style={styles.bandaTextos}>
            <Text style={styles.bandaEtiqueta}>Sucursal a auditar</Text>
            <Text style={styles.bandaTitulo}>
              {tiendaElegida?.sucursal ?? sesion.sucursal?.nombre ?? 'Elige una tienda en la tabla'}
            </Text>
            {resumen ? (
              <Text style={styles.bandaSub}>
                {resumen.contados} de {resumen.items} ítems contados · {conDiferencia}{' '}
                {pluralizar(conDiferencia, 'con diferencia', 'con diferencia')}
              </Text>
            ) : null}
          </View>
        </View>

        {/* LA PLANILLA, al lado del estado y no arriba en el encabezado.
            Decisión del usuario señalando el lugar: acá está pegada a la
            tienda y al momento del inventario, que es de lo que habla el
            archivo. Solo el ícono: el motivo por el que a veces no se puede lo
            dice el cartel de al lado, y repetirlo en un párrafo gris sería
            decir dos veces lo mismo. */}
        {planilla !== null ? (
          <BotonIcono
            icono={Download}
            etiqueta={
              planilla.puedeExportar
                ? `Exportar la planilla en Excel: faltantes, sobrantes, empresa y descuento.${notaPlanilla === null ? '' : ` ${notaPlanilla}`}`
                : `Exportar la planilla en Excel: no disponible todavía. ${planilla.motivo}`
            }
            onPress={() => void bajarPlanilla()}
            cargando={bajando}
            deshabilitado={!planilla.puedeExportar}
          />
        ) : null}

        <View style={[styles.cartel, estilosCartel[cartel.tono]]}>
          <CheckCircle2 size={22} color={tintaCartel[cartel.tono]} />
          <View style={styles.cartelTextos}>
            <Text style={[styles.cartelTitulo, { color: tintaCartel[cartel.tono] }]}>{cartel.titulo}</Text>
            <Text style={styles.cartelDetalle}>{cartel.detalle}</Text>
          </View>
        </View>
      </View>

      {cargando ? (
        <ActivityIndicator color={colors.rojo} style={styles.cargando} />
      ) : error !== null ? (
        <TarjetaWeb titulo="No se pudo cargar la auditoría" icono={BarChart3} tono="neutro">
          <Text style={styles.error}>{error}</Text>
          <BotonWeb etiqueta="Reintentar" variante="principal" onPress={() => void cargar()} />
        </TarjetaWeb>
      ) : sucursalId === null ? (
        /* NO ES "no hay nada para auditar": es que todavía no se eligió
           tienda. Antes las dos caían en el mismo cartel, y a un auditor sin
           tienda en su ficha la pantalla le decía que su sucursal no tenía
           inventario -- sobre una sucursal que nunca eligió. */
        <TarjetaWeb titulo="Elige una tienda" icono={Store} tono="neutro">
          <Text style={styles.vacio}>
            Toca una fila de la tabla de arriba para ver el detalle de esa tienda: su resultado, sus productos de
            empresa y lo que sigue.
          </Text>
        </TarjetaWeb>
      ) : resumen === null ? (
        <TarjetaWeb titulo="Todavía no hay nada para auditar" icono={BarChart3} tono="neutro">
          <Text style={styles.vacio}>
            No hay un inventario en curso en esta sucursal, o el ciclo de conteos no cerró ningún ítem todavía.
          </Text>
        </TarjetaWeb>
      ) : (
        <>
          <View style={[styles.fila, angosto && styles.filaApilada]}>
            <View style={styles.colAncha}>
            <TarjetaWeb titulo="Resultado del conteo" icono={BarChart3}>
              <FilaDato
                etiqueta="Cuadrado"
                valor={`${resumen.cuadrados} de ${resumen.auditables} auditables`}
                color={resumen.cuadrados > 0 ? colors.ok : undefined}
              />
              <FilaDato etiqueta="Faltante del conteo" valor={monto(resumen.valorFaltante, true)} />
              <FilaDato etiqueta="Sobrante del conteo" valor={monto(resumen.valorSobrante, false)} color={colors.ok} />
              <FilaDato etiqueta="Falta al personal" valor={monto(cuadros?.unidad.valorFaltante, true)} />
              <FilaDato etiqueta="Se audita aparte (paquete)" valor={monto(cuadros?.paquete.valorFaltante, true)} />
              <FilaDato etiqueta="Lo asume la empresa" valor={monto(cuadros?.empresa.valorFaltante, true)} />
              {/*
                EL NETO, y es la fila destacada de la tarjeta: es la plata que
                sale del sueldo.

                Sale de `valorADescontar` de la cadena y NO de `resumen`, que
                trae el faltante BRUTO del cuadro único (4,50 donde el neto es
                4,10). Con el bruto acá, la tarjeta y la columna "A descontar"
                de la tabla decían dos números distintos para lo mismo sobre la
                MISMA tienda -- y el de la tarjeta era el que no se le descuenta
                a nadie.

                Guion si la cadena no cargó: antes que mostrar el bruto
                haciéndolo pasar por el neto, se dice que no se sabe.
              */}
              <FilaDato
                etiqueta="Se le descuenta al personal"
                valor={tiendaElegida === null ? '—' : monto(tiendaElegida.valorADescontar, true)}
                destacada
              />
            </TarjetaWeb>

            </View>

            <View style={styles.colMedia}>
            <TarjetaWeb titulo="Productos de empresa" icono={Boxes} tono="atencion">
              <FilaDato etiqueta="Productos contados" valor={String(resumen.contadosDeEmpresa)} />
              <FilaDato etiqueta="Faltante" valor={monto(cuadros?.empresa.valorFaltante, true)} />
              <FilaDato etiqueta="Sobrante" valor={monto(cuadros?.empresa.valorSobrante, false)} color={colors.ok} />
              <FilaDato
                etiqueta="Paga la empresa"
                valor={cuadros === null ? '—' : monto(pagaLaEmpresa(cuadros.empresa), true)}
                destacada
              />
            </TarjetaWeb>

            </View>

            <View style={styles.colAcciones}>
            <TarjetaWeb titulo="Acciones" icono={Zap} tono="ok">
              <BotonWeb
                etiqueta="Ir a aprobación y lacrado"
                icono={Lock}
                variante="principal"
                onPress={() => router.push('/auditor/lacrado')}
              />
              <BotonWeb
                etiqueta="Revisar ítem por ítem"
                sub={`${resumen.items} ítems · ${conDiferencia} con diferencia`}
                icono={ClipboardList}
                onPress={() => router.push('/auditor/matriz')}
              />
            </TarjetaWeb>
            </View>
          </View>

          <View style={styles.banner}>
            <BotonWeb
              etiqueta="¿Un conteo quedó mal cargado? Corrígelo — el stock no se toca"
              icono={PencilLine}
              onPress={() => router.push('/auditor/corregir')}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const tintaCartel = { ok: colors.ok, atencion: colors.proceso, neutro: colors.gris } as const;

const estilosCartel = StyleSheet.create({
  ok: { backgroundColor: colors.okSuave },
  atencion: { backgroundColor: colors.procesoSuave },
  neutro: { backgroundColor: colors.esperaSuave },
});

const styles = StyleSheet.create({
  pagina: { flex: 1 },
  /**
   * UN TOPE DE ANCHO, aunque la ventana tenga 1.900.
   *
   * Sin esto cada fila de "etiqueta a la izquierda, número a la derecha" se
   * estira medio metro y hay que barrer la cabeza para juntar el concepto con
   * su cifra -- *"parecen estirados"*. La matriz es la excepción y por eso usa
   * todo el ancho: ahí el ancho de más son columnas, no aire.
   *
   * Pegado a la IZQUIERDA y no centrado: la barra lateral ya está a ese lado y
   * el ojo viene de ahí; centrarlo abriría un pasillo vacío entre el menú y el
   * contenido.
   */
  contenido: { padding: spacing.xxl, gap: spacing.lg },
  centro: { flex: 1 },
  cargando: { marginTop: spacing.xxl },

  banda: {
    // Ya no lleva `zIndex`: existía para que el desplegable del selector de
    // sucursal se dibujara encima de las tarjetas de abajo, y ese selector se
    // fue -- ahora la tienda se elige en la tabla. Un apilamiento sin nada que
    // apilar es una regla que el próximo lector tiene que descartar a mano.
    width: TOPE_ANCHO,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.blanco,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: spacing.lg,
    ...shadow.tarjeta,
  },
  bandaApilada: { flexDirection: 'column', alignItems: 'stretch' },
  bandaTienda: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bandaTextos: { flex: 1, gap: 2 },
  bandaEtiqueta: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  bandaTitulo: { fontSize: fontSize.lg, color: colors.tinta, fontFamily: fonts.bold },
  bandaSub: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  /** El período: un dato, no un control. Por eso no tiene borde ni chevron. */
  periodo: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.esperaSuave },
  periodoTexto: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.semibold },

  /**
   * LAS CUATRO CIFRAS DE LA CADENA. Anchos propios por lo mismo que las tres
   * tarjetas de abajo: con `flex: 1` en un monitor ancho el rótulo queda a
   * medio metro de su número. La primera es más ancha porque lleva tres
   * renglones de texto; las tres de plata miden lo que mide un monto.
   */
  /**
   * EL ANCHO VA EN LA COLUMNA QUE ENVUELVE, nunca en la tarjeta: `TarjetaWeb`
   * trae `flex: 1`, que en la web es `flex: 1 1 0%` y le gana a cualquier
   * ancho que se le pase después. Pasado a la tarjeta, las cuatro se
   * encogieron hasta una letra de ancho y el texto salió en vertical.
   */

  /** La tabla sí usa el ancho de las cuatro tarjetas: acá el ancho son columnas, no aire. */
  /** El ancho del bloque, y el aire entre la tabla y la nota de la
   *  exportación que puede quedar debajo. */
  tabla: { width: TOPE_ANCHO, maxWidth: '100%', gap: spacing.sm },
  /** El motivo (o la salvedad) de la exportación, debajo de la tabla. */
  notaExport: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 19 },

  cartel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, minWidth: 320 },
  cartelTextos: { flex: 1, gap: 1 },
  cartelTitulo: { fontSize: fontSize.lg, fontFamily: fonts.bold },
  cartelDetalle: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },

  fila: { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch', width: TOPE_ANCHO, maxWidth: '100%' },
  /**
   * LAS TRES TARJETAS NO MIDEN LO MISMO, y no es capricho: miden lo que
   * necesita su contenido. En tercios iguales, la de Acciones -- dos botones y
   * nada más -- quedaba con medio metro de blanco abajo y los botones
   * estirados de borde a borde. Corrección del usuario: *"parecen estirados"*.
   *
   * La de Resultado es la que más filas tiene, así que se lleva la parte más
   * ancha; la de Acciones toma un ancho fijo, el de sus botones.
   */
  /**
   * ANCHOS FIJOS y no fracciones del ancho disponible.
   *
   * Con `flex: 1` cada tarjeta se estiraba hasta donde diera la ventana, y en
   * un monitor ancho la etiqueta quedaba a medio metro de su cifra. Con una
   * medida propia, una fila se lee de un golpe de vista en cualquier pantalla
   * -- que es de lo que se trata esta tarjeta.
   *
   * La de Resultado es la más ancha porque tiene las etiquetas más largas
   * ("Se le descuenta al personal"); la de Acciones mide lo que miden sus
   * botones.
   */
  // `flexShrink: 0` ademas del ancho: en la web el default de `flexShrink` es
  // 1 (en React Native es 0), asi que sin esto las tarjetas se encogian hasta
  // el tamaño de su texto y el ancho pedido no se respetaba. Es el mismo
  // desencuentro que cortaba los badges de Usuarios.
  /**
   * EL ANCHO VA EN UNA COLUMNA QUE ENVUELVE, no en la tarjeta.
   *
   * `TarjetaWeb` trae `flex: 1` en su estilo base, y en la web ese atajo se
   * traduce a `flex: 1 1 0%`: le gana a cualquier `flexBasis` que se le pase
   * después, así que el ancho pedido se ignoraba y la tarjeta se encogía hasta
   * el tamaño de su texto. Envolviéndola, el ancho lo fija la columna y la
   * tarjeta simplemente la llena.
   *
   * `flexShrink: 0` porque en la web el default es 1 -- en React Native es 0 --
   * y sin eso las columnas también se encogen. Es el mismo desencuentro que
   * cortaba los badges de Usuarios.
   */
  colAncha: { width: 430, flexGrow: 0, flexShrink: 0 },
  colMedia: { width: 330, flexGrow: 0, flexShrink: 0 },
  colAcciones: { width: 340, flexGrow: 0, flexShrink: 0 },
  /** El banner de corregir tampoco cruza la pantalla: un renglón de texto de
   *  1.300px obliga a barrer la cabeza para llegar del ícono al chevron. */
  banner: { maxWidth: 620 },
  filaApilada: { flexDirection: 'column' },

  error: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular },
  vacio: { fontSize: fontSize.sm, color: colors.gris, fontFamily: fonts.regular, lineHeight: 20 },
});
