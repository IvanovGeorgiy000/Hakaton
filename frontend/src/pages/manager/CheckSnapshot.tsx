import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Upload, Loader2, ImagePlus } from 'lucide-react'
import { EQUIPMENT, SITES, type EquipmentType, type Detection } from '@/data'
import { useApp } from '@/store/context'
import { byStage } from '@/store/selectors'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { VehicleIcon } from '@/components/VehicleIcon'
import { cn } from '@/lib/utils'

/** Демо-детекции для загруженного снимка (в боевой версии — ответ модели) */
const DEMO: Detection[] = [
  { id: 'x1', type: 'excavator', confidence: 0.93, box: { x: 34, y: 38, w: 26, h: 30 } },
  { id: 'x2', type: 'dump_truck', confidence: 0.88, box: { x: 6, y: 54, w: 22, h: 20 } },
  { id: 'x3', type: 'crane', confidence: 0.81, box: { x: 68, y: 26, w: 26, h: 44 } },
]

/** Ручная проверка снимка: загрузить фото → распознать → сверить с этапом выбранного объекта */
export function CheckSnapshot() {
  const { rules } = useApp()
  const [img, setImg] = useState<string | null>(null)
  const [siteId, setSiteId] = useState(SITES[0].id)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const site = SITES.find((s) => s.id === siteId)!
  const stage = byStage(site.currentStageId)
  const rule = stage.ruleKey ? rules[stage.ruleKey] : undefined

  const onFile = (f?: File) => {
    if (!f) return
    setImg(URL.createObjectURL(f))
    setPhase('idle')
  }
  const analyze = () => {
    setPhase('busy')
    setTimeout(() => setPhase('done'), 1400)
  }

  const observed: Partial<Record<EquipmentType, number>> = {}
  DEMO.forEach((d) => { observed[d.type] = (observed[d.type] ?? 0) + 1 })

  return (
    <div>
      <PageHeader title="Проверить снимок" subtitle="Загрузите фото со стройки — система найдёт технику и сверит с планом" />
      <div className="grid lg:grid-cols-[1fr_360px] gap-5">
        <div>
          <div
            className={cn('relative aspect-video rounded-xl border-2 border-dashed border-border bg-card overflow-hidden flex items-center justify-center', !img && 'cursor-pointer hover:border-primary')}
            onClick={() => !img && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
          >
            {img ? (
              <>
                <img src={img} alt="Загруженный снимок" className="absolute inset-0 w-full h-full object-cover" />
                {phase === 'done' && DEMO.map((d) => (
                  <motion.div
                    key={d.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    className="absolute rounded-[3px]"
                    style={{ left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%`, border: `3px solid ${EQUIPMENT[d.type].color}` }}
                  >
                    <span className="absolute -top-[24px] -left-[3px] text-[13px] font-bold text-white px-1.5 py-0.5 rounded-t whitespace-nowrap" style={{ background: EQUIPMENT[d.type].color }}>
                      {EQUIPMENT[d.type].name} {Math.round(d.confidence * 100)}%
                    </span>
                  </motion.div>
                ))}
                {phase === 'busy' && (
                  <div className="absolute inset-0 bg-slate-900/60 text-white flex flex-col items-center justify-center gap-2 font-semibold text-lg">
                    <Loader2 className="w-10 h-10 animate-spin" /> Ищем технику…
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-muted-foreground p-6">
                <ImagePlus className="w-14 h-14 mx-auto mb-2" />
                <div className="text-lg font-semibold text-foreground">Нажмите или перетащите фото сюда</div>
                <div className="text-[14px]">JPG или PNG, любой размер</div>
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-3 mt-4">
            <Button variant="outline" size="lg" onClick={() => inputRef.current?.click()}><Upload className="w-5 h-5" /> {img ? 'Другое фото' : 'Выбрать фото'}</Button>
            <Button size="lg" onClick={analyze} disabled={!img || phase === 'busy'}>{phase === 'busy' ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Распознать и сверить</Button>
          </div>
          <p className="text-muted-foreground text-[14px] mt-3">В демо-версии рамки показываются как пример. В рабочей версии их построит модель распознавания.</p>
        </div>

        <div className="space-y-4">
          <Card><CardBody>
            <label className="block font-semibold mb-2" htmlFor="site">С каким объектом сверять</label>
            <select id="site" value={siteId} onChange={(e) => { setSiteId(e.target.value) }} className="w-full min-h-[48px] rounded-lg border-2 border-border bg-card px-3 text-[16px] font-semibold">
              {SITES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="text-muted-foreground text-[14px] mt-2">Этап сейчас: <b className="text-foreground">{stage.name}</b></div>
          </CardBody></Card>

          <AnimatePresence>
            {phase === 'done' && rule && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card><CardBody>
                  <h2 className="font-bold text-lg mb-3">Результат сверки</h2>
                  <ul className="space-y-2">
                    {rule.required.map((r) => {
                      const n = observed[r.type] ?? 0
                      const ok = n >= r.min
                      return <Row key={r.type} type={r.type} text={`нужно ${r.min}, нашли ${n}`} tone={ok ? 'ok' : n === 0 ? 'danger' : 'warn'} label={ok ? 'Есть' : n === 0 ? 'Нет' : 'Мало'} />
                    })}
                    {(Object.keys(observed) as EquipmentType[]).filter((t) => rule.unexpected.some((u) => u.type === t)).map((t) => (
                      <Row key={t} type={t} text={rule.unexpected.find((u) => u.type === t)!.why} tone="warn" label="Не по плану" />
                    ))}
                  </ul>
                </CardBody></Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function Row({ type, text, tone, label }: { type: EquipmentType; text: string; tone: 'ok' | 'warn' | 'danger'; label: string }) {
  const cls = { ok: 'bg-ok-bg text-ok-fg', warn: 'bg-warn-bg text-warn-fg', danger: 'bg-danger-bg text-danger-fg' }[tone]
  return (
    <li className="flex items-center gap-3">
      <VehicleIcon type={type} className="w-12 h-8 shrink-0" fill={EQUIPMENT[type].color} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{EQUIPMENT[type].name}</div>
        <div className="text-muted-foreground text-[13px]">{text}</div>
      </div>
      <span className={cn('rounded-full px-3 py-1 font-bold text-[14px] shrink-0', cls)}>{label}</span>
    </li>
  )
}
