import { useId, useState } from 'react'
import { Plus, Minus, Trash2, ChevronDown, Save, Loader2 } from 'lucide-react'
import { EQUIPMENT, EQUIPMENT_LIST, type EquipmentType, type Rule } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { InfoTip } from '@/components/ui/InfoTip'
import { Button } from '@/components/ui/Button'
import { VehicleIcon } from '@/components/VehicleIcon'
import { cn } from '@/lib/utils'

/**
 * Редактор методики «этап → техника».
 * Всё на кнопках «+ / −», без ввода кода и формул.
 */
export function AdminRules() {
  const { rules, saveRule } = useApp()
  const [openKey, setOpenKey] = useState<string | null>('excavation')
  const [saved, setSaved] = useState<string | null>(null)

  // после сохранения сервер сразу пересверяет объекты, где идёт этап с этим правилом
  const save = async (key: string, rule: Rule) => {
    if (await saveRule(rule)) {
      setSaved(key)
      setTimeout(() => setSaved(null), 1800)
    }
  }

  return (
    <div>
      <PageHeader title="Правила: этап → техника" info="По этим правилам система решает, есть ли отклонение: какая техника нужна на этапе, сколько её и какая лишняя. Меняйте цифры кнопками и нажимайте «Сохранить»." />
      <div className="space-y-3">
        {(Object.values(rules) as Rule[]).map((r) => (
          <div key={r.key} className="bg-card rounded-xl border border-border overflow-hidden">
            <button
              type="button" onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
              className="w-full text-left px-4 py-4 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
              aria-expanded={openKey === r.key}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-lg">{r.stageName}</div>
                <div className="text-muted-foreground text-[14px]">{r.description}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {r.required.map((q) => (
                    <span key={q.type} className="inline-flex items-center gap-1 bg-muted rounded-sm pl-1 pr-2.5 py-0.5 text-[13px] font-semibold">
                      <VehicleIcon type={q.type} className="w-6 h-4" fill={EQUIPMENT[q.type].color} /> {EQUIPMENT[q.type].name} ≥{q.min}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronDown className={cn('w-6 h-6 text-muted-foreground transition-transform', openKey === r.key && 'rotate-180')} />
            </button>
              {openKey === r.key && (
                <div className="overflow-hidden">
                  <RuleEditor rule={r} onSave={(nr) => save(r.key, nr)} saved={saved === r.key} />
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RuleEditor({ rule, onSave, saved }: { rule: Rule; onSave: (r: Rule) => Promise<void>; saved: boolean }) {
  const [draft, setDraft] = useState<Rule>(rule)
  const [saving, setSaving] = useState(false)  // двойное нажатие не шлёт правило дважды
  const used = new Set<EquipmentType>([...draft.required.map((r) => r.type), ...draft.unexpected.map((u) => u.type)])
  const free = EQUIPMENT_LIST.filter((e) => !used.has(e.type))

  // пределы те же, что проверяет сервер: иначе «Сохранить» падало бы с невнятной ошибкой
  const setMin = (t: EquipmentType, d: number) => setDraft({ ...draft, required: draft.required.map((r) => r.type === t ? { ...r, min: clamp(r.min + d, 1, MAX_MIN) } : r) })
  const removeReq = (t: EquipmentType) => setDraft({ ...draft, required: draft.required.filter((r) => r.type !== t) })
  const addReq = (t: EquipmentType) => setDraft({ ...draft, required: [...draft.required, { type: t, min: 1, why: 'Добавлено администратором', risk: '' }] })
  const removeUnexp = (t: EquipmentType) => setDraft({ ...draft, unexpected: draft.unexpected.filter((u) => u.type !== t) })
  const addUnexp = (t: EquipmentType) => setDraft({ ...draft, unexpected: [...draft.unexpected, { type: t, why: 'Не предусмотрено этапом', risk: '' }] })

  return (
    <div className="border-t border-border p-4 sm:p-5 grid lg:grid-cols-2 gap-5">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold">Нужная техника</h3>
          <InfoTip label="Что значит «нужная техника»">Если её нет на площадке или меньше, чем указано, — система сообщит.</InfoTip>
        </div>
        <ul className="space-y-2">
          {draft.required.map((r) => (
            <li key={r.type} className="flex items-center gap-3 bg-muted/50 rounded-lg p-2 pr-3">
              <VehicleIcon type={r.type} className="w-12 h-8 shrink-0" fill={EQUIPMENT[r.type].color} />
              <div className="flex-1 min-w-0"><div className="font-semibold">{EQUIPMENT[r.type].name}</div><div className="text-muted-foreground text-[13px] truncate">{r.why}</div></div>
              <div className="flex items-center gap-1">
                <Btn onClick={() => setMin(r.type, -1)} disabled={r.min <= 1} label={`Уменьшить ${EQUIPMENT[r.type].name}`}><Minus className="w-5 h-5" /></Btn>
                <span className="w-10 text-center text-[18px] font-semibold">{r.min}</span>
                <Btn onClick={() => setMin(r.type, 1)} disabled={r.min >= MAX_MIN} label={`Увеличить ${EQUIPMENT[r.type].name}`}><Plus className="w-5 h-5" /></Btn>
              </div>
              <Btn onClick={() => removeReq(r.type)} label="Убрать" danger><Trash2 className="w-5 h-5" /></Btn>
            </li>
          ))}
        </ul>
        <AddPicker free={free} onPick={addReq} label="Добавить нужную технику" />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold">Лишняя техника</h3>
          <InfoTip label="Что значит «лишняя техника»">Если такая техника появится на площадке на этом этапе, — система предупредит.</InfoTip>
        </div>
        <ul className="space-y-2">
          {draft.unexpected.map((u) => (
            <li key={u.type} className="flex items-center gap-3 bg-warn-bg/40 rounded-lg p-2 pr-3">
              <VehicleIcon type={u.type} className="w-12 h-8 shrink-0" fill={EQUIPMENT[u.type].color} />
              <div className="flex-1 min-w-0"><div className="font-semibold">{EQUIPMENT[u.type].name}</div><div className="text-muted-foreground text-[13px] truncate">{u.why}</div></div>
              <Btn onClick={() => removeUnexp(u.type)} label="Убрать" danger><Trash2 className="w-5 h-5" /></Btn>
            </li>
          ))}
        </ul>
        <AddPicker free={free} onPick={addUnexp} label="Добавить лишнюю технику" />
      </section>

      <div className="lg:col-span-2 flex flex-wrap items-center gap-3 pt-2 border-t border-border">
        {/* не <label>: иначе нажатие на подпись срабатывало как «−» и незаметно ослабляло правило */}
        <div role="group" aria-label="Сообщать после скольких проверок подряд" className="flex items-center gap-3">
          <span className="font-semibold">Сообщать после</span>
          <Btn onClick={() => setDraft({ ...draft, confirmAfterSnapshots: clamp(draft.confirmAfterSnapshots - 1, 1, MAX_CONFIRM) })} disabled={draft.confirmAfterSnapshots <= 1} label="Меньше проверок"><Minus className="w-5 h-5" /></Btn>
          <span className="w-8 text-center text-[18px] font-semibold">{draft.confirmAfterSnapshots}</span>
          <Btn onClick={() => setDraft({ ...draft, confirmAfterSnapshots: clamp(draft.confirmAfterSnapshots + 1, 1, MAX_CONFIRM) })} disabled={draft.confirmAfterSnapshots >= MAX_CONFIRM} label="Больше проверок"><Plus className="w-5 h-5" /></Btn>
          <span className="text-muted-foreground">проверок подряд</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-ok font-semibold">Сохранено</span>}
          <Button size="lg" disabled={saving} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false) }}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}

const MAX_MIN = 50 // не больше 50 единиц одного типа техники
const MAX_CONFIRM = 24 // не больше 24 проверок подряд
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function Btn({ onClick, label, danger, disabled, children }: { onClick: () => void; label: string; danger?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn('w-11 h-11 rounded-lg border flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed', danger ? 'border-transparent text-danger hover:bg-danger-bg' : 'border-border bg-card enabled:hover:border-primary enabled:hover:text-primary')}>
      {children}
    </button>
  )
}

function AddPicker({ free, onPick, label }: { free: { type: EquipmentType; name: string }[]; onPick: (t: EquipmentType) => void; label: string }) {
  const id = useId()
  if (!free.length) return null
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-[14px] font-semibold mb-1">{label}</label>
      <select
        id={id} className="w-full min-h-[48px] rounded-lg border border-border bg-card px-3 text-[16px]"
        value="" onChange={(e) => e.target.value && onPick(e.target.value as EquipmentType)}
      >
        <option value="">Выберите технику…</option>
        {free.map((e) => <option key={e.type} value={e.type}>{e.name}</option>)}
      </select>
    </div>
  )
}
