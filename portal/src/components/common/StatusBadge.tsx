
interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

const statusColorMap: Record<string, string> = {
  // Success states
  active: 'success',
  completed: 'success',
  approved: 'success',
  emitido: 'success',
  INCOME: 'success',
  RECEIVED: 'success',

  // Warning states
  pending: 'warning',
  processing: 'warning',
  abierta: 'warning',
  OPEN: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  IN_TRANSIT: 'warning',
  PENDING: 'warning',
  IN_PROGRESS: 'warning',
  FINISHED: 'info',
  APPLIED: 'success',
  REGISTERED: 'success',
  PROCESSED: 'info',

  // Danger states
  inactive: 'danger',
  rejected: 'danger',
  cancelled: 'danger',
  voided: 'danger',
  anulado: 'danger',
  EXPENSE: 'danger',
  CANCELLED: 'danger',
  REJECTED: 'danger',

  // Info states
  draft: 'info',
  sent: 'info',
  enviado_sunat: 'info',
  DRAFT: 'info',
  SENT: 'info',

  // Default states
  cerrada: 'default',
  CLOSED: 'default',
  // Estados de cotización (enum QuotationStatus; DRAFT/SENT ya están arriba)
  ACCEPTED: 'success',
  EXPIRED: 'warning',
  CONVERTED: 'default',
}

const variantClasses: Record<string, string> = {
  success: 'bg-[var(--success-light)] text-[var(--success-hover)] border-[var(--success-border)]',
  warning: 'bg-[var(--warning-light)] text-[var(--warning)] border-[var(--warning-border)]',
  danger: 'bg-[var(--danger-light)] text-[var(--danger)] border-[var(--danger-border)]',
  info: 'bg-[var(--primary-light)] text-[var(--primary)] border-[var(--info-border)]',
  default: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] border-[var(--border)]',
}

const statusLabels: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  pending: 'Pendiente',
  processing: 'En proceso',
  completed: 'Completado',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  draft: 'Borrador',
  sent: 'Enviado',
  cancelled: 'Cancelado',
  voided: 'Anulado',
  emitido: 'Emitido',
  anulado: 'Anulado',
  enviado_sunat: 'Enviado a SUNAT',
  abierta: 'Abierta',
  cerrada: 'Cerrada',
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
  // Estados de orden de compra (enum PurchaseOrderStatus)
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  PARTIALLY_RECEIVED: 'Parcial',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
  // Estados de transferencia entre almacenes (enum TransferStatus)
  PENDING: 'Pendiente',
  IN_TRANSIT: 'En tránsito',
  // Estados de conteo físico (enum InventoryCountStatus). FINISHED cierra la toma
  // sin mover stock; APPLIED es el único que ya movió existencias.
  IN_PROGRESS: 'En proceso',
  FINISHED: 'Finalizado',
  APPLIED: 'Aplicado',
  // Estados del comprobante de compra (enum PurchaseStatus). No comparte valores con
  // PurchaseOrderStatus: un comprobante nace REGISTERED, no DRAFT.
  REGISTERED: 'Registrado',
  PROCESSED: 'Procesado',
  // Estados de cotización (enum QuotationStatus). DRAFT/SENT comparten clave y traducción
  // con PurchaseOrderStatus arriba; los otros 4 son exclusivos de este enum.
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
  CONVERTED: 'Convertida',
}

export function StatusBadge({ status, label, className = '', variant }: StatusBadgeProps) {
  const variantKey = variant || statusColorMap[status] || 'default'
  const colorClass = variantClasses[variantKey]
  const displayLabel = label || statusLabels[status] || status

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] font-medium border leading-tight ${colorClass} ${className}`}>
      {displayLabel}
    </span>
  )
}
