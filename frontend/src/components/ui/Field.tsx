import { useId, type ReactNode } from 'react'

/** Оформление полей ввода (как в образцовом диалоге «Добавить камеру») */
export const inputCls = 'w-full min-h-[46px] rounded-lg border border-border-strong bg-card px-3 text-[16px] outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/15 aria-[invalid=true]:border-danger disabled:opacity-60'

/** Поле формы: подпись над полем, подсказка под ним, ошибка вместо подсказки — всё связано с полем через aria-describedby */
export function Field({ label, hint, error, className, children }: {
  label: string; hint?: string; error?: string; className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const noteId = `${id}-note`
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[15px] font-medium mb-1.5">{label}</label>
      {children(id, error || hint ? noteId : undefined)}
      {error ? <p id={noteId} role="alert" className="text-danger text-[14px] mt-1">{error}</p>
        : hint ? <p id={noteId} className="text-muted-foreground text-[13px] mt-1">{hint}</p> : null}
    </div>
  )
}

/** Итог действия словами: зелёная или красная панель (aria-live объявляет её читалке экрана) */
export function FormError({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message && <p role="alert" className="rounded-xl bg-danger-bg text-danger-fg px-4 py-3 font-medium">{message}</p>}
    </div>
  )
}
