import { RefreshCw, Wifi, WifiOff } from 'lucide-react-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HojaConteo } from '../../lib/dominio/tipos';
import type { EstadoCola } from '../../lib/puertos/repositorios';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { formatoFechaHora } from './formato';

/**
 * `error` es DISTINTO de `pendiente`: pendiente es "todavía no llegó
 * WiFi, se va a sincronizar solo" (normal, no hace falta que nadie haga
 * nada). `error` es "esto no se va a arreglar solo insistiendo" (ej. la
 * hoja ya la finalizó otro colaborador, sesión vencida) — antes las dos
 * mostraban el MISMO mensaje genérico, y eso es lo que la auditoría marcó
 * como un limbo silencioso: el operario no podía distinguir "esperá" de
 * "andá a buscar ayuda".
 */
export type EstadoBandaSync = 'ok' | 'pendiente' | 'offline' | 'error';

export interface BandaSyncProps {
  estado: EstadoBandaSync;
  mensaje: string;
  /** Si viene, la banda se puede tocar para forzar una sincronización manual (ver puertos/repositorios.ts#Sincronizador). */
  onSincronizar?: () => void;
}

export interface EstadoSincronizacion {
  estado: EstadoBandaSync;
  mensaje: string;
}

/**
 * `hoja.sync` ya viene en cada HojaConteo (ver dominio/tipos.ts) y alcanza
 * para saber si HAY cambios locales sin sincronizar. Lo que `hoja.sync`
 * NO sabe es CUÁNDO fue la última sincronización real ni si el problema
 * es "todavía no hay WiFi" o "esto quedó rechazado" — para eso hace falta
 * `cola` (`Sincronizador.estado()`, puertos/repositorios.ts).
 *
 * `cola` es OPCIONAL a propósito: sigue funcionando con solo `hojas` para
 * quien todavía no se suscribió al sincronizador (compatibilidad), pero
 * el mensaje es más pobre (no sabe distinguir error de pendiente, ni
 * decir cuándo sincronizó por última vez) — todas las pantallas nuevas
 * deberían pasar `cola`.
 */
export function sincronizacionDeHojas(hojas: HojaConteo[], cola?: EstadoCola): EstadoSincronizacion {
  if (cola) {
    // (c) RECHAZADO -- primero de todo, incluso antes que `sinRed`: es lo
    // único que no se arregla ni esperando ni recuperando la señal, así que
    // no puede quedar tapado por un mensaje que invite a esperar. Trae el
    // motivo real y qué hacer (sqlite-cola.ts#mensajeRechazoPorPermiso).
    if (cola.rechazo) return { estado: 'error', mensaje: cola.rechazo };
    if (cola.error) return { estado: 'error', mensaje: cola.error };
    // `sinRed` gana sobre el conteo de pendientes: es la respuesta a la
    // pregunta que de verdad se hace quien está sin señal contando ("¿esto
    // se guardó?"), y no depende de que haya corrido una sincronización
    // (que sin red no corre nunca) — se sabe apenas cambia la conectividad
    // (sincronizador.ts#actualizarConectividad).
    if (cola.sinRed) {
      return cola.pendientes > 0
        ? {
            estado: 'offline',
            mensaje: `Sin conexión — ${cola.pendientes} ${cola.pendientes === 1 ? 'conteo guardado' : 'conteos guardados'} en el equipo, se van a subir solos.`,
          }
        : { estado: 'offline', mensaje: 'Sin conexión — sigue contando, se guarda en el equipo y sube solo.' };
    }
    // (a) TODO SINCRONIZADO -- la banda no se dibuja (ver `BandaSync`).
    if (cola.pendientes === 0) return { estado: 'ok', mensaje: 'Sincronizado' };
    // (b) PENDIENTE -- transitorio. El texto dice que el reintento es
    // automático, que era justo lo que el cliente no podía saber: veía "1
    // ítem sin sincronizar" con un botón de recargar al lado y entendía que
    // tenía que apretarlo él ("la sincronización es automática supongo, no
    // debe ser manual"). Ahora lo dice.
    const sufijo = cola.ultimaSync ? ` · última sync ${formatoFechaHora(cola.ultimaSync)}` : '';
    return {
      estado: 'pendiente',
      mensaje: `Subiendo ${cola.pendientes} ${cola.pendientes === 1 ? 'conteo' : 'conteos'} — se sube solo${sufijo}`,
    };
  }

  if (hojas.some((h) => h.sync === 'error')) {
    return { estado: 'error', mensaje: 'No se pudo sincronizar — revisa la conexión o pide ayuda.' };
  }
  const pendientes = hojas.filter((h) => h.sync !== 'sincronizado').length;
  if (pendientes === 0) return { estado: 'ok', mensaje: 'Sincronizado' };
  return {
    estado: 'pendiente',
    mensaje: `Guardado en el equipo · ${pendientes} ${pendientes === 1 ? 'hoja sin sincronizar' : 'hojas sin sincronizar'}`,
  };
}

