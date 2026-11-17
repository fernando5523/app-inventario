
interface AvatarProps {
  name: string
  color?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function Avatar({ name, color = 'var(--primary)', size = 'md' }: AvatarProps) {
  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold text-white border border-[var(--btn-border)]`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {initials}
    </div>
  )
}
