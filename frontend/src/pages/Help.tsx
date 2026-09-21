import { Camera, ScanSearch, CalendarCheck, BellRing } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { EQUIPMENT_LIST } from '@/data'
import { VehicleIcon } from '@/components/VehicleIcon'

const STEPS = [
  { Icon: Camera, title: '1. Камеры делают снимки', text: 'Каждый час камеры на стройке присылают снимок в систему. Ничего нажимать не нужно.' },
  { Icon: ScanSearch, title: '2. Система находит технику', text: 'На снимке она обводит рамкой экскаваторы, самосвалы, краны и другую технику.' },
  { Icon: CalendarCheck, title: '3. Сверяет с планом работ', text: 'Смотрит, какой этап идёт по календарному плану, и какая техника для него нужна.' },
  { Icon: BellRing, title: '4. Сообщает, если что-то не так', text: 'Нет нужной техники, приехала лишняя, машина стоит без дела — вы получите понятное сообщение и снимок.' },
]

export function Help() {
  return (
    <div>
      <PageHeader title="Как это работает" subtitle="Коротко и без сложных слов" />
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {STEPS.map((s) => (
          <Card key={s.title}>
            <CardBody className="flex gap-4">
              <span className="shrink-0 w-14 h-14 rounded-xl bg-info-bg text-primary flex items-center justify-center"><s.Icon className="w-8 h-8" /></span>
              <div>
                <h2 className="font-bold text-lg">{s.title}</h2>
                <p className="text-muted-foreground mt-1">{s.text}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <h2 className="text-xl font-bold mb-3">Что означают цвета</h2>
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        <div className="rounded-xl bg-ok-bg text-ok-fg p-4"><b className="text-lg">Зелёный</b><br />Всё по плану, делать ничего не нужно.</div>
        <div className="rounded-xl bg-warn-bg text-warn-fg p-4"><b className="text-lg">Жёлтый</b><br />Есть замечания. Посмотрите, когда будет время.</div>
        <div className="rounded-xl bg-danger-bg text-danger-fg p-4"><b className="text-lg">Красный</b><br />Нужно вмешаться сейчас: работы стоят или под угрозой качество.</div>
      </div>

      <h2 className="text-xl font-bold mb-3">Какую технику система узнаёт</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {EQUIPMENT_LIST.map((e) => (
          <Card key={e.type}><CardBody className="flex items-center gap-3 p-3">
            <VehicleIcon type={e.type} className="w-14 h-9 shrink-0" fill={e.color} />
            <span className="font-semibold">{e.name}</span>
          </CardBody></Card>
        ))}
      </div>

      <h2 className="text-xl font-bold mb-3">Что делать, если пришло сообщение</h2>
      <Card><CardBody>
        <ol className="list-decimal pl-6 space-y-2 text-[16px]">
          <li>Откройте сообщение и посмотрите снимок — на нём обведено, что увидела система.</li>
          <li>Прочитайте «Что делать» — там короткая подсказка.</li>
          <li>Нажмите одну из кнопок: <b>«Техника едет»</b>, <b>«Подтверждаю проблему»</b> или <b>«Это ошибка»</b>. Комментарий писать необязательно.</li>
          <li>Когда проблема решена — нажмите <b>«Устранено»</b>.</li>
        </ol>
      </CardBody></Card>
    </div>
  )
}
