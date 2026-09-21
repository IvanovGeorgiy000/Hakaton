import { useMemo, useState } from 'react'
import { type Alert, type Severity } from '@/data'
import { useApp } from '@/store/context'
import { isOpen, bySeverity } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { AlertCard } from '@/components/AlertCard'
import { AlertDetail } from '@/components/AlertDetail'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

type Filter = 'open' | 'high' | 'closed' | 'all'

/** Лента отклонений по всем объектам с простыми фильтрами-кнопками */
export function ManagerAlerts() {
  const { alerts, visibleSites } = useApp()
  const [filter, setFilter] = useState<Filter>('open')
  const [site, setSite] = useState<string>('all')
  const [sel, setSel] = useState<Alert | null>(null)

  const list = useMemo(() => alerts
    .filter((a) => site === 'all' || a.siteId === site)
    .filter((a) => filter === 'all' ? true : filter === 'open' ? isOpen(a.status) : filter === 'closed' ? !isOpen(a.status) : a.severity === ('high' as Severity) && isOpen(a.status))
    .sort(bySeverity), [alerts, filter, site])

  const count = (f: Filter) => alerts.filter((a) => site === 'all' || a.siteId === site).filter((a) => f === 'all' ? true : f === 'open' ? isOpen(a.status) : f === 'closed' ? !isOpen(a.status) : a.severity === 'high' && isOpen(a.status)).length

  return (
    <div>
      <PageHeader title="Отклонения" subtitle="Все замечания системы по вашим объектам" />
      <div className="flex flex-wrap gap-2 mb-3">
        {([['open', 'Открытые'], ['high', 'Срочные'], ['closed', 'Закрытые'], ['all', 'Все']] as [Filter, string][]).map(([f, l]) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{l} <span className="opacity-70">{count(f)}</span></Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        <Chip active={site === 'all'} onClick={() => setSite('all')} small>Все объекты</Chip>
        {visibleSites.map((s) => <Chip key={s.id} active={site === s.id} onClick={() => setSite(s.id)} small>{s.name}</Chip>)}
      </div>
      {list.length === 0 ? (
        <div className="bg-card rounded-xl border border-border"><EmptyState title="Ничего нет" text="По выбранным условиям отклонений не найдено." /></div>
      ) : (
        <div className="space-y-3">{list.map((a) => <AlertCard key={a.id} alert={a} onOpen={setSel} showSite />)}</div>
      )}
      <AlertDetail alert={sel} onClose={() => setSel(null)} />
    </div>
  )
}

export function Chip({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        'rounded-full font-semibold border-2 cursor-pointer transition-colors',
        small ? 'min-h-[40px] px-3 text-[14px]' : 'min-h-[44px] px-4',
        active ? 'bg-primary text-on-primary border-primary' : 'bg-card border-border hover:border-primary/60',
      )}
    >
      {children}
    </button>
  )
}
