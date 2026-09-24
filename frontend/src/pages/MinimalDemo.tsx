import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Upload, Loader2, ArrowLeft } from 'lucide-react'
import { api, ApiError } from '@/api'
import { EQUIPMENT, type AnalyzeResult } from '@/data'
import { AnalyzedFrame, AnalyzeSummary } from '@/components/AnalyzeView'
import { VehicleIcon } from '@/components/VehicleIcon'
import { ThemeMenuButton } from '@/components/ThemePicker'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Минимальная страница по ТЗ (раздел 2): один экран, на котором видны все обязательные функции —
 * обнаружение техники на снимке, сопоставление с этапом работ по правилу, выявление отклонений с объяснением.
 * Работает без входа: сервер отдаёт правила и примеры (GET /public/demo) и разбирает снимок (POST /public/analyze).
 */
export function MinimalDemo() {
  const demo = useQuery({ queryKey: ['public-demo'], queryFn: api.publicDemo, staleTime: Infinity, retry: 1 })
  const [ruleKey, setRuleKey] = useState('excavation')
  const [source, setSource] = useState<{ file: File; preview: string } | { sample: string; preview: string } | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)  // номер запроса: ответ на прежний выбор не показываем под новым

  const samples = demo.data?.samples ?? []
  const rule = demo.data?.rules.find((r) => r.key === ruleKey)
  const current = source ?? (samples[0] ? { sample: samples[0].id, preview: samples[0].imageUrl } : null)

  // предпросмотр своего фото держит память, пока не освободим ссылку
  useEffect(() => () => { if (source && 'file' in source) URL.revokeObjectURL(source.preview) }, [source])

  const reset = () => { request.current++; setResult(null); setError(null); setBusy(false) }
  const pick = (next: typeof source) => { setSource(next); reset() }

  const run = async () => {
    if (!current) return
    const id = ++request.current
    setBusy(true)
    setError(null)
    try {
      const res = await api.publicAnalyze('file' in current ? { image: current.file, ruleKey } : { sample: current.sample, ruleKey })
      if (id === request.current) setResult(res)
    } catch (e) {
      if (id === request.current) setError(e instanceof ApiError ? e.message : 'Не удалось разобрать снимок')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-[28px] font-semibold leading-tight">Снимок → техника → этап → отклонения</h1>
            <p className="text-muted-foreground mt-1">Все обязательные функции по ТЗ на одном экране</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeMenuButton />
            <Link to="/" className="inline-flex items-center gap-1.5 min-h-[44px] text-primary font-medium hover:underline"><ArrowLeft className="w-5 h-5" /> Полный интерфейс</Link>
          </div>
        </header>

        {demo.isPending && <p className="text-muted-foreground">Загружаем примеры…</p>}
        {demo.isError && <p role="alert" className="rounded-xl bg-warn-bg text-warn-fg px-4 py-3">Нет связи с сервером. Проверьте, что бэкенд запущен, и обновите страницу.</p>}

        {demo.data && current && (
          <section className="bg-card rounded-xl border border-border shadow-[var(--shadow-card)] p-4 sm:p-5 grid lg:grid-cols-[1fr_330px] gap-5">
            <div>
              <h2 className="font-semibold text-[17px] mb-2">1. Снимок с камеры</h2>
              <AnalyzedFrame src={result?.imageUrl ?? current.preview} detections={result?.detections ?? []} busy={busy} />
              <div className="flex flex-wrap gap-2 mt-3">
                {samples.map((s) => (
                  <button key={s.id} type="button" onClick={() => pick({ sample: s.id, preview: s.imageUrl })}
                    className={cn('min-h-[40px] px-3 rounded-lg text-[14px] font-medium border cursor-pointer transition-colors',
                      'sample' in current && current.sample === s.id ? 'border-primary bg-info-bg text-info-fg' : 'border-border-strong bg-card hover:bg-muted')}>
                    {s.label}
                  </button>
                ))}
                <button type="button" onClick={() => inputRef.current?.click()}
                  className={cn('min-h-[40px] px-3 rounded-lg text-[14px] font-medium border cursor-pointer inline-flex items-center gap-1.5 transition-colors',
                    'file' in current ? 'border-primary bg-info-bg text-info-fg' : 'border-dashed border-border-strong hover:bg-muted')}>
                  <Upload className="w-4 h-4" /> Своё фото
                </button>
                {/* скрыто от Tab: выбирают кнопкой «Своё фото»; value сбрасываем, чтобы тот же файл можно было выбрать снова */}
                <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) pick({ file, preview: URL.createObjectURL(file) }); e.target.value = '' }} />
              </div>
            </div>

            <div>
              <h2 className="font-semibold text-[17px] mb-2">2. Этап работ по графику</h2>
              <select value={ruleKey} onChange={(e) => { setRuleKey(e.target.value); reset() }} aria-label="Этап работ"
                className="w-full min-h-[48px] rounded-lg border border-border-strong bg-card px-3 text-[16px] font-medium">
                {demo.data.rules.map((r) => <option key={r.key} value={r.key}>{r.stageName}</option>)}
              </select>
              {rule && (
                <div className="mt-3 text-[14px] space-y-1.5">
                  <div className="text-muted-foreground">Правило этапа:</div>
                  {rule.required.map((r) => (
                    <div key={r.type} className="flex items-center gap-2">
                      <VehicleIcon type={r.type} className="w-8 h-5" fill={EQUIPMENT[r.type].color} />
                      <span><b>{EQUIPMENT[r.type].name}</b> — не меньше {r.min}</span>
                    </div>
                  ))}
                  {rule.unexpected.length > 0 && <div className="text-muted-foreground pt-1">Не должно быть: {rule.unexpected.map((u) => EQUIPMENT[u.type].name.toLowerCase()).join(', ')}</div>}
                </div>
              )}
              <Button size="lg" full className="mt-4" onClick={run} disabled={busy}>
                {busy && <Loader2 className="w-5 h-5 animate-spin" />} Распознать и сверить
              </Button>
              {error && <p role="alert" className="mt-3 text-danger font-medium">{error}</p>}
            </div>
          </section>
        )}

        {result && (
          <section className="bg-card rounded-xl border border-border shadow-[var(--shadow-card)] p-4 sm:p-5">
            <h2 className="font-semibold text-[17px] mb-3">3. Результат</h2>
            <AnalyzeSummary result={result} />
          </section>
        )}
      </div>
    </div>
  )
}
