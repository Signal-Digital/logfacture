import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Badge, Button, Card, Empty, Loading, PageHead, Tabs } from '../components/ui';
import { ActivityFormModal } from '../forms/smallForms';
import { ACTIVITY_TYPES, activityCounts, deleteActivity, listActivities, setActivityStatus, type ActivityFilter, type ActivityRow, type ActivityType } from '@/domain/activities';
import { addDays, formatDate, formatDateTime, parseIsoDate, today, toLocalIsoDate } from '@/lib/format';
import { activityType, priority, PRIORITY_TONE } from '../labels';

type View = 'jour' | 'retard' | 'avenir' | 'ouvertes' | 'semaine' | 'faites';

export function ActivitiesPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('vue') as View) ?? 'jour';
  const [type, setType] = useState<ActivityType | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: counts } = useData((c) => activityCounts(c.db));
  return (
    <>
      <PageHead
        title="Activités et relances"
        subtitle="Appels, emails, rendez-vous, relances, audits, tâches et notes — rappels locaux uniquement (aucun envoi externe)"
        actions={<Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>Nouvelle activité</Button>}
      />
      <Tabs<View>
        value={view}
        onChange={(v) => setParams({ vue: v })}
        tabs={[
          { key: 'jour', label: "Aujourd'hui", count: counts?.today },
          { key: 'retard', label: 'En retard', count: counts?.late },
          { key: 'avenir', label: 'À venir', count: counts?.upcoming7 },
          { key: 'semaine', label: 'Calendrier' },
          { key: 'ouvertes', label: 'Toutes les ouvertes' },
          { key: 'faites', label: 'Terminées' },
        ]}
      />
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`chip ${type === '' ? 'on' : ''}`} onClick={() => setType('')}>Tous</button>
          {ACTIVITY_TYPES.map((t) => <button key={t.key} className={`chip ${type === t.key ? 'on' : ''}`} onClick={() => setType(t.key)}>{t.label}</button>)}
        </div>
      </div>
      {view === 'semaine' ? <WeekView type={type} search={search} /> : <ActivityList filter={{ scope: ({ jour: 'today', retard: 'late', avenir: 'upcoming', ouvertes: 'open', faites: 'done' } as const)[view], type: type || undefined, search }} />}
      {creating && <ActivityFormModal onClose={() => setCreating(false)} />}
    </>
  );
}

