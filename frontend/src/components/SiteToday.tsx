import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, HardHat, Building } from 'lucide-react'
import type { Alert } from '@/data'
import { useApp } from '@/store/context'
import { bySite, byStage, isOpen, bySeverity } from '@/store/selectors'
import { fmtDate, plural } from '@/lib/utils'
import { StatusPill } from './ui/StatusPill'
import { StatTile } from './ui/StatTile'
import { EmptyState } from './ui/EmptyState'
import { AlertCard } from './AlertCard'
import { AlertDetail } from './AlertDetail'
import { EquipmentCheck } from './EquipmentCheck'

/** Главный экран объекта: светофор, этап, что не так, техника по плану и по факту */
export function SiteToday({ siteId, camerasLink }: { siteId: string; camerasLink: string }) {
  const { siteStatus, alertsForSite } = useApp()
  const [sel, setSel] = useState<Alert | null>(null)
  const site = bySite(siteId)
  const stage = byStage(site.currentStageId)
  const status = siteStatus(siteId)
  const open = alertsForSite(siteId).filter((a) => isOpen(a.status)).sort(bySeverity)
  const closed = alertsForSite(siteId).filter((a) => !isOpen(a.status))
  const lag = site.planProgress - site.factProgress

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-2xl font-semibold leading-tight">{site.name}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-muted-foreground text-[15px]">
              <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{site.address}</span>
              <span className="inline-flex items-center gap-1.5"><Building className="w-4 h-4" />{site.contractor}</span>
              <span className="inline-flex items-center gap-1.5"><HardHat className="w-4 h-4" />Прораб: {site.foreman}</span>
            </div>
          </div>
          <StatusPill status={status} big />
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-5">{/* показатели */}
          <StatTile label="Этап сейчас" value={<span className="text-xl">{stage.name}</span>} hint={`по графику до ${fmtDate(stage.end)}`} />
          <StatTile label="Выполнено работ" value={`${site.factProgress}%`} hint={lag > 0 ? `отставание ${lag}% от плана (${site.planProgress}%)` : `с опережением плана (${site.planProgress}%)`} tone={lag > 5 ? 'danger' : lag > 0 ? 'warn' : 'ok'} />
          <StatTile label="Открытых замечаний" value={open.length} hint={!open.length ? 'всё спокойно' : open.some((a) => a.severity === 'high') ? `из них ${plural(open.filter((a) => a.severity === 'high').length, 'срочное', 'срочных', 'срочных')}` : 'срочных нет'} tone={open.some((a) => a.severity === 'high') ? 'danger' : open.length ? 'warn' : 'ok'} />
        </div>
      </div>

      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-[18px] font-semibold">Что не так прямо сейчас</h2>
          <Link to={camerasLink} className="text-primary font-semibold hover:underline min-h-[44px] inline-flex items-center">Смотреть камеры</Link>
        </div>
        {open.length === 0 ? (
          <div className="bg-card rounded-xl border border-border"><EmptyState title="Всё по плану" text="Система не нашла отклонений. Отдыхайте спокойно." /></div>
        ) : (
          <div className="space-y-3">
            {open.map((a) => (
              <div key={a.id}>
                <AlertCard alert={a} onOpen={setSel} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[18px] font-semibold mb-2">План и факт по технике</h2>
        <EquipmentCheck siteId={siteId} />
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="text-[18px] font-semibold mb-2">Уже решено</h2>
          <div className="space-y-3">
            {closed.map((a) => <AlertCard key={a.id} alert={a} onOpen={setSel} compact />)}
          </div>
        </section>
      )}

      <AlertDetail alert={sel} onClose={() => setSel(null)} />
    </div>
  )
}
