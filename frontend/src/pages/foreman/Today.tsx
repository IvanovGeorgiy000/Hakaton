import { useApp } from '@/store/context'
import { SiteToday } from '@/components/SiteToday'

export function ForemanToday() {
  const { role } = useApp()
  return <SiteToday siteId={role!.siteId!} camerasLink="/foreman/cameras" />
}
