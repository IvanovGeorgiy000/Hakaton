import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { CamerasGrid } from '@/components/CamerasGrid'

export function ForemanCameras() {
  const { role } = useApp()
  return (
    <div>
      <PageHeader title="Камеры на объекте" subtitle="Нажмите на камеру, чтобы посмотреть снимки за день" />
      <CamerasGrid siteId={role!.siteId!} />
    </div>
  )
}
