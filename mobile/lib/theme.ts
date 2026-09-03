// Design Tokens de la aplicación móvil de Inventario — identidad Trujillo.
// Fuente de verdad: .claude/skills/trujillo-ui/SKILL.md y assets/controles.css
// (ya validados en mobile/design/login.html). El rojo es SIEMPRE acción,
// nunca un estado — los estados (ok/proceso/espera) tienen su propia paleta.
export const colors = {
  rojo: '#D82018',
  rojoHover: '#B81810',
  rojoSuave: '#FDF0EF',
  dorado: '#F8B818',

  fondo: '#FFFFFF',
  campo: '#FFFFFF',
  tinta: '#1C1917',
  gris: '#6B6560',
  grisClaro: '#9A938D',
  borde: '#E3DEDA',
  blanco: '#FFFFFF',

  ok: '#0A6B57',
  okSuave: '#E7F4EF',
  proceso: '#8A5A05',
  procesoSuave: '#FDF3DC',
  espera: '#6B6560',
  esperaSuave: '#F2EFED',

  /** Fondo del modal (PIN, confirmaciones): rgba(28,25,23,.42) en la maqueta. */
  overlay: 'rgba(28, 25, 23, 0.42)',
  /** Superficie del control deshabilitado: #F7F5F4 en la maqueta. */
  campoDeshabilitado: '#F7F5F4',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { sm: 8, md: 10, lg: 12, xl: 16, xxl: 20, full: 9999 } as const;

export const fontSize = { xs: 11, sm: 13, base: 15.5, lg: 17, xl: 21, xxl: 27, xxxl: 32 } as const;

// Nombres de familia que devuelve useFonts() en app/_layout.tsx (ver
// @expo-google-fonts/figtree y @expo-google-fonts/baloo-2). Los
// componentes leen esto, nunca un string suelto -- si el peso cambia,
// cambia en un solo lugar.
export const fonts = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  marca: 'Baloo2_700Bold',
} as const;

export const shadow = {
  card: {
    shadowColor: colors.tinta,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  modal: {
    shadowColor: colors.tinta,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 30,
    elevation: 14,
  },
} as const;
