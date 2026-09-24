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
  /** Superficie neutra para controles secundarios (opciones de un speed
   *  dial, riel de un switch): --riel en controles.css, 14.49:1 con tinta. */
  riel: '#EDE9E6',

  ok: '#0A6B57',
  okSuave: '#E7F4EF',
  proceso: '#8A5A05',
  procesoSuave: '#FDF3DC',
  espera: '#6B6560',
  esperaSuave: '#F2EFED',
  // Cuarto estado semántico del design system (.claude/skills/trujillo-ui):
  // faltantes y diferencias. Contraste verificado 6.56:1 / 5.63:1. Estaba en
  // controles.css desde la pantalla 4 pero nunca se había portado al theme.
  falta: '#A23B2E',
  faltaSuave: '#FBEAE7',

  /** Fondo del modal (PIN, confirmaciones): rgba(28,25,23,.42) en la maqueta. */
  overlay: 'rgba(28, 25, 23, 0.42)',
  /** Superficie del control deshabilitado: #F7F5F4 en la maqueta. */
  campoDeshabilitado: '#F7F5F4',
  /**
   * EL GRIS DE LA PÁGINA, y por qué existe SOLO para la web.
   *
   * En el teléfono el fondo es blanco y las tarjetas también: se separan por
   * su borde, y alcanza porque la pantalla mide 400px y hay una cosa a la vez.
   * En un monitor no alcanza -- blanco sobre blanco a 1900px de ancho es una
   * lámina sin relieve, y las tarjetas dejan de leerse como tarjetas.
   *
   * Este gris es el lienzo sobre el que flotan. Es el cambio que más hace por
   * el diseño nuevo y el único color que hubo que agregar: el resto de la
   * paleta del mockup ya estaba (el rojo de marca, el `rojoSuave` de las
   * bandas, el verde de sobrante, el rojo de faltante).
   *
   * NO se usa en Android ni iOS. Ver `RolTabsLayout.web.tsx`.
   */
  lienzo: '#F7F6F5',
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
  /**
   * La sombra de una TARJETA en web: apenas un despegue del lienzo, no un
   * relieve. Con el gris de fondo (`colors.lienzo`) y el borde, esto es lo
   * último que hace falta para que la tarjeta se lea como una pieza aparte.
   *
   * Mucho más suave que `modal`: un modal se pone ENCIMA de todo y tiene que
   * decirlo; una tarjeta es parte de la página.
   */
  tarjeta: {
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
