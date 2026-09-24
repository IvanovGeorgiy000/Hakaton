import { PageHeader } from '@/components/ui/PageHeader'
import { EQUIPMENT_LIST } from '@/data'
import { VehicleIcon } from '@/components/VehicleIcon'

const STEPS = [
  ['Камеры показывают видео', 'Видео со всех камер стройки идёт в систему постоянно. Его можно смотреть в разделе «Камеры» — нажмите на камеру, и она развернётся на всю вкладку.'],
  ['Система находит технику', 'Каждые 2 секунды она берёт кадр из видео и находит на нём экскаваторы, самосвалы, краны и другую технику.'],
  ['Сверяет с планом работ', 'Раз в минуту смотрит, какой этап идёт по календарному плану и какая техника для него нужна.'],
  ['Сообщает, если что-то не так', 'Нет нужной техники, приехала лишняя, машина стоит без дела — вы получите сообщение с кадром-доказательством.'],
]

/** Справка: обычный текст, без украшений */
export function Help() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Справка" subtitle="Как работает система и что делать с сообщениями" />

      <Section title="Как это работает">
        <ol className="list-decimal pl-6 space-y-2">
          {STEPS.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}
        </ol>
      </Section>

      <Section title="Что означают цвета">
        <table className="w-full text-[15px]">
          <tbody className="divide-y divide-border">
            <tr><td className="py-2 pr-3 w-32"><span className="inline-block w-2.5 h-2.5 rounded-full bg-ok mr-2" />Зелёный</td><td className="py-2">Всё по плану, делать ничего не нужно.</td></tr>
            <tr><td className="py-2 pr-3"><span className="inline-block w-2.5 h-2.5 rounded-full bg-warn mr-2" />Жёлтый</td><td className="py-2">Есть замечания. Посмотрите, когда будет время.</td></tr>
            <tr><td className="py-2 pr-3"><span className="inline-block w-2.5 h-2.5 rounded-full bg-danger mr-2" />Красный</td><td className="py-2">Нужно вмешаться сейчас: работы стоят или под угрозой качество.</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="Что делать, если пришло сообщение">
        <ol className="list-decimal pl-6 space-y-2">
          <li>Откройте сообщение и посмотрите кадр — на нём обведено, что увидела система. Кнопка «Смотреть камеру сейчас» покажет, что там происходит прямо сейчас.</li>
          <li>Прочитайте раздел «Что делать» — там короткая подсказка.</li>
          <li>Нажмите одну из кнопок: <b>«Техника едет»</b>, <b>«Подтверждаю проблему»</b> или <b>«Это ошибка»</b>. Комментарий писать необязательно.</li>
          <li>Когда проблема решена — нажмите <b>«Устранено»</b>.</li>
        </ol>
      </Section>

      <Section title="Какую технику система узнаёт">
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
          {EQUIPMENT_LIST.map((e) => (
            <li key={e.type} className="flex items-center gap-2">
              <VehicleIcon type={e.type} className="w-10 h-6 shrink-0" fill={e.color} /> {e.name}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] mb-4 p-5 sm:p-6">
      <h2 className="text-[18px] font-semibold mb-3">{title}</h2>
      <div className="leading-relaxed">{children}</div>
    </section>
  )
}
