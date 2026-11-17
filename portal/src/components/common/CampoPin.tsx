import { useId } from 'react'

interface CampoPinProps {
  etiqueta: string
  value: string
  onChange: (pin: string) => void
  autoFocus?: boolean
  disabled?: boolean
  /** Se dispara con Enter cuando ya hay seis dígitos. */
  onSubmit?: () => void
}

/** Seis dígitos exactos: el mismo largo que valida el servidor. */
export const LARGO_PIN = 6

/**
 * EL CAMPO DEL PIN, enmascarado y de seis dígitos.
 *
 * NO es el teclado numérico en pantalla de la app móvil, y es a propósito: eso
 * existe porque en el teléfono el teclado del sistema tapa media pantalla y
 * porque se marca con el pulgar, parado en un pasillo. Esto es una web de
 * escritorio con teclado físico.
 *
 * `type="password"` y no `type="number"`: el número trae las flechitas de
 * incremento, acepta `e`, `+` y `-`, y no enmascara. Acá el filtro de dígitos
 * lo hace el `onChange` -- se descarta todo lo que no sea 0-9 y se corta en
 * seis, así que pegar un PIN con espacios o guiones entra igual en vez de
 * rechazarse.
 *
 * `inputMode="numeric"` deja el teclado numérico en los pocos casos en que
 * alguien abra el portal desde una tablet.
 */
export function CampoPin({ etiqueta, value, onChange, autoFocus, disabled, onSubmit }: CampoPinProps) {
  const id = useId()
  const completo = value.length === LARGO_PIN

  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-[var(--fg)] mb-1.5">
        {etiqueta}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={LARGO_PIN}
        aria-describedby={`${id}-ayuda`}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, LARGO_PIN))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && completo && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
        className="gh-input tracking-[0.5em] font-mono text-center"
      />
      <p id={`${id}-ayuda`} className="text-[11px] text-[var(--fg-muted)] mt-1">
        {completo ? 'Seis dígitos.' : `${value.length} de ${LARGO_PIN} dígitos.`}
      </p>
    </div>
  )
}
