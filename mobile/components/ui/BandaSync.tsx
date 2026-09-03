import { Wifi, WifiOff } from 'lucide-react-native';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HojaConteo } from '../../lib/dominio/tipos';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export type EstadoBandaSync = 'ok' | 'pendiente' | 'offline';

export interface BandaSyncProps {
  estado: EstadoBandaSync;
  mensaje: string;
}

export interface EstadoSincronizacion {
  estado: EstadoBandaSync;
  mensaje: string;
}

/**
 * `hoja.sync` ya viene en cada HojaConteo (ver dominio/tipos.ts): no hace
 * falta el puerto Sincronizador (todavía no existe) para saber si hay
 * cambios locales sin sincronizar en las hojas que un rol puede tocar.
 * Compartida por InicioScreen, mis-hojas.tsx y contar.tsx — un solo lugar
 * calcula esto, no una copia por pantalla.
 */
export function sincronizacionDeHojas(hojas: HojaConteo[]): EstadoSincronizacion {
  const pendientes = hojas.filter((h) => h.sync !== 'sincronizado').length;
  if (pendientes === 0) return { estado: 'ok', mensaje: 'Sincronizado' };
  return {
    estado: 'pendiente',
    mensaje: `Guardado en el equipo · ${pendientes} ${pendientes === 1 ? 'hoja sin sincronizar' : 'hojas sin sincronizar'}`,
  };
}

// TODO: en las maquetas HTML "offline" usa un cuarto color semántico
// (--falta, rojizo) que todavía no existe en lib/theme.ts (theme.ts no
// está en el alcance de esta tarea). Hasta que se agregue, "offline"
// reusa el tono de "pendiente" — las diferencia el ícono (Wifi/WifiOff) y
// el texto, no el color. No usar --rojo acá: es la acción, nunca un estado.
const PALETA: Record<EstadoBandaSync, { fondo: string; color: string }> = {
  ok: { fondo: colors.okSuave, color: colors.ok },
  pendiente: { fondo: colors.procesoSuave, color: colors.proceso },
  offline: { fondo: colors.procesoSuave, color: colors.proceso },
};

/**
 * Banda de sincronización — offline-first: los equipos van con la WiFi de
 * la tienda, sin chip, así que perder señal es lo normal, no la excepción.
 * Se oculta cuando todo está sincronizado (`estado === 'ok'`), igual que
 * en mobile/design/conteo.html y home.html — no hace falta un banner de
 * "todo bien" permanente, solo avisar cuando hay algo pendiente.
 */
export function BandaSync({ estado, mensaje }: BandaSyncProps): JSX.Element | null {
  if (estado === 'ok') return null;
  const paleta = PALETA[estado];
  const Icono = estado === 'offline' ? WifiOff : Wifi;

  return (
    <View style={[styles.raiz, { backgroundColor: paleta.fondo }]}>
      <Icono size={15} color={paleta.color} />
      <Text style={[styles.texto, { color: paleta.color }]}>{mensaje}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  texto: { fontSize: 11.5, fontFamily: fonts.bold },
});
