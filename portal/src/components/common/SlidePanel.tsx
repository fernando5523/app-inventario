import { ReactNode } from 'react'
import { ResponsiveModalShell } from './ResponsiveModalShell'

interface SlidePanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Se reenvía al shell: con cambios pendientes, backdrop y Escape no hacen nada. */
  isDirty?: boolean
}

export function SlidePanel({ isOpen, onClose, title, children, footer, size = 'md', isDirty = false }: SlidePanelProps) {
  return (
    <ResponsiveModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      size={size}
      isDirty={isDirty}
    >
      {children}
    </ResponsiveModalShell>
  )
}