/**
 * La versión de `sincronizacionDeHojas` para un TABLERO (Inicio) — nunca
 * la razón puntual de un rechazo, solo si hay algo sin subir.
 *
 * HALLAZGO (2026-09-08): en el Inicio del Coordinador apareció "La hoja
 * ya está finalizada: no se puede corregir el conteo." de un conteo
 * rechazado que estaba en la cola de OTRA persona, en OTRA hoja — el
 * Coordinador no cuenta nada, no puede hacer nada con esa razón ahí. Ya
 * se había acotado esto en Contar (5e15736, `hoja_id` puntual) porque ahí
 * SÍ hay una hoja concreta abierta y algo que hacer con el rechazo; el
 * Inicio no tiene eso — es un tablero, nadie abre ninguna hoja desde acá.
 *
 * Por eso esta función IGNORA `cola` (el estado global) por completo y
 * solo mira `hoja.sync` de las hojas que la pantalla ya te muestra
 * (`mias()` para el Contador, `todas()` para Coordinador/Auditor — cada
 * una ya viene scopeada a su rol): "sincronizado" o "no", nunca "por
 * qué". Para saber el motivo real de una hoja puntual hay que abrirla en
 * Contar o Mis hojas, que es donde de verdad se puede actuar.
 */
export function resumenParaTablero(hojas: HojaConteo[]): EstadoSincronizacion {
  const pendientes = hojas.filter((h) => h.sync !== 'sincronizado').length;
  if (pendientes === 0) return { estado: 'ok', mensaje: 'Sincronizado' };
  return {
    estado: 'pendiente',
    mensaje: `Guardado en el equipo · ${pendientes} ${pendientes === 1 ? 'hoja sin sincronizar' : 'hojas sin sincronizar'}`,
  };
}

const PALETA: Record<EstadoBandaSync, { fondo: string; color: string }> = {
  ok: { fondo: colors.okSuave, color: colors.ok },
  pendiente: { fondo: colors.procesoSuave, color: colors.proceso },
  offline: { fondo: colors.procesoSuave, color: colors.proceso },
  // `falta` (rojizo, ya usado en la matriz de auditoría) y no `rojo`: acá
  // sí corresponde un tono de alerta -- a diferencia de pendiente/offline,
  // esto NO se va a resolver solo esperando.
  error: { fondo: colors.faltaSuave, color: colors.falta },
};

/**
 * Banda de sincronización — offline-first: los equipos van con la WiFi de
 * la tienda, sin chip, así que perder señal es lo normal, no la excepción.
 * Se oculta cuando todo está sincronizado (`estado === 'ok'`), igual que
 * en mobile/design/conteo.html y home.html — no hace falta un banner de
 * "todo bien" permanente, solo avisar cuando hay algo pendiente.
 *
 * Tocable cuando trae `onSincronizar`: el operario que ve "3 pendientes"
 * tiene que poder empujarlas, no solo esperar a que algún disparador
 * automático las levante.
 */
export function BandaSync({ estado, mensaje, onSincronizar }: BandaSyncProps): JSX.Element | null {
  if (estado === 'ok') return null;
  const paleta = PALETA[estado];
  const Icono = estado === 'offline' ? WifiOff : estado === 'error' ? WifiOff : Wifi;

  const contenido = (
    <View style={[styles.raiz, { backgroundColor: paleta.fondo }]}>
      <Icono size={15} color={paleta.color} />
      <Text style={[styles.texto, { color: paleta.color }]}>{mensaje}</Text>
      {onSincronizar ? <RefreshCw size={13} color={paleta.color} /> : null}
    </View>
  );

  if (!onSincronizar) return contenido;
  return (
    <Pressable onPress={onSincronizar} accessibilityRole="button" accessibilityLabel="Sincronizar ahora">
      {contenido}
    </Pressable>
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
  texto: { flex: 1, fontSize: 11.5, fontFamily: fonts.bold },
});
