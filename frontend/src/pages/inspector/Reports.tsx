import { EQUIPMENT, SITES, type EquipmentType } from '@/data'
import { useApp } from '@/store/context'
import { isOpen } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/StatTile'
import { KIND } from '@/lib/labels'
import { VehicleIcon } from '@/components/VehicleIcon'
import { motion } from 'framer-motion'

/** Простая сводка за неделю: по объектам, по типам нарушений, по технике. Без сложных графиков. */
export function InspectorReports() {
  const { alerts } = useApp()
  const total = alerts.length
  const open = alerts.filter((a) => isOpen(a.status)).length
  const resolved = alerts.filter((a) => a.status === 'resolved').length
  const fp = alerts.filter((a) => a.status === 'false_positive').length

  const bySiteRows = SITES.map((s) => ({ name: s.name, n: alerts.filter((a) => a.siteId === s.id).length, high: alerts.filter((a) => a.siteId === s.id && a.severity === 'high').length }))
  const byKind = Object.entries(KIND).map(([k, label]) => ({ label, n: alerts.filter((a) => a.kind === k).length })).filter((r) => r.n > 0)
  const byEq = (Object.keys(EQUIPMENT) as EquipmentType[]).map((t) => ({ t, n: alerts.filter((a) => a.equipment === t).length })).filter((r) => r.n > 0)
  const max = Math.max(...bySiteRows.map((r) => r.n), 1)

  // Демо-динамика за 7 дней
  const days = [['Ср 9', 2], ['Чт 10', 1], ['Пт 11', 3], ['Сб 12', 2], ['Вс 13', 0], ['Пн 14', 1], ['Вт 15', 5]] as const
  const dmax = Math.max(...days.map((d) => d[1]))

  return (
    <div>
      <PageHeader title="Отчёт за неделю" subtitle="9–15 сентября 2026 · по всем объектам" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile label="Всего нарушений" value={total} hint="за неделю" />
        <StatTile label="Открытых сейчас" value={open} hint="требуют реакции" tone="danger" />
        <StatTile label="Устранено" value={resolved} hint="закрыто подрядчиком" tone="ok" />
        <StatTile label="Ошибок системы" value={fp} hint="ложных срабатываний" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardBody>
          <h2 className="font-bold text-lg mb-3">Нарушения по дням</h2>
          <div className="flex items-end gap-2 h-40" role="img" aria-label="Столбики: количество нарушений по дням недели">
            {days.map(([d, n], i) => (
              <div key={d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <span className="text-[14px] font-bold">{n}</span>
                <motion.div
                  className="w-full rounded-t-md bg-primary" initial={{ height: 0 }} animate={{ height: `${(n / dmax) * 100}%` }} transition={{ delay: i * 0.05, duration: 0.5 }}
                  style={{ minHeight: n ? 6 : 2, opacity: n ? 1 : 0.3 }}
                />
                <span className="text-[13px] text-muted-foreground">{d}</span>
              </div>
            ))}
          </div>
        </CardBody></Card>

        <Card><CardBody>
          <h2 className="font-bold text-lg mb-3">По объектам</h2>
          <ul className="space-y-3">
            {bySiteRows.map((r) => (
              <li key={r.name}>
                <div className="flex justify-between text-[15px] mb-1"><span className="font-semibold truncate pr-3">{r.name}</span><span className="shrink-0">{r.n} <span className="text-muted-foreground">(срочных {r.high})</span></span></div>
                <div className="h-3 rounded-full bg-muted overflow-hidden"><motion.div className="h-full bg-primary rounded-full" initial={{ width: 0 }} animate={{ width: `${(r.n / max) * 100}%` }} transition={{ duration: 0.5 }} /></div>
              </li>
            ))}
          </ul>
        </CardBody></Card>

        <Card><CardBody>
          <h2 className="font-bold text-lg mb-3">По типам нарушений</h2>
          <ul className="divide-y divide-border">
            {byKind.map((r) => <li key={r.label} className="flex justify-between py-2"><span>{r.label}</span><b>{r.n}</b></li>)}
          </ul>
        </CardBody></Card>

        <Card><CardBody>
          <h2 className="font-bold text-lg mb-3">Какой техники чаще не хватает или она лишняя</h2>
          <ul className="divide-y divide-border">
            {byEq.sort((a, b) => b.n - a.n).map((r) => (
              <li key={r.t} className="flex items-center gap-3 py-2">
                <VehicleIcon type={r.t} className="w-12 h-8" fill={EQUIPMENT[r.t].color} />
                <span className="flex-1">{EQUIPMENT[r.t].name}</span><b>{r.n}</b>
              </li>
            ))}
          </ul>
        </CardBody></Card>
      </div>
    </div>
  )
}

