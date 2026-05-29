import clsx from 'clsx'

const variants = {
  primary:   'bg-[#2B3A8F] text-white hover:bg-[#1E2D7A] border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300',
  danger:    'bg-white text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300',
  ghost:     'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
}

export default function Button({
  children, variant = 'primary', size = 'md',
  icon: Icon, disabled, onClick, type = 'button', className,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B3A8F]/30 disabled:opacity-50 disabled:cursor-not-allowed select-none',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 14} className="flex-shrink-0" />}
      {children}
    </button>
  )
}
