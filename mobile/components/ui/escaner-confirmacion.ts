/**
 * Máquina de estados del anti-duplicados del escáner.
 *
 * Vive en un módulo aparte de ModalEscaner.tsx por la misma razón que
 * escaner-geometria.ts: es lógica pura (sin react-native), así que se puede
 * probar de verdad sin cámara (ver escaner-confirmacion.test.ts).
 *
 * REGLA: se exigen `umbral` lecturas CONSECUTIVAS del MISMO código antes de
 * aceptarlo. Cualquier código distinto — o cualquier lectura descartada por
 * el filtro por bounds — reinicia el contador a cero. Ver `descartar()`.
 *
 * Todo el estado es mutable (no inmutable/funcional) a propósito: esto
 * reemplaza refs de React que vivían sueltas en el componente porque
 * `onBarcodeScanned` dispara a ~30fps y el estado tiene que estar
 * disponible YA en el frame siguiente, no en el próximo render.
 */
export class ConfirmadorDeLecturas {
  private candidato: { codigo: string; vistas: number } | null = null;
  private ultimoAceptado: { codigo: string; en: number } | null = null;

  constructor(
    private readonly umbral: number,
    private readonly msAntirrebote: number,
  ) {}

  /**
   * Procesa una lectura que YA pasó el filtro por bounds (está dentro del
   * recuadro). Devuelve `true` cuando el código queda confirmado y hay que
   * entregarlo — en ese momento también arma el antirrebote para que no
   * se vuelva a entregar el mismo código de inmediato.
   */
  procesar(codigo: string, ahora: number): boolean {
    const previo = this.ultimoAceptado;
    if (previo && previo.codigo === codigo && ahora - previo.en < this.msAntirrebote) return false;

    // Código distinto al candidato actual (o no había candidato): arranca
    // de nuevo en 1. Es la garantía de que las lecturas tienen que ser
    // CONSECUTIVAS — A,B,A nunca acumula vistas de A a través de B.
    if (this.candidato?.codigo === codigo) {
      this.candidato.vistas++;
    } else {
      this.candidato = { codigo, vistas: 1 };
    }
    if (this.candidato.vistas < this.umbral) return false;

    this.ultimoAceptado = { codigo, en: ahora };
    this.candidato = null;
    return true;
  }

  /**
   * Una lectura que NO pasó el filtro (fuera del recuadro, o sin geometría
   * utilizable) rompe cualquier racha en curso — el código de al lado
   * entrando y saliendo de cuadro no puede "esperar su turno" para
   * acumular vistas.
   */
  descartar(): void {
    this.candidato = null;
  }

  /** Al reabrir el modal: ningún candidato ni antirrebote de la sesión anterior debe sobrevivir. */
  reiniciar(): void {
    this.candidato = null;
    this.ultimoAceptado = null;
  }
}
