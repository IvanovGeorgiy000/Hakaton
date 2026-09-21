import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { StageTimeline } from '@/components/StageTimeline'

export function ForemanPlan() {
  const { role } = useApp()
  return (
    <div>
      <PageHeader title="План работ" subtitle="Какие этапы идут сейчас и какая техника для них нужна" />
      <StageTimeline siteId={role!.siteId!} />
    </div>
  )
}
