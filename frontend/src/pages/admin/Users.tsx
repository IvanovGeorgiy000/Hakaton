import { useQuery } from '@tanstack/react-query'
import { Phone } from 'lucide-react'
import { api } from '@/api'
import { ROLES } from '@/data'
import { useApp } from '@/store/context'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'

/** Сотрудники и их роли — кто что видит */
export function AdminUsers() {
  const { sites, bySite } = useApp()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  return (
    <div>
      <PageHeader title="Сотрудники" subtitle="Кто и к каким объектам имеет доступ" />
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {ROLES.map((r) => (
          <div key={r.id} className="bg-card rounded-xl border border-border p-4 shadow-[var(--shadow-card)]">
            <div className="font-semibold text-[17px]">{r.title}</div>
            <div className="text-muted-foreground text-[14px]">{r.description}</div>
          </div>
        ))}
      </div>
      {users.isPending && <p className="text-muted-foreground">Загружаем список…</p>}
      {users.isError && <p role="alert" className="text-danger">Не удалось загрузить сотрудников.</p>}
      {users.data && (
        <div className="bg-card rounded-xl border border-border overflow-x-auto shadow-[var(--shadow-card)]">
          <table className="w-full text-[15px] min-w-[720px]">
            <thead className="bg-muted/60 text-left text-[13px] text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">Сотрудник</th><th className="px-4 py-3 font-medium">Логин</th><th className="px-4 py-3 font-medium">Роль</th><th className="px-4 py-3 font-medium">Объекты</th><th className="px-4 py-3 font-medium">Телефон</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-semibold">{u.name}</td>
                  <td className="px-4 py-3 font-mono text-[14px] text-muted-foreground">{u.login}</td>
                  <td className="px-4 py-3"><Badge tone="info">{ROLES.find((r) => r.id === u.role)?.title}</Badge></td>
                  <td className="px-4 py-3 text-[14px]">
                    {u.siteIds.length === 0 ? '—' : u.siteIds.length === sites.length ? 'Все объекты' : u.siteIds.map((id) => bySite(id)?.name).join(', ')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><a href={`tel:${u.phone}`} className="inline-flex items-center gap-1.5 text-primary font-medium min-h-[44px]"><Phone className="w-4 h-4" />{u.phone}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
