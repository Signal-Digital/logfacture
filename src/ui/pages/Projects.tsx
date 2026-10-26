import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, FolderKanban, Pencil, Plus, Receipt, Search, FileSignature } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Badge, Button, Card, Empty, Field, Kpi, Loading, Modal, PageHead, Progress, Tabs } from '../components/ui';
import { CompanyPicker, DateInput, MoneyInput } from '../components/inputs';
import { ActivityFormModal } from '../forms/smallForms';
import { ActivitiesTab } from './CompanyDetail';
import { AttachmentsCard } from './Documents';
import { HistoryCard } from './Quotes';
import { archiveProject, createProject, getProject, listProjectStatuses, listProjectTemplates, listProjects, updateProject, type Project, type ProjectInput } from '@/domain/projects';
import { listQuotes } from '@/domain/quotes';
import { listInvoices } from '@/domain/invoices';
import { getCompany } from '@/domain/companies';
import { formatDate, formatEuro, today } from '@/lib/format';
import { invoiceStatus, quoteStatus } from '../labels';

export function ProjectsPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusId, setStatusId] = useState<number | ''>('');
  const [scope, setScope] = useState<'actifs' | 'tous' | 'archives'>('actifs');
  const [creating, setCreating] = useState(!!params.get('nouveau'));
  const { data: statuses } = useData((c) => listProjectStatuses(c.db));
  const { data, loading } = useData((c) => listProjects(c.db, { search, statusId: statusId || undefined, activeOnly: scope === 'actifs', archived: scope === 'archives' }), [search, statusId, scope]);
  return (
    <>
      <PageHead title="Projets et tâches" subtitle="Suivi de la production des prestations vendues" actions={<Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>Nouveau projet</Button>} />
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Projet ou client…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 220 }} value={statusId} onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : '')} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {statuses?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="btn-group">
          {(['actifs', 'tous', 'archives'] as const).map((s) => <button key={s} className={`btn sm ${scope === s ? 'on' : ''}`} onClick={() => setScope(s)}>{s === 'actifs' ? 'En cours' : s === 'tous' ? 'Tous' : 'Archivés'}</button>)}
        </div>
      </div>
      {loading && !data ? <Loading /> : !data?.length ? (
        <Card><Empty icon={FolderKanban} title="Aucun projet" text="Un projet peut être créé automatiquement lorsqu'un devis est accepté ou qu'une opportunité est gagnée." action={<Button variant="primary" onClick={() => setCreating(true)}>Créer un projet</Button>} /></Card>
      ) : (
        <div className="grid-3">
          {data.map((p) => {
            const pct = p.tasks_total ? (p.tasks_done / p.tasks_total) * 100 : 0;
            const late = p.due_date && p.due_date < today() && !p.status_closed;
            return (
              <div key={p.id} className="card card-pad col" style={{ cursor: 'pointer', gap: 10 }} onClick={() => nav(`/projets/${p.id}`)}>
                <div className="row between top">
                  <div>
                    <div className="strong">{p.name}</div>
                    <div className="muted small">{p.company_name}{p.service_type ? ` · ${p.service_type}` : ''}</div>
                  </div>
                  <span className="badge plain" style={{ background: `${p.status_color}22`, color: p.status_color ?? undefined }}>{p.status_name}</span>
                </div>
                <Progress value={pct} />
                <div className="row between small">
                  <span className="muted">{p.tasks_done}/{p.tasks_total} tâches{p.tasks_late ? <span style={{ color: 'var(--danger)' }}> · {p.tasks_late} en retard</span> : null}</span>
                  <span className={late ? 'strong' : 'muted'} style={{ color: late ? 'var(--danger)' : undefined }}>{p.due_date ? `Échéance ${formatDate(p.due_date)}` : ''}</span>
                </div>
                <div className="row between small">
                  <span className="muted">Montant : <span className="strong" style={{ color: 'var(--text)' }}>{formatEuro(p.contract_amount_cents)} HT</span></span>
                  <span className="muted">Facturé : {formatEuro(p.invoiced_cents)} TTC</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating && <ProjectModal presetCompany={Number(params.get('entreprise')) || null} onClose={() => { setCreating(false); if (params.get('nouveau')) setParams({}); }} />}
    </>
  );
}

function ProjectModal({ project, presetCompany, onClose }: { project?: Project; presetCompany?: number | null; onClose: () => void }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const { data: statuses } = useData((c) => listProjectStatuses(c.db));
  const { data: templates } = useData((c) => listProjectTemplates(c.db));
  const [f, setF] = useState<ProjectInput>(project ? { ...project } : { company_id: presetCompany ?? 0, name: '', start_date: today(), contract_amount_cents: 0 });
  const set = (k: keyof ProjectInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const id = await run(async () => {
      if (project) {
        await updateProject(ctx.db, project.id, f);
        return project.id;
      }
      return createProject(ctx.db, f);
    }, 'Projet enregistré');
    if (id) {
      onClose();
      if (!project) nav(`/projets/${id}`);
    }
  };
  return (
    <Modal title={project ? 'Modifier le projet' : 'Nouveau projet'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        <Field label="Nom du projet" required className="span-2"><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Client" required className="span-2"><CompanyPicker value={f.company_id || null} onChange={(id) => set('company_id', id ?? 0)} /></Field>
        <Field label="Type de prestation"><input className="input" value={f.service_type ?? ''} onChange={(e) => set('service_type', e.target.value)} placeholder="Site Internet, SEO…" /></Field>
        <Field label="Statut">
          <select className="input" value={f.status_id ?? ''} onChange={(e) => set('status_id', e.target.value ? Number(e.target.value) : null)}>
            {!project && <option value="">Premier statut</option>}
            {statuses?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Date de début"><DateInput value={f.start_date} onChange={(v) => set('start_date', v)} /></Field>
        <Field label="Date de fin prévue"><DateInput value={f.due_date} onChange={(v) => set('due_date', v)} /></Field>
        <Field label="Montant contractuel HT"><MoneyInput value={f.contract_amount_cents ?? 0} onChange={(v) => set('contract_amount_cents', v)} /></Field>
        {!project && (
          <Field label="Modèle de projet (tâches prédéfinies)">
            <select className="input" value={f.template_id ?? ''} onChange={(e) => set('template_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sans modèle</option>
              {templates?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.tasks.length} tâches)</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes" className="span-2"><textarea className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

type Tab = 'taches' | 'documents' | 'facturation' | 'historique';

export function ProjectDetail() {
  const id = Number(useParams().id);
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('taches');
  const [edit, setEdit] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const { data: p, loading } = useData((c) => getProject(c.db, id), [id]);
  const { data: row } = useData(async (c) => (await listProjects(c.db, { archived: false })).concat(await listProjects(c.db, { archived: true })).find((x) => x.id === id), [id]);
  const { data: statuses } = useData((c) => listProjectStatuses(c.db));
  const { data: company } = useData((c) => (p ? getCompany(c.db, p.company_id) : Promise.resolve(undefined)), [p?.company_id]);
  const { data: quotes } = useData((c) => listQuotes(c.db, { projectId: id }), [id]);
  const { data: invoices } = useData((c) => listInvoices(c.db, { projectId: id }), [id]);
  if (loading && !p) return <Loading />;
  if (!p) return <Empty icon={FolderKanban} title="Projet introuvable" />;
  return (
    <>
      <PageHead
        breadcrumb={<><Link to="/projets">Projets</Link> / {p.name}</>}
        title={p.name}
        subtitle={<span><Link to={`/entreprises/${p.company_id}`}>{company?.name}</Link>{p.service_type ? ` · ${p.service_type}` : ''}{p.start_date ? ` · démarré le ${formatDate(p.start_date)}` : ''}</span>}
        actions={
          <>
            <select className="input" style={{ width: 220 }} value={p.status_id ?? ''} onChange={(e) => run(() => updateProject(ctx.db, p.id, { status_id: Number(e.target.value) }), 'Statut mis à jour')} aria-label="Statut du projet">
              {statuses?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button icon={Pencil} onClick={() => setEdit(true)}>Modifier</Button>
            <Button icon={FileSignature} onClick={() => nav(`/devis/nouveau?entreprise=${p.company_id}`)}>Devis</Button>
            <Button icon={Receipt} onClick={() => nav(`/factures/nouvelle?entreprise=${p.company_id}`)}>Facture</Button>
            <Button icon={p.archived_at ? ArchiveRestore : Archive} variant="ghost" onClick={() => run(() => archiveProject(ctx.db, p.id, !p.archived_at), p.archived_at ? 'Projet restauré' : 'Projet archivé')}>{p.archived_at ? 'Restaurer' : 'Archiver'}</Button>
          </>
        }
      />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Avancement" value={`${row ? Math.round((row.tasks_done / Math.max(1, row.tasks_total)) * 100) : 0} %`} hint={row ? `${row.tasks_done}/${row.tasks_total} tâches` : ''} />
        <Kpi label="Échéance" value={formatDate(p.due_date) || '—'} hint={row?.tasks_late ? `${row.tasks_late} tâche(s) en retard` : undefined} tone={row?.tasks_late ? 'danger' : undefined} />
        <Kpi label="Montant contractuel" value={formatEuro(p.contract_amount_cents)} hint="HT" />
        <Kpi label="Facturé" value={formatEuro(row?.invoiced_cents ?? 0)} hint="TTC, avoirs déduits" tone="success" />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'taches', label: 'Tâches et échéances' }, { key: 'facturation', label: 'Devis et factures' }, { key: 'documents', label: 'Fichiers' }, { key: 'historique', label: 'Historique' }]} />
      {tab === 'taches' && (
        <div className="grid-3">
          <div className="span-2"><ActivitiesTab projectId={p.id} onNew={() => setNewTask(true)} /></div>
          <Card title="Notes">{p.notes ? <p className="pre small">{p.notes}</p> : <span className="muted small">Aucune note.</span>}</Card>
        </div>
      )}
      {tab === 'facturation' && (
        <div className="grid-2">
          <Card pad={false} title="Devis associés">
            {!quotes?.length && !p.quote_id ? <Empty icon={FileSignature} title="Aucun devis lié" /> : (
              <table className="table"><tbody>{quotes?.map((q) => <tr key={q.id} className="clickable" onClick={() => nav(`/devis/${q.id}`)}><td className="cell-title">{q.number}</td><td><Badge tone={quoteStatus(q.status).tone}>{quoteStatus(q.status).label}</Badge></td><td className="num">{formatEuro(q.total_ht_cents)} HT</td></tr>)}</tbody></table>
            )}
          </Card>
          <Card pad={false} title="Factures associées">
            {!invoices?.length ? <Empty icon={Receipt} title="Aucune facture liée" /> : (
              <table className="table"><tbody>{invoices.map((i) => <tr key={i.id} className="clickable" onClick={() => nav(`/factures/${i.id}`)}><td className="cell-title">{i.number ?? 'Brouillon'}</td><td><Badge tone={invoiceStatus(i.display_status).tone}>{invoiceStatus(i.display_status).label}</Badge></td><td className="num">{formatEuro(i.total_ttc_cents)} TTC</td></tr>)}</tbody></table>
            )}
          </Card>
        </div>
      )}
      {tab === 'documents' && <AttachmentsCard projectId={p.id} companyId={p.company_id} />}
      {tab === 'historique' && <HistoryCard entity="projet" id={p.id} />}
      {edit && <ProjectModal project={p} onClose={() => setEdit(false)} />}
      {newTask && <ActivityFormModal preset={{ project_id: p.id, company_id: p.company_id, type: 'tache', title: '' }} onClose={() => setNewTask(false)} />}
    </>
  );
}
