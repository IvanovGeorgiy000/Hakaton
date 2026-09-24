import { useMemo, useState } from 'react'
import { Download, FileWarning } from 'lucide-react'
import type { Alert } from '@/data'
import { useApp } from '@/store/context'
import { isOpen } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { AlertDetail } from '@/components/AlertDetail'
import { Chip } from '@/components/ui/Chip'
import { fmtDateShort, fmtTime, todayISO } from '@/lib/utils'
import { KIND, SEVERITY, STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'

type Filter = 'open' | 'prescribed' | 'closed' | 'all'

/** Журнал нарушений: таблица с фильтрами, экспорт, выдача предписаний */
export function InspectorViolations() {
  const { alerts, notify, sites, bySite, byZone } = useApp()
  const [filter, setFilter] = useState<Filter>('open')
  const [site, setSite] = useState('all')
  const [sel, setSel] = useState<Alert | null>(null)

  const list = useMemo(() => alerts
    .filter((a) => a.kind !== 'camera_offline')
    .filter((a) => site === 'all' || a.siteId === site)
    .filter((a) => filter === 'all' ? true : filter === 'open' ? isOpen(a.status) && a.status !== 'prescribed' : filter === 'prescribed' ? a.status === 'prescribed' : !isOpen(a.status))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [alerts, filter, site])

  const exportCsv = () => {
    const rows = [['№', 'Дата', 'Объект', 'Зона', 'Тип', 'Нарушение', 'Важность', 'Статус'],
      ...list.map((a) => [a.code, fmtDateShort(a.startedAt), bySite(a.siteId)?.name ?? '', byZone(a.zoneId)?.name ?? '', KIND[a.kind], a.title, SEVERITY[a.severity].label, STATUS[a.status].label])]
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'нарушения.csv'; a.click(); URL.revokeObjectURL(url)
    notify('Файл «нарушения.csv» сохранён')
  }

  return (
    <div>
      <PageHeader
        title="Журнал нарушений"
        info="Отклонения от графика, которые система нашла по видео с камер. Откройте нарушение, чтобы посмотреть кадры-доказательства, выдать предписание или закрыть его."
        action={<Button variant="outline" onClick={exportCsv}><Download className="w-5 h-5" /> Выгрузить в Excel</Button>}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        {([['open', 'Новые и в работе'], ['prescribed', 'С предписанием'], ['closed', 'Закрытые'], ['all', 'Все']] as [Filter, string][]).map(([f, l]) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{l}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        <Chip active={site === 'all'} onClick={() => setSite('all')} small>Все объекты</Chip>
        {sites.map((s) => <Chip key={s.id} active={site === s.id} onClick={() => setSite(s.id)} small>{s.name}</Chip>)}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-[15px] min-w-[860px]">
          <thead className="bg-muted/60 text-left text-[13px] text-muted-foreground">
            <tr>
              <th className="px-4 py-3">№</th>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Объект</th>
              <th className="px-4 py-3">Нарушение</th>
              <th className="px-4 py-3">Важность</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Ничего не найдено</td></tr>}
            {list.map((a) => (
              <tr key={a.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setSel(a)}>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-[13px] text-muted-foreground">{a.code}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular">{fmtDateShort(a.startedAt)}<div className="text-muted-foreground text-[13px]">{fmtTime(a.startedAt)}</div></td>
                <td className="px-4 py-3"><div className="font-semibold">{bySite(a.siteId)?.name}</div><div className="text-muted-foreground text-[13px]">{byZone(a.zoneId)?.name}</div></td>
                <td className="px-4 py-3"><div className="font-semibold">{a.title}</div><div className="text-muted-foreground text-[13px]">{KIND[a.kind]}</div></td>
                <td className="px-4 py-3"><Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge></td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                  {a.status === 'prescribed' && a.prescriptionDue && (
                    <div className={cn('text-[13px] mt-1 whitespace-nowrap', a.prescriptionDue < todayISO() ? 'text-danger font-semibold' : 'text-muted-foreground')}>
                      {a.prescriptionDue < todayISO() ? 'просрочено, ' : ''}до {fmtDateShort(a.prescriptionDue)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {/* настоящая кнопка: строку таблицы с клавиатуры не открыть */}
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSel(a) }} aria-label={`Открыть нарушение № ${a.code}`}
                    className={cn('inline-flex items-center gap-1 min-h-[44px] px-2 rounded-md font-semibold text-primary hover:underline cursor-pointer whitespace-nowrap')}>
                    {a.status === 'prescribed' ? <><FileWarning className="w-4 h-4" /> № {a.prescriptionNo}</> : 'Открыть'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AlertDetail alert={sel} onClose={() => setSel(null)} />
    </div>
  )
}