export function ActivityList({ filter }: { filter: ActivityFilter }) {
  const { ctx, run, confirm } = useApp();
  const nav = useNavigate();
  const [edit, setEdit] = useState<ActivityRow | null>(null);
  const { data, loading } = useData((c) => listActivities(c.db, filter), [JSON.stringify(filter)]);
  const t = today();
  if (loading && !data) return <Loading />;
  if (!data?.length) {
    return (
      <Card>
        <Empty icon={CalendarCheck} title={filter.scope === 'late' ? 'Aucun retard' : filter.scope === 'today' ? "Rien de prévu aujourd'hui" : 'Aucune activité'} text="Planifiez vos relances depuis une fiche prospect ou client." />
      </Card>
    );
  }
  return (
    <Card pad={false}>
      <table className="table">
        <thead><tr><th style={{ width: 36 }} /><th>Activité</th><th>Entreprise</th><th>Échéance</th><th>Priorité</th><th /></tr></thead>
        <tbody>
          {data.map((a) => {
            const done = a.status === 'fait';
            const late = !done && a.due_at && a.due_at.slice(0, 10) < t;
            return (
              <tr key={a.id}>
                <td><input type="checkbox" checked={done} aria-label="Marquer comme fait" onChange={(e) => run(() => setActivityStatus(ctx.db, a.id, e.target.checked ? 'fait' : 'a_faire'), e.target.checked ? 'Activité terminée' : undefined)} /></td>
                <td>
                  <div className="cell-title" style={{ textDecoration: done ? 'line-through' : undefined }}>{a.title}</div>
                  <div className="cell-sub">{activityType(a.type)}{a.project_name ? ` · Projet : ${a.project_name}` : ''}{a.opportunity_title ? ` · ${a.opportunity_title}` : ''}{a.notes ? ` · ${a.notes.slice(0, 80)}` : ''}</div>
                </td>
                <td>{a.company_id ? <a onClick={() => nav(`/entreprises/${a.company_id}`)} style={{ cursor: 'pointer' }}>{a.company_name}</a> : <span className="subtle">—</span>}{a.contact_name ? <div className="cell-sub">{a.contact_name}</div> : null}</td>
                <td>{a.due_at ? <Badge tone={late ? 'danger' : a.due_at.slice(0, 10) === t ? 'warning' : 'muted'} plain>{done ? `Fait le ${formatDate(a.done_at)}` : formatDateTime(a.due_at)}</Badge> : '—'}</td>
                <td><Badge tone={PRIORITY_TONE[a.priority]} plain>{priority(a.priority)}</Badge></td>
                <td className="num nowrap">
                  {!done && late && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const { updateActivity } = await import('@/domain/activities');
                      run(() => updateActivity(ctx.db, a.id, { due_at: `${addDays(t, 1)}T${a.due_at!.slice(11, 19) || '09:00:00'}` }), 'Reportée à demain');
                    }}>Demain</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(a)} aria-label="Modifier" />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={async () => { if (await confirm({ title: 'Supprimer l\'activité', message: `Supprimer « ${a.title} » ?`, danger: true, confirmLabel: 'Supprimer' })) run(() => deleteActivity(ctx.db, a.id), 'Activité supprimée'); }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && <ActivityFormModal activity={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function WeekView({ type, search }: { type: ActivityType | ''; search: string }) {
  const [start, setStart] = useState(() => {
    const d = parseIsoDate(today())!;
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return toLocalIsoDate(d);
  });
  const end = addDays(start, 6);
  const [edit, setEdit] = useState<ActivityRow | null>(null);
  const [create, setCreate] = useState<string | null>(null);
  const { data } = useData((c) => listActivities(c.db, { scope: 'all', from: start, to: end, type: type || undefined, search }), [start, type, search]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <Card
      title={`Semaine du ${formatDate(start)} au ${formatDate(end)}`}
      actions={
        <>
          <Button size="sm" icon={ChevronLeft} onClick={() => setStart(addDays(start, -7))} aria-label="Semaine précédente" />
          <Button size="sm" onClick={() => { const d = parseIsoDate(today())!; d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); setStart(toLocalIsoDate(d)); }}>Cette semaine</Button>
          <Button size="sm" icon={ChevronRight} onClick={() => setStart(addDays(start, 7))} aria-label="Semaine suivante" />
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
        {days.map((d) => {
          const items = (data ?? []).filter((a) => a.due_at?.slice(0, 10) === d);
          const isToday = d === today();
          return (
            <div key={d} style={{ background: isToday ? 'var(--accent-soft)' : 'var(--surface-2)', borderRadius: 10, padding: 8, minHeight: 220, border: '1px solid var(--border)' }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className="small strong">{parseIsoDate(d)!.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}</span>
                <button className="btn ghost sm icon" onClick={() => setCreate(d)} aria-label="Ajouter"><Plus size={14} /></button>
              </div>
              <div className="col" style={{ gap: 5 }}>
                {items.map((a) => (
                  <div key={a.id} className="kcard" style={{ padding: '6px 8px', cursor: 'pointer', opacity: a.status === 'fait' ? 0.55 : 1 }} onClick={() => setEdit(a)}>
                    <div className="tiny muted">{a.due_at?.slice(11, 16)} · {activityType(a.type)}</div>
                    <div className="small strong" style={{ textDecoration: a.status === 'fait' ? 'line-through' : undefined }}>{a.title}</div>
                    {a.company_name && <div className="tiny muted">{a.company_name}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {edit && <ActivityFormModal activity={edit} onClose={() => setEdit(null)} />}
      {create && <ActivityFormModal preset={{ due_at: `${create}T09:00:00` }} onClose={() => setCreate(null)} />}
    </Card>
  );
}
