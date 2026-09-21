import { CheckCircle2 } from 'lucide-react'

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="mx-auto w-16 h-16 rounded-full bg-ok-bg text-ok flex items-center justify-center mb-4">
        <CheckCircle2 className="w-9 h-9" />
      </div>
      <p className="text-xl font-bold">{title}</p>
      {text && <p className="text-muted-foreground mt-1">{text}</p>}
    </div>
  )
}
