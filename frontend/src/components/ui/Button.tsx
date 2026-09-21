import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
type Size = 'md' | 'lg' | 'sm'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-sm',
  secondary: 'bg-muted text-foreground hover:bg-border/70',
  outline: 'bg-card border-2 border-border text-foreground hover:border-primary hover:text-primary',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
  danger: 'bg-danger text-white hover:bg-red-800',
  success: 'bg-ok text-white hover:bg-green-800',
}
const sizes: Record<Size, string> = {
  sm: 'min-h-[40px] px-3 text-[15px] gap-1.5',
  md: 'min-h-[48px] px-4 text-[16px] gap-2',
  lg: 'min-h-[56px] px-6 text-[18px] gap-2.5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  full?: boolean
}

/** Крупная кнопка: минимум 44px высоты, заметный hover и фокус */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', full, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold cursor-pointer select-none',
        'transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant], sizes[size], full && 'w-full', className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
