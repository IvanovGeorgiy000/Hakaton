import { useState } from 'react'
import { Loader2, Pencil, Plus, PlugZap, Power, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { Camera } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { VideoWall } from '@/components/video/VideoWall'
import { AddCameraDialog, EditCameraDialog } from '@/components/CameraDialogs'

/** Камеры по объектам: живое видео и управление — добавить по IP, изменить адрес, выключить, проверить, удалить */
export function AdminCameras() {
  const { cameras, sites, setCameraEnabled, deleteCamera, notify, refresh } = useApp()
  const [adding, setAdding] = useState<string | true | null>(null)
  const [editing, setEditing] = useState<Camera | null>(null)
  const [removing, setRemoving] = useState<Camera | null>(null)
  const [deleting, setDeleting] = useState(false) // двойное нажатие не шлёт второй DELETE
  const [testing, setTesting] = useState<string | null>(null)

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

  const sections = sites.map((s) => ({
    id: s.id, title: s.name, cameras: cameras.filter((c) => c.siteId === s.id),
    extra: <Button variant="ghost" size="sm" onClick={() => setAdding(s.id)}><Plus className="w-4 h-4" /> Камера на этот объект</Button>,
  }))

  return (
    <div>
      <PageHeader
        title="Камеры" subtitle="Какая камера за какой зоной следит, на связи ли она. Нажмите на видео — развернётся на всю вкладку"
        action={<Button size="lg" onClick={() => setAdding(true)}><Plus className="w-5 h-5" /> Добавить камеру</Button>}
      />
      <VideoWall
        cameras={cameras} sections={sections}
        actions={(c) => (
          <>
            <div className="w-full text-[13px] text-muted-foreground break-all">
              {c.demo ? 'Демо-ролик' : <span className="font-mono">{c.address}</span>}{c.hasCredentials && ' · с паролем'}
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(c)}><Pencil className="w-4 h-4" /> Изменить</Button>
            <Button variant="outline" size="sm" onClick={() => void setCameraEnabled(c, !c.enabled)}><Power className="w-4 h-4" /> {c.enabled ? 'Выключить' : 'Включить'}</Button>
            <Button variant="outline" size="sm" disabled={testing === c.id} onClick={() => void test(c)}>
              {testing === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Проверить связь
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Удалить ${c.name}`} onClick={() => setRemoving(c)}><Trash2 className="w-4 h-4" /></Button>
          </>
        )}
      />

      <div className="mt-8 bg-card border border-border rounded-xl p-5 text-[15px] leading-relaxed">
        <b>Как ставить камеры, чтобы система работала хорошо.</b> Камера смотрит на зону работ сверху под углом 30–45°,
        охватывает рабочую зону целиком и не направлена против солнца. На объект — минимум две камеры: рабочая зона и въезд.
        Кадр из видео уходит на анализ каждые 2 секунды, поэтому связь нужна постоянная.
      </div>

      <AddCameraDialog open={adding !== null} defaultSiteId={typeof adding === 'string' ? adding : undefined} onClose={() => setAdding(null)} />
      <EditCameraDialog camera={editing} onClose={() => setEditing(null)} />
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Удалить камеру?">
        {removing && (
          <div className="space-y-5">
            <p>«{removing.name}» перестанет показывать видео и исчезнет из списков. Кадры, которые служат доказательствами в предупреждениях, сохранятся.</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" size="lg" disabled={deleting} onClick={async () => { setDeleting(true); await deleteCamera(removing); setDeleting(false); setRemoving(null) }}>
                {deleting && <Loader2 className="w-5 h-5 animate-spin" />} Удалить
              </Button>
              <Button variant="outline" size="lg" onClick={() => setRemoving(null)}>Отмена</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
