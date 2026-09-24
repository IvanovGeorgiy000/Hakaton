import { useState } from 'react'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Chip } from '@/components/ui/Chip'
import { VideoWall } from '@/components/video/VideoWall'

/** Камеры всех объектов: видеостена с разбивкой по объектам (руководитель, инспектор, администратор) */
export function CamerasPage() {
  const { cameras, sites } = useApp()
  const [site, setSite] = useState('all')
  const shown = site === 'all' ? sites : sites.filter((s) => s.id === site)
  const sections = shown.map((s) => ({ id: s.id, title: s.name, cameras: cameras.filter((c) => c.siteId === s.id) }))

  return (
    <div>
      <PageHeader title="Камеры" subtitle="Видео со всех объектов в реальном времени" />
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="Объект">
          <Chip active={site === 'all'} onClick={() => setSite('all')} small>Все объекты</Chip>
          {sites.map((s) => <Chip key={s.id} active={site === s.id} onClick={() => setSite(s.id)} small>{s.name}</Chip>)}
        </div>
      )}
      <VideoWall cameras={sections.flatMap((s) => s.cameras)} sections={sections} />
    </div>
  )
}
