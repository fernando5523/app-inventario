import { AjustesNegativosScreen } from '../../components/pantallas/AjustesNegativosScreen';

/**
 * NO es un tab (no está en TABS_POR_ROL.auditor, ver components/navegacion/tabs.ts)
 * -- se llega por `router.push` desde Liquidación, con `inventarioId` como
 * parámetro de ruta. Mismo patrón que auditor/comparativo.tsx.
 */
export default function AuditorAjustesNegativos() {
  return <AjustesNegativosScreen />;
}
