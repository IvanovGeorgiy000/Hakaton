import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload, Loader2, ImagePlus } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { AnalyzeResult } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { AnalyzedFrame, AnalyzeSummary } from '@/components/AnalyzeView'
import { cn } from '@/lib/utils'

/** Ручная проверка: загрузить фото (или взять пример) → сервер находит технику и сверяет с этапом объекта */
export function CheckSnapshot() {
  const { sites, byStage } = useApp()
  const samples = useQuery({ queryKey: ['samples'], queryFn: api.samples, staleTime: Infinity })
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [source, setSource] = useState<{ file: File; preview: string } | { sample: string; preview: string } | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)  // номер запроса: ответ на прежний выбор не показываем под новым
  const stage = byStage(sites.find((s) => s.id === siteId)?.currentStageId ?? null)

  // предпросмотр своего фото держит память, пока не освободим ссылку
  useEffect(() => () => { if (source && 'file' in source) URL.revokeObjectURL(source.preview) }, [source])

  const reset = () => { request.current++; setResult(null); setError(null); setBusy(false) }
  const pick = (next: typeof source) => { setSource(next); reset() }
  const onFile = (file?: File) => file && pick({ file, preview: URL.createObjectURL(file) })

  const analyze = async () => {
    if (!source) return
    const id = ++request.current
    setBusy(true)
    setError(null)
    try {
      const res = await api.analyze('file' in source ? { image: source.file, siteId } : { sample: source.sample, siteId })
      if (id === request.current) setResult(res)
    } catch (e) {
      if (id === request.current) setError(e instanceof ApiError ? e.message : 'Не удалось разобрать снимок')
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Проверить фото" info="Загрузите фото со стройки — система найдёт на нём технику и сверит её с планом объекта на сегодня." />
      <div className="grid lg:grid-cols-[1fr_380px] gap-5">
        <div>
          {source ? (
            <AnalyzedFrame src={result?.imageUrl ?? source.preview} detections={result?.detections ?? []} busy={busy} />
          ) : (
            <button
              type="button" onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
              className="w-full aspect-video rounded-xl border-2 border-dashed border-border-strong bg-card text-muted-foreground flex flex-col items-center justify-center p-6 cursor-pointer transition-colors hover:border-primary"
            >
              <ImagePlus className="w-12 h-12 mb-2" />
              <span className="text-lg font-semibold text-foreground">Нажмите или перетащите фото сюда</span>
              <span className="text-[14px]">JPG или PNG</span>
            </button>
          )}
          {/* скрыто от Tab: выбирают кнопками выше; value сбрасываем, чтобы тот же файл можно было выбрать снова */}
          <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />

          <div className="flex flex-wrap gap-3 mt-4">
            <Button variant="outline" size="lg" onClick={() => inputRef.current?.click()}><Upload className="w-5 h-5" /> {source ? 'Другое фото' : 'Выбрать фото'}</Button>
            <Button size="lg" onClick={analyze} disabled={!source || busy || !siteId}>
              {busy && <Loader2 className="w-5 h-5 animate-spin" />} Распознать и сверить
            </Button>
          </div>
          {error && <p role="alert" className="mt-3 text-danger font-medium">{error}</p>}

          {samples.data && (
            <div className="mt-5">
              <div className="text-[14px] text-muted-foreground mb-2">Или возьмите готовый пример:</div>
              <div className="flex flex-wrap gap-2">
                {samples.data.map((s) => (
                  <button key={s.id} type="button" onClick={() => pick({ sample: s.id, preview: s.imageUrl })}
                    className={cn('min-h-[44px] px-3 rounded-lg text-[14px] font-medium border cursor-pointer transition-colors',
                      source && 'sample' in source && source.sample === s.id ? 'border-primary bg-info-bg text-info-fg' : 'border-border-strong bg-card hover:bg-muted')}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card><CardBody>
            <label className="block font-semibold mb-2" htmlFor="site">С каким объектом сверять</label>
            <select id="site" value={siteId} onChange={(e) => { setSiteId(e.target.value); reset() }}
              className="w-full min-h-[48px] rounded-lg border border-border-strong bg-card px-3 text-[16px] font-medium">
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="text-muted-foreground text-[14px] mt-2">Этап сейчас: <b className="text-foreground">{stage?.name ?? 'нет этапа по плану'}</b></div>
          </CardBody></Card>
          {result && <Card><CardBody><AnalyzeSummary result={result} /></CardBody></Card>}
        </div>
      </div>
    </div>
  )
}
