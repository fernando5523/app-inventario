import React from 'react'

interface FormFieldProps {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  helperText?: string
}

export function FormField({
  label,
  error,
  required = false,
  children,
  className = '',
  helperText,
}: FormFieldProps) {
  return (
    <div className={`mb-4 ${className}`}>
      <label className="block text-sm font-semibold text-[var(--fg)] mb-1">
        {label}
        {required && <span className="text-[var(--danger)] ml-1">*</span>}
      </label>
      {children}
      {helperText && (
        <p className="mt-1 text-xs text-[var(--fg-muted)]">{helperText}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  )
}
