import { CheckCircle2, Info } from 'lucide-react'
import { mediaUrl } from '@/api'
import { EQUIPMENT, type AnalyzeResult, type Detection } from '@/data'
import { VehicleIcon } from './VehicleIcon'
import { cn } from '@/lib/utils'

/** Кадр с рамками найденной техники (кадр 16:9 приходит с сервера — рамки считаются по нему) */
export function AnalyzedFrame({ src, detections, busy }: { src: string; detections: Detection[]; busy?: boolean }) {
  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900">
      <img src={mediaUrl(src)} alt="Снимок для проверки" className="absolute inset-0 w-full h-full object-contain" />
      {!busy && detections.map((d) => (
        <div key={d.id} className="absolute" style={{
          left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%`,
          border: `2px solid ${EQUIPMENT[d.type].color}`, boxShadow: '0 0 0 1px rgba(0,0,0,.45)',
        }}>
          <span className={cn('absolute -left-[2px] text-[11px] leading-none font-semibold text-white px-1.5 py-[3px] whitespace-nowrap font-mono', d.box.y >= 12 ? '-top-[19px]' : 'top-0')}
            style={{ background: EQUIPMENT[d.type].color }}>
            {EQUIPMENT[d.type].name} {d.confidence.toFixed(2)}
          </span>
        </div>
      ))}
      {busy && <div className="absolute inset-0 bg-slate-950/55 text-white flex items-center justify-center font-medium">Ищем технику…</div>}
    </div>
  )
}

/** Итог разбора снимка: найденная техника, сверка с правилом этапа, отклонения с объяснением */
export function AnalyzeSummary({ result }: { result: AnalyzeResult }) {
  if (!result.supported) {
    return (
      <div className="rounded-xl bg-info-bg text-info-fg p-4 flex gap-3">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Этот снимок не распознан</div>
          <p className="text-[15px] mt-0.5">{result.note}</p>
        </div>
      </div>
    )
  }
  const state = {
    ok: { label: 'Есть', cls: 'bg-ok-bg text-ok-fg' },
    low: { label: 'Мало', cls: 'bg-warn-bg text-warn-fg' },
    missing: { label: 'Нет', cls: 'bg-danger-bg text-danger-fg' },
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="font-semibold mb-2">Найденная техника</div>
        {result.detections.length === 0 ? <p className="text-muted-foreground">На снимке техники не обнаружено.</p> : (
          <ul className="flex flex-wrap gap-2">
            {result.detections.map((d) => (
              <li key={d.id} className="inline-flex items-center gap-2 rounded-sm pl-1.5 pr-2.5 py-1 text-[14px] font-medium text-white" style={{ background: EQUIPMENT[d.type].color }}>
                <VehicleIcon type={d.type} className="w-7 h-4" fill="#fff" /> {EQUIPMENT[d.type].name} · {Math.round(d.confidence * 100)}%
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="font-semibold mb-1">Сверка с этапом «{result.stageName}»</div>
        <ul className="divide-y divide-border">
          {result.rows.map((r) => (
            <li key={r.type} className="py-2.5 flex items-center gap-3">
              <VehicleIcon type={r.type} className="w-12 h-8 shrink-0" fill={EQUIPMENT[r.type].color} />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{EQUIPMENT[r.type].name}</div>
                <div className="text-muted-foreground text-[14px]">нужно {r.need}, на снимке {r.have}</div>
              </div>
              <span className={cn('rounded-sm px-2.5 py-1 font-semibold text-[14px] shrink-0', state[r.state].cls)}>{state[r.state].label}</span>
            </li>
          ))}
        </ul>
      </div>

      {result.deviations.length === 0 ? (
        <div className="rounded-xl bg-ok-bg text-ok-fg p-4 font-semibold flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Отклонений нет: техника соответствует этапу</div>
      ) : result.deviations.map((d) => (
        <div key={d.kind + d.type} className={cn('rounded-xl p-4', d.kind === 'unexpected' ? 'bg-warn-bg text-warn-fg' : 'bg-danger-bg text-danger-fg')}>
          <div className="font-semibold text-[17px]">{d.title}</div>
          <p className="text-[15px] mt-1 text-foreground">{d.why}</p>
        </div>
      ))}

      <p className="text-[13px] text-muted-foreground">
        Анализатор: {result.provider === 'mock' ? 'демонстрационный' : 'внешний сервис распознавания'}{result.model ? ` (${result.model})` : ''} · {result.elapsedMs} мс
      </p>
    </div>
  )
}
