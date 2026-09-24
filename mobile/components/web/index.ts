/**
 * Los componentes de la WEB del Auditor. No los usa el teléfono.
 *
 * Existen aparte de `components/ui` porque son otro lenguaje visual: tarjeta
 * con chip de ícono sobre lienzo gris, badges con punto, encabezado de página
 * con miga de pan. Mezclarlos con los del teléfono terminaría en componentes
 * con dos diseños adentro y un `Platform.OS` en cada estilo.
 *
 * Lo que SÍ comparten es `lib/theme.ts`: los colores, la tipografía y los
 * radios son los mismos: el diseño de la web no trajo una paleta nueva, trajo
 * otra forma de usar la que ya había.
 */
export { BadgeDiferencia, BadgeEstado, type BadgeEstadoProps } from './BadgeEstado';
export { BotonWeb, type BotonWebProps } from './BotonWeb';
export { ChipIcono, type ChipIconoProps, type TonoChip } from './ChipIcono';
export { EncabezadoPagina, type EncabezadoPaginaProps } from './EncabezadoPagina';
export { FilaDato, TarjetaWeb, type TarjetaWebProps } from './TarjetaWeb';
export {
  CeldaTexto,
  TablaWeb,
  type AlineacionColumna,
  type ColumnaTabla,
  type TablaWebProps,
  type TinteFila,
} from './TablaWeb';
