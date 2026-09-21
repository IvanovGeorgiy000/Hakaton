import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Loader2, ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { CAMERAS, EQUIPMENT, RULES, SAMPLE_SNAPSHOTS, SNAPSHOTS, type Detection, type EquipmentType, type RuleKey, type Snapshot } from '@/data'
import { CameraFrame } from '@/components/CameraFrame'
import { VehicleIcon } from '@/components/VehicleIcon'
import { Button } from '@/components/ui/Button'
import { fmtTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

/**
 * Минимальная страница по ТЗ (раздел 2): один экран, на котором видно все обязательные функции —
 * 1) обнаружение и классификация техники на снимке, 2) сопоставление с этапом работ по правилу,
 * 3) выявление отклонений с объяснением. Без ролей, навигации и лишних экранов.
 */

/** Примеры снимков для быстрой демонстрации (берём из мок-данных камер) */
const SAMPLES: { id: string; label: string }[] = [
  { id: 'sn-c1-1230', label: 'Котлован: только экскаватор' },
  { id: 'sample-loading', label: 'Котлован: экскаватор и самосвал' },
  { id: 'sn-c2-1230', label: 'Въезд: автокран' },
  { id: 'sample-mixers', label: 'Фундамент: два бетоносмесителя' },
  { id: 'sn-c6-1230', label: 'Дорога: один каток' },
]

/** Демо-детекции для загруженного файла (в боевой версии — ответ модели) */
const UPLOAD_DEMO: Detection[] = [
  { id: 'u1', type: 'excavator', confidence: 0.93, box: { x: 34, y: 38, w: 26, h: 30 } },
  { id: 'u2', type: 'dump_truck', confidence: 0.88, box: { x: 6, y: 54, w: 22, h: 20 } },
  { id: 'u3', type: 'crane', confidence: 0.81, box: { x: 68, y: 26, w: 26, h: 44 } },
]

type Deviation = { kind: 'missing' | 'count_below' | 'unexpected'; type: EquipmentType; need?: number; have: number; why: string }

/** Сопоставление снимка с правилом этапа — вся методика в одной функции */
function compare(detections: Detection[], ruleKey: RuleKey): { observed: Partial<Record<EquipmentType, number>>; deviations: Deviation[] } {
  const rule = RULES[ruleKey]
  const observed: Partial<Record<EquipmentType, number>> = {}
  detections.forEach((d) => { observed[d.type] = (observed[d.type] ?? 0) + 1 })
  const deviations: Deviation[] = []
  rule.required.forEach((r) => {
    const have = observed[r.type] ?? 0
    if (have === 0) deviations.push({ kind: 'missing', type: r.type, need: r.min, have, why: r.why })
    else if (have < r.min) deviations.push({ kind: 'count_below', type: r.type, need: r.min, have, why: r.why })
  })
  rule.unexpected.forEach((u) => {
    const have = observed[u.type] ?? 0
    if (have > 0) deviations.push({ kind: 'unexpected', type: u.type, have, why: u.why })
  })
  return { observed, deviations }
}

export function MinimalDemo() {
  const [ruleKey, setRuleKey] = useState<RuleKey>('excavation')
  const [sampleId, setSampleId] = useState(SAMPLES[0].id)
  const [upload, setUpload] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const snapshot: Snapshot | undefined = upload ? undefined : [...SNAPSHOTS, ...SAMPLE_SNAPSHOTS].find((s) => s.id === sampleId)
  const camera = snapshot ? CAMERAS.find((c) => c.id === snapshot.cameraId)! : undefined
  const detections = upload ? UPLOAD_DEMO : snapshot?.detections ?? []
  const rule = RULES[ruleKey]
  const result = compare(detections, ruleKey)

  const run = () => { setPhase('busy'); setTimeout(() => setPhase('done'), 900) }
  const pickSample = (id: string) => { setSampleId(id); setUpload(null); setPhase('idle') }
  const onFile = (f?: File) => { if (!f) return; setUpload(URL.createObjectURL(f)); setPhase('idle') }

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Снимок → техника → этап → отклонения</h1>
            <p className="text-muted-foreground">Минимальная демонстрация обязательных функций по ТЗ на одном экране.</p>
          </div>
          <Link to="/" className="inline-flex items-center gap-1.5 min-h-[44px] text-primary font-semibold hover:underline"><ArrowLeft className="w-5 h-5" /> Полный интерфейс</Link>
        </header>

        {/* Шаг 1: входные данные */}
        <section className="bg-card rounded-xl border border-border p-4 sm:p-5 grid lg:grid-cols-[1fr_320px] gap-5">
          <div>
            <h2 className="font-bold text-lg mb-2">1. Снимок с камеры</h2>
            {upload ? (
              <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-800">
                <img src={upload} alt="Загруженный снимок" className="absolute inset-0 w-full h-full object-cover" />
                {phase === 'done' && UPLOAD_DEMO.map((d) => <Box key={d.id} d={d} />)}
              </div>
            ) : camera && snapshot ? (
              <CameraFrame camera={camera} snapshot={snapshot} showBoxes={phase === 'done'} />
            ) : null}
            <div className="flex flex-wrap gap-2 mt-3">
              {SAMPLES.map((s) => (
                <button key={s.id} type="button" onClick={() => pickSample(s.id)}
                  className={cn('min-h-[40px] px-3 rounded-lg text-[14px] font-semibold border-2 cursor-pointer transition-colors', !upload && sampleId === s.id ? 'border-primary bg-info-bg text-info-fg' : 'border-border bg-card hover:border-primary/60')}>
                  {s.label}
                </button>
              ))}
              <button type="button" onClick={() => inputRef.current?.click()}
                className={cn('min-h-[40px] px-3 rounded-lg text-[14px] font-semibold border-2 cursor-pointer inline-flex items-center gap-1.5 transition-colors', upload ? 'border-primary bg-info-bg text-info-fg' : 'border-dashed border-border hover:border-primary/60')}>
                <Upload className="w-4 h-4" /> Своё фото
              </button>
              <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>

          <div>
            <h2 className="font-bold text-lg mb-2">2. Этап работ по графику</h2>
            <select value={ruleKey} onChange={(e) => { setRuleKey(e.target.value as RuleKey); setPhase('idle') }}
              className="w-full min-h-[48px] rounded-lg border-2 border-border bg-card px-3 text-[16px] font-semibold">
              {Object.values(RULES).map((r) => <option key={r.key} value={r.key}>{r.stageName}</option>)}
            </select>
            <div className="mt-3 text-[14px] space-y-1">
              <div className="text-muted-foreground">Правило этапа:</div>
              {rule.required.map((r) => <div key={r.type} className="flex items-center gap-2"><VehicleIcon type={r.type} className="w-8 h-5" fill={EQUIPMENT[r.type].color} /><span><b>{EQUIPMENT[r.type].name}</b> — не меньше {r.min}</span></div>)}
              {rule.unexpected.length > 0 && <div className="text-muted-foreground pt-1">Не должно быть: {rule.unexpected.map((u) => EQUIPMENT[u.type].name.toLowerCase()).join(', ')}</div>}
            </div>
            <Button size="lg" full className="mt-4" onClick={run} disabled={phase === 'busy'}>
              {phase === 'busy' ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Распознать и сверить
            </Button>
          </div>
        </section>

        {phase === 'done' && (
          <>
            {/* Шаг 3: что распознано */}
            <section className="bg-card rounded-xl border border-border p-4 sm:p-5">
              <h2 className="font-bold text-lg mb-2">3. Обнаруженная техника</h2>
              {detections.length === 0 ? <p className="text-muted-foreground">Техники не обнаружено.</p> : (
                <ul className="flex flex-wrap gap-2">
                  {detections.map((d) => (
                    <li key={d.id} className="inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-[15px] font-semibold text-white" style={{ background: EQUIPMENT[d.type].color }}>
                      <VehicleIcon type={d.type} className="w-8 h-5" fill="#fff" /> {EQUIPMENT[d.type].name} · {Math.round(d.confidence * 100)}%
                    </li>
                  ))}
                </ul>
              )}
              {snapshot && camera && <p className="text-muted-foreground text-[14px] mt-2">{camera.name}, снимок {fmtTime(snapshot.takenAt)}</p>}
            </section>

            {/* Шаг 4: сопоставление и отклонения */}
            <section className="bg-card rounded-xl border border-border p-4 sm:p-5">
              <h2 className="font-bold text-lg mb-3">4. Сверка с этапом «{rule.stageName}»</h2>
              <ul className="divide-y divide-border mb-4">
                {rule.required.map((r) => {
                  const have = result.observed[r.type] ?? 0
                  const state = have >= r.min ? 'ok' : have === 0 ? 'missing' : 'low'
                  return <Row key={r.type} type={r.type} text={`нужно ${r.min}, видим ${have}`} state={state} />
                })}
                {result.deviations.filter((d) => d.kind === 'unexpected').map((d) => (
                  <Row key={d.type} type={d.type} text={d.why} state="extra" />
                ))}
              </ul>

              {result.deviations.length === 0 ? (
                <div className="rounded-xl bg-ok-bg text-ok-fg p-4 font-bold text-lg flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> Отклонений нет: техника соответствует этапу</div>
              ) : (
                <div className="space-y-3">
                  {result.deviations.map((d) => (
                    <div key={d.kind + d.type} className={cn('rounded-xl p-4 border-l-8', d.kind === 'unexpected' ? 'bg-warn-bg/60 border-warn' : 'bg-danger-bg/60 border-danger')}>
                      <div className="font-bold text-lg">{title(d)}</div>
                      <div className="text-[15px] mt-1">
                        <b>Почему:</b> этап «{rule.stageName}» {d.kind === 'unexpected'
                          ? <>не предусматривает технику «{EQUIPMENT[d.type].name.toLowerCase()}» ({d.why.toLowerCase()}), а на снимке она есть: {d.have} шт.</>
                          : <>требует «{EQUIPMENT[d.type].name.toLowerCase()}» не меньше {d.need} ({d.why.toLowerCase()}), а на снимке: {d.have} шт.</>}
                      </div>
                      <div className="text-[15px] mt-1"><b>Зона:</b> {camera ? camera.name : 'загруженный снимок'} · <b>Доказательство:</b> снимок выше, рамки {EQUIPMENT[d.type].name.toLowerCase()} выделены цветом.</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function title(d: Deviation) {
  const e = EQUIPMENT[d.type]
  if (d.kind === 'missing') return `Нет ${e.genitivePlural} — возможное снижение темпа работ`
  if (d.kind === 'count_below') return `${e.namePlural[0].toUpperCase() + e.namePlural.slice(1)}: меньше, чем нужно (${d.have} из ${d.need})`
  return `${e.name} не соответствует этапу`
}

function Box({ d }: { d: Detection }) {
  return (
    <div className="absolute rounded-[3px]" style={{ left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%`, border: `3px solid ${EQUIPMENT[d.type].color}` }}>
      <span className="absolute -top-[24px] -left-[3px] text-[13px] font-bold text-white px-1.5 py-0.5 rounded-t whitespace-nowrap" style={{ background: EQUIPMENT[d.type].color }}>
        {EQUIPMENT[d.type].name} {Math.round(d.confidence * 100)}%
      </span>
    </div>
  )
}

function Row({ type, text, state }: { type: EquipmentType; text: string; state: 'ok' | 'missing' | 'low' | 'extra' }) {
  const m = {
    ok: { label: 'Есть', cls: 'bg-ok-bg text-ok-fg', Icon: CheckCircle2 },
    missing: { label: 'Нет', cls: 'bg-danger-bg text-danger-fg', Icon: XCircle },
    low: { label: 'Мало', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
    extra: { label: 'Лишняя', cls: 'bg-warn-bg text-warn-fg', Icon: AlertTriangle },
  }[state]
  return (
    <li className="py-2.5 flex items-center gap-3">
      <VehicleIcon type={type} className="w-12 h-8 shrink-0" fill={EQUIPMENT[type].color} />
      <div className="flex-1 min-w-0"><div className="font-semibold">{EQUIPMENT[type].name}{state === 'extra' && ' — не по плану'}</div><div className="text-muted-foreground text-[14px]">{text}</div></div>
      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold text-[14px] shrink-0', m.cls)}><m.Icon className="w-4 h-4" /> {m.label}</span>
    </li>
  )
}
