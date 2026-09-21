import { Phone } from 'lucide-react'
import { ROLES, SITES, USERS } from '@/data'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'

/** Сотрудники и их роли — кто что видит */
export function AdminUsers() {
  return (
    <div>
      <PageHeader title="Сотрудники" subtitle="Кто и к каким объектам имеет доступ" />
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {ROLES.map((r) => (
          <div key={r.id} className="bg-card rounded-xl border border-border p-4">
            <div className="font-semibold text-lg">{r.title}</div>
            <div className="text-muted-foreground text-[14px]">{r.description}</div>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-[15px] min-w-[640px]">
          <thead className="bg-muted/60 text-left text-[13px] text-muted-foreground">
            <tr><th className="px-4 py-3">Сотрудник</th><th className="px-4 py-3">Роль</th><th className="px-4 py-3">Объекты</th><th className="px-4 py-3">Телефон</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {USERS.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-semibold">{u.name}</td>
                <td className="px-4 py-3"><Badge tone="info">{ROLES.find((r) => r.id === u.role)?.title}</Badge></td>
                <td className="px-4 py-3 text-[14px]">{u.siteIds.length === SITES.length ? 'Все объекты' : u.siteIds.length ? u.siteIds.map((id) => SITES.find((s) => s.id === id)?.name).join(', ') : '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><a href={`tel:${u.phone}`} className="inline-flex items-center gap-1.5 text-primary font-semibold min-h-[44px]"><Phone className="w-4 h-4" />{u.phone}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
