import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { CamerasGrid } from '@/components/CamerasGrid'

export function ForemanCameras() {
  const { ownSiteId } = useApp()
  if (!ownSiteId) return <p className="text-muted-foreground">За вами не закреплён ни один объект. Обратитесь к администратору.</p>
  return (
    <div>
      <PageHeader title="Камеры на объекте" subtitle="Нажмите на камеру, чтобы посмотреть снимки за день" />
      <CamerasGrid siteId={ownSiteId} />
    </div>
  )
}
