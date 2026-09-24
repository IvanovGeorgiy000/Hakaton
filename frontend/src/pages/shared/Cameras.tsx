import { useState } from 'react'
import { Plus } from 'lucide-react'
import { CAMERA_ADDERS } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { VideoWall } from '@/components/video/VideoWall'
import { AddCameraDialog } from '@/components/CameraDialogs'

/** Камеры всех объектов: видеостена с разбивкой по объектам. Руководитель и администратор отсюда же подключают новые камеры. */
export function CamerasPage() {
  const { cameras, sites, role } = useApp()
  const [site, setSite] = useState('all')
  const [adding, setAdding] = useState<string | true | null>(null)  // true — объект выбирается в форме
  const canAdd = !!role && CAMERA_ADDERS.includes(role.id)
  const shown = site === 'all' ? sites : sites.filter((s) => s.id === site)
  const sections = shown.map((s) => ({
    id: s.id, title: s.name, cameras: cameras.filter((c) => c.siteId === s.id),
    extra: canAdd && <Button variant="ghost" size="sm" onClick={() => setAdding(s.id)}><Plus className="w-4 h-4" /> Камера на этот объект</Button>,
  }))

  return (
    <div>
      <PageHeader
        title="Камеры" subtitle="Видео со всех объектов в реальном времени"
        action={canAdd && <Button size="lg" onClick={() => setAdding(site === 'all' ? true : site)}><Plus className="w-5 h-5" /> Добавить камеру</Button>}
      />
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Объект">
          <Chip active={site === 'all'} onClick={() => setSite('all')} small>Все объекты</Chip>
          {sites.map((s) => <Chip key={s.id} active={site === s.id} onClick={() => setSite(s.id)} small>{s.name}</Chip>)}
        </div>
      )}
      <VideoWall cameras={sections.flatMap((s) => s.cameras)} sections={sections} />
      {canAdd && <AddCameraDialog open={adding !== null} defaultSiteId={typeof adding === 'string' ? adding : undefined} onClose={() => setAdding(null)} />}
    </div>
  )
}
