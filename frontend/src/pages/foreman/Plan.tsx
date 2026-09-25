import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { StageTimeline } from '@/components/StageTimeline'

export function ForemanPlan() {
  const { ownSiteId } = useApp()
  if (!ownSiteId) return <p className="text-muted-foreground">За вами не закреплён ни один объект. Обратитесь к администратору.</p>
  return (
    <div>
      <PageHeader title="План работ" info="Что сделано, что идёт сейчас и что впереди. Сколько сделано по факту, отмечает руководитель проекта." />
      <StageTimeline siteId={ownSiteId} />
    </div>
  )
}
