import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, MapPin, Plus } from 'lucide-react'
import { SITE_MANAGERS } from '@/data'
import { useApp } from '@/store/context'
import { isOpen } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { StatTile } from '@/components/ui/StatTile'
import { Button } from '@/components/ui/Button'
import { SiteDialog } from '@/components/SiteDialogs'
import { fmtWhen, plural, pluralWord, todayLabel } from '@/lib/utils'
import { cn } from '@/lib/utils'

/** Все объекты одним взглядом: светофор, этап, отставание, открытые замечания. Руководитель и администратор здесь же добавляют объекты. */
export function ManagerOverview() {
  const { sites: visibleSites, siteStatus, alertsForSite, byStage, lastDataAt, base, role } = useApp()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const isAdmin = role?.id === 'admin'
  const canAddSite = !!role && SITE_MANAGERS.includes(role.id)
  const counts = { ok: 0, warning: 0, critical: 0 }
  visibleSites.forEach((s) => { counts[siteStatus(s.id)]++ })
  const totalOpen = visibleSites.reduce((n, s) => n + alertsForSite(s.id).filter((a) => isOpen(a.status)).length, 0)

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Все объекты' : 'Мои объекты'} subtitle={`${todayLabel()}${lastDataAt ? ` · данные на ${fmtWhen(lastDataAt)}` : ''}`}
        action={canAddSite && <Button size="lg" onClick={() => setCreating(true)}><Plus className="w-5 h-5" /> Добавить объект</Button>}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile label="Нужно вмешаться" value={counts.critical} hint={pluralWord(counts.critical, 'объект', 'объекта', 'объектов')} tone="danger" />
        <StatTile label="Есть замечания" value={counts.warning} hint={pluralWord(counts.warning, 'объект', 'объекта', 'объектов')} tone="warn" />
        <StatTile label="Всё по плану" value={counts.ok} hint={pluralWord(counts.ok, 'объект', 'объекта', 'объектов')} tone="ok" />
        <StatTile label="Открытых замечаний" value={totalOpen} hint="по всем объектам" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {[...visibleSites].sort((a, b) => rank(siteStatus(b.id)) - rank(siteStatus(a.id))).map((s) => {
          const status = siteStatus(s.id)
          const open = alertsForSite(s.id).filter((a) => isOpen(a.status))
          const lag = s.planProgress - s.factProgress
          const stage = byStage(s.currentStageId)
          return (
            <div key={s.id}>
              <Link
                to={`${base}/site/${s.id}`}
                className={cn(
                  'block bg-card rounded-xl border p-5 shadow-[var(--shadow-card)] hover:shadow-md transition-all',
                  'border-border hover:border-primary/60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold leading-tight">{s.name}</div>
                    <div className="text-muted-foreground text-[14px] inline-flex items-center gap-1 mt-1"><MapPin className="w-4 h-4" />{s.address}</div>
                  </div>
                  <ChevronRight className="w-7 h-7 text-muted-foreground shrink-0" />
                </div>
                <div className="mt-3"><StatusPill status={status} /></div>
                <dl className="grid grid-cols-3 gap-2 mt-4 text-[14px]">
                  <div><dt className="text-muted-foreground">Этап</dt><dd className="font-semibold leading-tight">{stage?.name ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Выполнено</dt><dd className={cn('font-semibold', lag > 5 && 'text-danger')}>{s.factProgress}% <span className="text-muted-foreground font-normal">/ план {s.planProgress}%</span></dd></div>
                  <div><dt className="text-muted-foreground">Замечания</dt><dd className="font-semibold">{open.length ? plural(open.length, 'открытое', 'открытых', 'открытых') : 'нет'}</dd></div>
                </dl>
                {open[0] && (
                  <div className={cn('mt-3 rounded-lg px-3 py-2 text-[15px] font-semibold', open.some((a) => a.severity === 'high') ? 'bg-danger-bg text-danger-fg' : 'bg-warn-bg text-warn-fg')}>
                    {open.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1))[0].title}
                    {open.length > 1 && <span className="font-normal opacity-80"> и ещё {open.length - 1}</span>}
                  </div>
                )}
              </Link>
            </div>
          )
        })}
      </div>
      {canAddSite && <SiteDialog site={creating ? 'new' : null} onClose={() => setCreating(false)} onCreated={(site) => navigate(`${base}/site/${site.id}`)} />}
    </div>
  )
}

function rank(s: 'ok' | 'warning' | 'critical') { return { critical: 2, warning: 1, ok: 0 }[s] }
