import { useState } from 'react'
import { Plus } from 'lucide-react'
import { CAMERA_ADDERS } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { VideoWall } from '@/components/video/VideoWall'
import { AddCameraDialog, CameraAdminActions } from '@/components/CameraDialogs'

/**
 * Камеры всех объектов: видеостена с разбивкой по объектам. Здесь же ими и управляют: руководитель и администратор
 * подключают новые камеры, администратор меняет, выключает, проверяет и удаляет — у самой камеры.
 */
export function CamerasPage() {
  const { cameras, sites, role } = useApp()
  const [site, setSite] = useState('all')
  const [adding, setAdding] = useState<string | true | null>(null)  // true — объект выбирается в форме
  const canAdd = !!role && CAMERA_ADDERS.includes(role.id)
  const isAdmin = role?.id === 'admin'
  const shown = site === 'all' ? sites : sites.filter((s) => s.id === site)
  const sections = shown.map((s) => ({
    id: s.id, title: s.name, cameras: cameras.filter((c) => c.siteId === s.id),
    extra: canAdd && <Button variant="ghost" onClick={() => setAdding(s.id)}><Plus className="w-4 h-4" /> Камера на этот объект</Button>,
  }))

  return (
    <div>
      <PageHeader
        title="Камеры" subtitle="Видео со всех объектов в реальном времени. Нажмите на видео — развернётся на всю вкладку"
        action={canAdd && <Button size="lg" onClick={() => setAdding(site === 'all' ? true : site)}><Plus className="w-5 h-5" /> Добавить камеру</Button>}
      />
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Объект">
          <Chip active={site === 'all'} onClick={() => setSite('all')} small>Все объекты</Chip>
          {sites.map((s) => <Chip key={s.id} active={site === s.id} onClick={() => setSite(s.id)} small>{s.name}</Chip>)}
        </div>
      )}
      <VideoWall
        cameras={sections.flatMap((s) => s.cameras)} sections={sections}
        actions={isAdmin ? (c) => <CameraAdminActions camera={c} /> : undefined}
      />
      {canAdd && (
        <>
          <div className="mt-8 bg-card border border-border rounded-xl p-5 text-[15px] leading-relaxed">
            <b>Как ставить камеры, чтобы система работала хорошо.</b> Камера смотрит на зону работ сверху под углом 30–45°,
            охватывает рабочую зону целиком и не направлена против солнца. На объект — минимум две камеры: рабочая зона и въезд.
            Кадр из видео уходит на анализ каждые 2 секунды, поэтому связь нужна постоянная.
          </div>
          <AddCameraDialog open={adding !== null} defaultSiteId={typeof adding === 'string' ? adding : undefined} onClose={() => setAdding(null)} />
        </>
      )}
    </div>
  )
}
