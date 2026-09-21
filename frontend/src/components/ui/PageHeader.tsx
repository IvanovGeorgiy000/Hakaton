import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-[16px]">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
