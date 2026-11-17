
interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
}

export function LoadingSpinner({ size = 'md', text, className = '' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className={`${sizeClasses[size]} border-3 border-[var(--bg-subtle)] border-t-[var(--primary)] rounded-full animate-spin`} />
      {text && <p className="text-sm text-[var(--fg-muted)]">{text}</p>}
    </div>
  )
}
