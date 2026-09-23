import { useState } from 'react'
import { Loader2, Plus, PlugZap, Power, Trash2, Video } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { Camera } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CameraFrame } from '@/components/CameraFrame'
import { AddCameraDialog } from '@/components/AddCameraDialog'
import { LiveVideoModal } from '@/components/LiveVideo'
import { ago } from '@/lib/utils'

/** Камеры по объектам: адрес, состояние, последний снимок. Здесь же добавление камеры по IP. */
export function AdminCameras() {
  const { cameras, sites, byZone, snapshotsOf, setCameraEnabled, deleteCamera, notify, refresh } = useApp()
  const [adding, setAdding] = useState<string | true | null>(null)
  const [removing, setRemoving] = useState<Camera | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [watching, setWatching] = useState<Camera | null>(null)

  const test = async (camera: Camera) => {
    setTesting(camera.id)
    try {
      const result = await api.testCamera(camera.id)
      notify(`${camera.name}: ${result.message}`, result.ok ? 'ok' : 'error')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Не удалось проверить камеру', 'error')
    } finally {
      setTesting(null)
      void refresh()
    }
  }

  return (
    <div>
      <PageHeader
        title="Камеры" subtitle="Какая камера за какой зоной следит и на связи ли она"
        action={<Button size="lg" onClick={() => setAdding(true)}><Plus className="w-5 h-5" /> Добавить камеру</Button>}
      />
      <div className="space-y-8">
        {sites.map((site) => {
          const list = cameras.filter((c) => c.siteId === site.id)
          return (
            <section key={site.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-[18px] font-semibold">{site.name}</h2>
                <Button variant="ghost" size="sm" onClick={() => setAdding(site.id)}><Plus className="w-4 h-4" /> Камера на этот объект</Button>
              </div>
              {list.length === 0 && <p className="text-muted-foreground">На объекте пока нет камер.</p>}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((c) => (
                  <article key={c.id} className="bg-card rounded-xl border border-border shadow-[var(--shadow-card)] overflow-hidden flex flex-col">
                    <CameraFrame camera={c} snapshot={snapshotsOf(c.id)[0]} offline={!c.online} showLabels={false} className="rounded-none" />
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold leading-snug">{c.name}</h3>
                        <Badge tone={c.online ? 'ok' : c.enabled ? 'danger' : 'neutral'}>{c.online ? 'Работает' : c.enabled ? 'Нет связи' : 'Выключена'}</Badge>
                      </div>
                      <dl className="mt-2 space-y-0.5 text-[14px] text-muted-foreground">
                        <div>Зона: <span className="text-foreground">{byZone(c.zoneId)?.name}</span></div>
                        <div className="break-all">{c.address
                          ? <>Адрес: <span className="text-foreground font-mono text-[13px]">{c.address}</span>{c.hasCredentials && ' · с паролем'}</>
                          : 'Демонстрационная камера'}</div>
                        <div>Последний снимок: {c.lastSnapshotAt ? ago(c.lastSnapshotAt) : 'ещё не было'}</div>
                      </dl>
                      {c.enabled && c.lastError && <p className="mt-2 text-[14px] text-danger">{c.lastError}</p>}
                      <div className="mt-auto pt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => void setCameraEnabled(c, !c.enabled)}><Power className="w-4 h-4" /> {c.enabled ? 'Выключить' : 'Включить'}</Button>
                        {c.sourceType === 'rtsp' && <Button variant="outline" size="sm" onClick={() => setWatching(c)}><Video className="w-4 h-4" /> Видео</Button>}
                        <Button variant="outline" size="sm" disabled={testing === c.id} onClick={() => void test(c)}>
                          {testing === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Проверить связь
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={`Удалить ${c.name}`} onClick={() => setRemoving(c)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-8 bg-card border border-border rounded-xl p-5 text-[15px] leading-relaxed">
        <b>Как ставить камеры, чтобы система работала хорошо.</b> Камера смотрит на зону работ сверху под углом 30–45°,
        охватывает рабочую зону целиком и не направлена против солнца. На объект — минимум две камеры: рабочая зона и въезд.
        Кадры нужны не реже раза в час.
      </div>

      <LiveVideoModal camera={watching} onClose={() => setWatching(null)} />
      <AddCameraDialog open={adding !== null} defaultSiteId={typeof adding === 'string' ? adding : undefined} onClose={() => setAdding(null)} />
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Удалить камеру?">
        {removing && (
          <div className="space-y-5">
            <p>«{removing.name}» перестанет опрашиваться и исчезнет из списков. Снимки, которые служат доказательствами в предупреждениях, сохранятся.</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" size="lg" onClick={async () => { await deleteCamera(removing); setRemoving(null) }}>Удалить</Button>
              <Button variant="outline" size="lg" onClick={() => setRemoving(null)}>Отмена</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
