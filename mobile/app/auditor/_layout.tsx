import { RolTabsLayout } from '../../components/navegacion/RolTabsLayout';
import { SucursalAuditadaProvider } from '../../lib/sucursal-auditada-contexto';

export default function AuditorLayout() {
  // El Provider cuelga acá para que la sucursal elegida se comparta entre las
  // pestañas del auditor (Inicio, Auditoría, Ciclo, Historial) y sobreviva al
  // cambio de una a otra. Ver lib/sucursal-auditada-contexto.tsx.
  return (
    <SucursalAuditadaProvider>
      <RolTabsLayout rol="auditor" />
    </SucursalAuditadaProvider>
  );
}
