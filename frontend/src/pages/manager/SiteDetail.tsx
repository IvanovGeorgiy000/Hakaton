import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SITES } from '@/data'
import { SiteToday } from '@/components/SiteToday'
import { CamerasGrid } from '@/components/CamerasGrid'
import { StageTimeline } from '@/components/StageTimeline'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'cameras', label: 'Камеры' },
  { id: 'plan', label: 'План работ' },
] as const

/** Объект глазами руководителя: те же экраны, что у прораба, плюс вкладки */
export function ManagerSite() {
  const { id } = useParams()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('today')
  const site = SITES.find((s) => s.id === id)
  if (!site) return <Navigate to="/manager" replace />
  return (
    <div>
      <Link to="/manager" className="inline-flex items-center gap-1.5 min-h-[44px] text-primary font-semibold hover:underline mb-2"><ArrowLeft className="w-5 h-5" /> Все объекты</Link>
      <div role="tablist" className="flex gap-2 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
            className={cn('min-h-[48px] px-5 rounded-lg font-semibold border cursor-pointer transition-colors whitespace-nowrap', tab === t.id ? 'bg-primary text-on-primary border-primary' : 'bg-card border-border hover:border-primary/60')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'today' && <SiteToday siteId={site.id} camerasLink="#" />}
      {tab === 'cameras' && <CamerasGrid siteId={site.id} />}
      {tab === 'plan' && <StageTimeline siteId={site.id} />}
    </div>
  )
}
