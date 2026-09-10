import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from 'react';

/**
 * La sucursal que el AUDITOR está auditando, COMPARTIDA entre sus pantallas.
 *
 * El auditor no tiene tienda: audita toda la cadena y elige cuál mirar. Para
 * que no sea confuso, esa elección es UNA sola y se comparte: si elige Market
 * Carhuaz en el Panel de Auditoría, el Ciclo, el Historial y el Inicio la
 * respetan. Sin esto, cada pantalla tendría su propio selector y la persona
 * podría estar viendo Carhuaz en una y Bolívar en otra sin darse cuenta.
 *
 * `elegida` es el id CRUDO que eligió (null = todavía no eligió). Cada pantalla
 * lo combina con la de su ficha vía `sucursal-en-foco.ts#sucursalEnFoco` (que
 * para el Coordinador/Conteo ignora esto y usa la de su sesión).
 *
 * El Provider cuelga del layout del auditor (app/auditor/_layout.tsx), así que
 * el estado sobrevive al cambio de pestaña. Los componentes compartidos con
 * otros roles (CicloScreen, HistorialScreen, InicioScreen) llaman al hook
 * IGUAL: fuera del Provider (Coordinador, Administrador, Conteo) devuelve el
 * default inerte (`elegida: null`, `elegir` no-op) y esas pantallas siguen
 * usando la sucursal de su sesión.
 */
interface SucursalAuditada {
  elegida: number | null;
  elegir: (sucursalId: number) => void;
}

const Contexto = createContext<SucursalAuditada>({ elegida: null, elegir: () => {} });

export function SucursalAuditadaProvider({ children }: { children: ReactNode }): JSX.Element {
  const [elegida, setElegida] = useState<number | null>(null);
  const valor = useMemo<SucursalAuditada>(() => ({ elegida, elegir: (id) => setElegida(id) }), [elegida]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSucursalAuditada(): SucursalAuditada {
  return useContext(Contexto);
}
