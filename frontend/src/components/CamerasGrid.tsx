import { useState } from 'react'
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { EQUIPMENT, type Camera, type CaptureResult, type EquipmentType, type Snapshot } from '@/data'
import { useApp } from '@/store/context'
import { ago, fmtWhen, plural } from '@/lib/utils'
import { CameraFrame } from './CameraFrame'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { cn } from '@/lib/utils'

/** Камеры объекта с последними снимками. «Проверить сейчас» запускает настоящую проверку на сервере. */
export function CamerasGrid({ siteId }: { siteId: string }) {
  const { cameras, snapshotsOf, byZone, byCamera, captureSite } = useApp()
  const list = cameras.filter((c) => c.siteId === siteId)
  const [opened, setOpened] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CaptureResult | null>(null)

  const runCheck = async () => {
    setBusy(true)
    setReport(null)
    setReport(await captureSite(siteId))
    setBusy(false)
  }
  const failed = report ? Object.entries(report.errors) : []

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-muted-foreground">Камеры присылают снимки автоматически. Можно проверить объект прямо сейчас.</p>
        <Button onClick={runCheck} disabled={busy} size="lg">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
          Проверить сейчас
        </Button>
      </div>

      <div aria-live="polite">
        {busy && (
          <div className="bg-info-bg text-info-fg rounded-xl p-4 mb-4 flex items-center gap-3 font-medium">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" /> Получаем снимки, ищем технику и сверяем с планом работ…
          </div>
        )}
        {report && !busy && (
          <div className={cn('rounded-xl p-4 mb-4 flex items-start gap-3', failed.length ? 'bg-warn-bg text-warn-fg' : 'bg-ok-bg text-ok-fg')}>
            {failed.length ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />}
            <div>
              <div className="font-semibold">
                Проверка выполнена: {plural(report.snapshots.length, 'новый снимок', 'новых снимка', 'новых снимков')},{' '}
                {report.check.violations.length ? plural(report.check.violations.length, 'отклонение', 'отклонения', 'отклонений') : 'отклонений нет'}
              </div>
              {failed.map(([id, reason]) => <div key={id} className="text-[15px]">{byCamera(id)?.name ?? 'Камера'}: {reason}</div>)}
            </div>
          </div>
        )}
      </div>

      {list.length === 0 && <p className="text-muted-foreground">На объекте пока нет камер.</p>}
      <div className="grid sm:grid-cols-2 gap-4">
        {list.map((c) => {
          const last = snapshotsOf(c.id)[0]
          return (
            <button
              key={c.id} type="button" onClick={() => setOpened(c.id)}
              className="text-left bg-card rounded-xl border border-border shadow-[var(--shadow-card)] overflow-hidden cursor-pointer transition-[box-shadow,border-color] duration-150 hover:border-border-strong hover:shadow-[var(--shadow-hover)]"
            >
              <CameraFrame camera={c} snapshot={last} offline={!c.online} className="rounded-none" />
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{c.name}</div>
                  <Badge tone={c.online ? 'ok' : 'neutral'}>{c.online ? 'Работает' : c.enabled ? 'Нет сигнала' : 'Выключена'}</Badge>
                </div>
                <div className="text-muted-foreground text-[14px]">
                  {byZone(c.zoneId)?.name}{c.lastSnapshotAt && ` · снимок ${ago(c.lastSnapshotAt)}`}
                </div>
                {last && c.online && <DetectionTags snapshot={last} />}
              </div>
            </button>
          )
        })}
      </div>
      <CameraHistory camera={byCamera(opened)} snapshots={opened ? snapshotsOf(opened) : []} onClose={() => setOpened(null)} />
    </div>
  )
}

function DetectionTags({ snapshot }: { snapshot: Snapshot }) {
  const counts = new Map<EquipmentType, number>()
  snapshot.detections.forEach((d) => counts.set(d.type, (counts.get(d.type) ?? 0) + 1))
  if (!snapshot.analyzed) return <div className="mt-2 text-[13px] text-muted-foreground">кадр не распознан</div>
  if (counts.size === 0) return <div className="mt-2 text-[13px] text-muted-foreground">техники не видно</div>
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {[...counts].map(([type, n]) => (
        <span key={type} className="text-[13px] font-medium rounded-sm px-2 py-0.5 text-white" style={{ background: EQUIPMENT[type].color }}>
          {EQUIPMENT[type].name} ×{n}
        </span>
      ))}
    </div>
  )
}

/** Последние снимки одной камеры */
function CameraHistory({ camera, snapshots, onClose }: { camera?: Camera; snapshots: Snapshot[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const current = snapshots.find((s) => s.id === picked) ?? snapshots[0]
  return (
    <Modal open={!!camera} onClose={() => { onClose(); setPicked(null) }} title={camera?.name ?? ''} wide>
      {camera && !current && <p className="text-muted-foreground">С этой камеры ещё не получено ни одного снимка.</p>}
      {camera && current && (
        <div className="space-y-5">
          <CameraFrame camera={camera} snapshot={current} offline={!camera.online && current === snapshots[0]} />
          <div>
            <div className="font-semibold mb-2">Последние снимки</div>
            <div className="flex flex-wrap gap-2">
              {snapshots.slice(0, 8).map((s) => (
                <button
                  key={s.id} type="button" onClick={() => setPicked(s.id)}
                  className={cn('min-h-[44px] px-4 rounded-lg font-medium border cursor-pointer transition-colors tabular', s.id === current.id ? 'border-primary bg-info-bg text-info-fg' : 'border-border-strong hover:bg-muted')}
                >
                  {fmtWhen(s.takenAt)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold mb-2">Что видно на снимке</div>
            {!current.analyzed ? (
              <p className="text-muted-foreground">{current.note ?? 'Кадр не удалось разобрать.'}</p>
            ) : current.detections.length === 0 ? (
              <p className="text-muted-foreground">Техники не обнаружено.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-2">
                {current.detections.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 bg-muted rounded-lg px-3 py-2">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: EQUIPMENT[d.type].color }} />
                    <span className="font-medium flex-1">{EQUIPMENT[d.type].name}</span>
                    <span className="text-muted-foreground text-[14px]">
                      {d.moving == null ? '' : d.moving ? 'движется · ' : 'стоит · '}{Math.round(d.confidence * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
