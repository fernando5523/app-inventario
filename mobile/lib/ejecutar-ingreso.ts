import type { Sesion } from './dominio/tipos';

export interface AccionesIngreso {
  /** Llama al repositorio de sesión. Inyectada: este helper no conoce el contenedor. */
  ingresar: (colaboradorId: number, pin: string) => Promise<Sesion>;
  /** Éxito: entrar al grupo de tabs del rol. */
  alEntrar: (sesion: Sesion) => void;
  /**
   * Vaciar el PIN. Se llama ante CUALQUIER rechazo, y ANTES de `alRechazar`
   * — ese orden es el arreglo del bug, no un detalle (ver abajo).
   */
  vaciarPin: () => void;
  /** Mostrar el error y dejar el foco listo para reintentar. */
  alRechazar: (mensaje: string) => void;
  /** Prender/apagar el spinner del botón Ingresar. */
  marcarIngresando: (activo: boolean) => void;
}

/**
 * Orquesta un intento de ingreso al login. Vive FUERA de la pantalla para
 * poder probarse sin montar React Native: `app/index.tsx` solo cablea los
 * callbacks contra su estado (`setPin`, `Alert.alert`, `router.replace`…).
 *
 * EL BUG QUE ARREGLA (verificado por min-5 en la app, de bloqueo): tras un
 * PIN rechazado el campo NO se vaciaba. Los 6 puntos quedaban puestos; quien
 * reintentaba escribía sobre un campo lleno (el teclado no toma más dígitos
 * con el PIN completo) o reenviaba el MISMO PIN, y con 8 intentos cada 15 min
 * por colaborador (backend sesion.routes.ts) se autobloqueaba sin entender por
 * qué. Por eso `vaciarPin()` se llama SIEMPRE que hubo rechazo, y ANTES de
 * `alRechazar()`: cuando la persona cierra el aviso, el campo ya está vacío y
 * listo para reintentar, no lleno.
 *
 * En el éxito NO se apaga el spinner: la pantalla se va a otro grupo de tabs y
 * apagarlo sería tocar estado de un componente que se está desmontando.
 */
export async function ejecutarIngreso(colaboradorId: number, pin: string, acciones: AccionesIngreso): Promise<void> {
  acciones.marcarIngresando(true);
  try {
    const sesion = await acciones.ingresar(colaboradorId, pin);
    acciones.alEntrar(sesion);
  } catch (error) {
    acciones.vaciarPin();
    acciones.marcarIngresando(false);
    acciones.alRechazar(error instanceof Error ? error.message : 'Intentá de nuevo.');
  }
}
