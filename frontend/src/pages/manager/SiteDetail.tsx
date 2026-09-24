import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { CAMERA_ADDERS } from '@/data'
import { useApp } from '@/store/context'
import { SiteToday } from '@/components/SiteToday'
import { StageTimeline } from '@/components/StageTimeline'
import { VideoWall } from '@/components/video/VideoWall'
import { Button } from '@/components/ui/Button'
import { AddCameraDialog, CameraAdminActions } from '@/components/CameraDialogs'
import { DeleteSiteDialog, PlanDialog, SiteDialog, ZonesDialog } from '@/components/SiteDialogs'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'cameras', label: 'Камеры' },
  { id: 'plan', label: 'План работ' },
] as const

type Dialog = 'edit' | 'zones' | 'plan' | 'delete' | 'camera' | null

/** Объект глазами руководителя и администратора: вкладки «Сегодня», «Камеры», «План работ» — и управление объектом здесь же */
export function ManagerSite() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('today')
  const [dialog, setDialog] = useState<Dialog>(null)
  const { bySite, cameras, base, role } = useApp()
  const site = id ? bySite(id) : undefined
  if (!site) return <Navigate to={base} replace />
  const isAdmin = role?.id === 'admin'
  const canAddCamera = !!role && CAMERA_ADDERS.includes(role.id)
  const close = () => setDialog(null)

  return (
    <div>
      <Link to={base} className="inline-flex items-center gap-1.5 min-h-[44px] text-primary font-semibold hover:underline mb-1"><ArrowLeft className="w-5 h-5" /> Все объекты</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <h1 className="text-[22px] sm:text-2xl font-semibold leading-tight min-w-0">{site.name}</h1>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog('edit')}><Pencil className="w-4 h-4" /> Изменить</Button>
            <Button variant="outline" onClick={() => setDialog('zones')}><Layers className="w-4 h-4" /> Зоны</Button>
            <Button variant="ghost" aria-label={`Удалить объект ${site.name}`} title="Удалить объект" onClick={() => setDialog('delete')}><Trash2 className="w-4 h-4" /></Button>
          </div>
        )}
      </div>
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

      {tab === 'today' && <SiteToday siteId={site.id} showName={false} onShowCameras={() => setTab('cameras')} />}
      {tab === 'cameras' && (
        <>
          {canAddCamera && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => setDialog('camera')}><Plus className="w-5 h-5" /> Камера на этот объект</Button>
            </div>
          )}
          <VideoWall
            cameras={cameras.filter((c) => c.siteId === site.id)} empty="На объекте пока нет камер."
            actions={isAdmin ? (c) => <CameraAdminActions camera={c} /> : undefined}
          />
        </>
      )}
      {tab === 'plan' && (
        <>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => setDialog('plan')}><CalendarDays className="w-5 h-5" /> Изменить план</Button>
            </div>
          )}
          <StageTimeline siteId={site.id} />
        </>
      )}

      {canAddCamera && <AddCameraDialog open={dialog === 'camera'} defaultSiteId={site.id} onClose={close} />}
      {isAdmin && (
        <>
          <SiteDialog site={dialog === 'edit' ? site : null} onClose={close} />
          <ZonesDialog site={dialog === 'zones' ? site : null} onClose={close} />
          <PlanDialog site={dialog === 'plan' ? site : null} onClose={close} />
          <DeleteSiteDialog site={dialog === 'delete' ? site : null} onClose={close} onDeleted={() => navigate(base, { replace: true })} />
        </>
      )}
    </div>
  )
}
