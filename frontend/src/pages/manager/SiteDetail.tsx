import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '@/store/context'
import { SiteToday } from '@/components/SiteToday'
import { StageTimeline } from '@/components/StageTimeline'
import { VideoWall } from '@/components/video/VideoWall'
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
  const { bySite, cameras, base } = useApp()
  const site = id ? bySite(id) : undefined
  if (!site) return <Navigate to={base} replace />
  return (
    <div>
      <Link to={base} className="inline-flex items-center gap-1.5 min-h-[44px] text-primary font-semibold hover:underline mb-2"><ArrowLeft className="w-5 h-5" /> Все объекты</Link>
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
      {tab === 'today' && <SiteToday siteId={site.id} onShowCameras={() => setTab('cameras')} />}
      {tab === 'cameras' && <VideoWall cameras={cameras.filter((c) => c.siteId === site.id)} empty="На объекте пока нет камер." />}
      {tab === 'plan' && <StageTimeline siteId={site.id} />}
    </div>
  )
}
