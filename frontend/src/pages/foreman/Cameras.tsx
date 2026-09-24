import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { VideoWall } from '@/components/video/VideoWall'

export function ForemanCameras() {
  const { ownSiteId, cameras } = useApp()
  if (!ownSiteId) return <p className="text-muted-foreground">За вами не закреплён ни один объект. Обратитесь к администратору.</p>
  return (
    <div>
      <PageHeader title="Камеры на объекте" subtitle="Видео в реальном времени. Система смотрит на него и ищет технику каждые 2 секунды" />
      <VideoWall cameras={cameras.filter((c) => c.siteId === ownSiteId)} empty="На объекте пока нет камер." />
    </div>
  )
}
