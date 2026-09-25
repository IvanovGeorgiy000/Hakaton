import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { SiteStage } from '@/data'
import { useApp } from '@/store/context'
import { ago, cn, fmtWhen } from '@/lib/utils'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { InfoTip } from './ui/InfoTip'

/**
 * «Этап по камерам» — какой этап увидел на кадрах сервис этапов (модель), рядом с этапом по графику.
 * Сервер спрашивает его сам раз в 20 минут; руководитель и администратор могут спросить сейчас.
 * Сервис не подключён — блока нет.
 */
export function StageByCameras({ siteId, className }: { siteId: string; className?: string }) {
  const queryClient = useQueryClient()
  const { notify } = useApp()
  const key = ['stage', siteId]
  const { data } = useQuery({ queryKey: key, queryFn: () => api.siteStage(siteId), refetchInterval: 60_000 })
  const run = useMutation({
    mutationFn: () => api.runSiteStage(siteId),
    onSuccess: (fresh: SiteStage) => {
      queryClient.setQueryData(key, fresh)
      // сервер сохраняет и неудачный запрос: ответ пришёл, но в нём ошибка последнего запроса
      if (fresh.error) notify(`Этап не определён: ${fresh.error}`, 'error')
      else notify(fresh.latest?.stageName ? `Этап по камерам: «${fresh.latest.stageName}»` : 'Сервис этапов не смог определить этап по кадрам')
    },
    onError: (error) => notify(error instanceof ApiError ? error.message : 'Не удалось спросить сервис этапов', 'error'),
  })
  if (!data?.enabled) return null

  const { latest, matchesPlan, plannedStageName } = data
  return (
    <section className={cn('bg-card rounded-xl border border-border shadow-[var(--shadow-card)] px-4 sm:px-5 py-4', className)} aria-busy={run.isPending}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
            Этап по камерам
            <InfoTip label="Как определяется этап по камерам">
              Раз в 20 минут кадры всех камер объекта, сколько работала техника и календарный план уходят в сервис
              этапов. Он смотрит на кадры и называет этап, который идёт на самом деле. Это оценка модели, а не отметка
              прораба: если она расходится с графиком — стоит посмотреть камеры.
            </InfoTip>
          </div>
          <div className="text-xl font-semibold leading-tight mt-1">
            {latest ? latest.stageName ?? 'По кадрам не понять' : 'Ещё не определялся'}
          </div>
          {latest && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[14px] text-muted-foreground">
              {matchesPlan === true && <Badge tone="ok">Совпадает с графиком</Badge>}
              {matchesPlan === false && <Badge tone="warn">Не совпадает с графиком</Badge>}
              {latest.confidence !== null && <span>уверенность {Math.round(latest.confidence * 100)}%</span>}
              <span>{latest.confidence !== null && '· '}{ago(latest.at)}</span>
            </div>
          )}
        </div>
        {data.canRun && (
          <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
            {run.isPending ? 'Определяем…' : 'Определить сейчас'}
          </Button>
        )}
      </div>

      {matchesPlan === false && plannedStageName && (
        <p className="mt-3 text-[15px]">По графику сейчас «{plannedStageName}».</p>
      )}
      {latest?.reason && <p className="mt-2 text-[15px] text-foreground">{latest.reason}</p>}
      {!latest && !data.error && (
        <p className="mt-2 text-[15px] text-muted-foreground">Первый запрос к сервису уйдёт в ближайшие минуты, когда с камер придут свежие кадры.</p>
      )}
      {data.error && data.errorAt && (
        <p className="mt-3 rounded-lg bg-warn-bg text-warn-fg px-3 py-2 text-[14px]" role="status">
          Запрос {fmtWhen(data.errorAt)} не удался{latest ? ' — показан прошлый ответ' : ''}.
          {data.canRun && <> Причина: {data.error}</>}
        </p>
      )}
      <p className="mt-3 text-[13px] text-muted-foreground">
        Оценка модели по кадрам{latest?.model ? ` (${latest.model})` : ''}
        {data.nextAt && <>. Следующая — {fmtWhen(data.nextAt)}</>}
      </p>
    </section>
  )
}
