import { Power } from 'lucide-react'
import { useApp } from '@/store/context'
import { bySite, byZone } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CameraFrame } from '@/components/CameraFrame'
import { SNAPSHOTS } from '@/data'
import { ago } from '@/lib/utils'

/** Список камер по объектам: где стоит, работает ли, когда был последний снимок */
export function AdminCameras() {
  const { cameras, toggleCamera, visibleSites, notify } = useApp()
  return (
    <div>
      <PageHeader title="Камеры" subtitle="Какая камера за какой зоной следит. Снимок — раз в час." />
      <div className="space-y-6">
        {visibleSites.map((s) => (
          <section key={s.id}>
            <h2 className="text-xl font-bold mb-3">{bySite(s.id).name}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cameras.filter((c) => c.siteId === s.id).map((c) => {
                const last = SNAPSHOTS.filter((x) => x.cameraId === c.id).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0]
                return (
                  <div key={c.id} className="bg-card rounded-xl border border-border overflow-hidden">
                    <CameraFrame camera={c} snapshot={last} offline={!c.online} showLabels={false} className="rounded-none" />
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold">{c.name}</div>
                        <Badge tone={c.online ? 'ok' : 'neutral'}>{c.online ? 'Работает' : 'Выключена'}</Badge>
                      </div>
                      <div className="text-muted-foreground text-[14px]">Зона: {byZone(c.zoneId).name}</div>
                      <div className="text-muted-foreground text-[14px]">Последний снимок: {ago(c.lastSnapshotAt)}</div>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => { toggleCamera(c.id); notify(`${c.name}: ${c.online ? 'выключена' : 'включена'}`) }}>
                        <Power className="w-4 h-4" /> {c.online ? 'Выключить' : 'Включить'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-8 bg-info-bg/60 border border-info/30 rounded-xl p-4 text-[15px]">
        <b>Как ставить камеры, чтобы система работала хорошо:</b> камера должна смотреть на зону работ сверху под углом 30–45°, охватывать въезд и основную рабочую зону,
        не быть направленной против солнца, и снимать не реже раза в час. Один объект — минимум две камеры: въезд и рабочая зона.
      </div>
    </div>
  )
}
