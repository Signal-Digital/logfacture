import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, CalendarPlus, FileSignature, KanbanSquare, Pencil, Plus, Search, Settings2, Trophy } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Badge, Button, Empty, Field, Loading, Modal, PageHead } from '../components/ui';
import { ActivityFormModal, OpportunityFormModal } from '../forms/smallForms';
import { archiveOpportunity, confirmWon, listOpportunities, listStages, moveOpportunity, pipelineSummary, type OpportunityRow } from '@/domain/pipeline';
import { listProjectTemplates } from '@/domain/projects';
import { formatDate, formatEuro, today } from '@/lib/format';

export function PipelinePage() {
  const { ctx, run, confirm } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const { data: stages } = useData((c) => listStages(c.db));
  const { data: opps } = useData((c) => listOpportunities(c.db, { search }), [search]);
  const { data: summary } = useData((c) => pipelineSummary(c.db));
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ stage: number; before: number | null } | null>(null);
  const [creating, setCreating] = useState<number | null | undefined>(undefined);
  const [won, setWon] = useState<OpportunityRow | null>(null);
  const [detail, setDetail] = useState<OpportunityRow | null>(null);
  const [edit, setEdit] = useState<OpportunityRow | null>(null);
  const [activityFor, setActivityFor] = useState<OpportunityRow | null>(null);

  useEffect(() => {
    const id = Number(params.get('opportunite'));
    if (id && opps) {
      const o = opps.find((x) => x.id === id);
      if (o) setDetail(o);
    }
  }, [params, opps]);

  const drop = async (stageId: number, beforeId: number | null) => {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id) return;
    const opp = opps?.find((o) => o.id === id);
    const r = await run(() => moveOpportunity(ctx.db, id, stageId, beforeId));
    if (r?.won && opp) setWon(opp);
    if (r?.lost && opp) {
      const reason = await confirm({ title: 'Opportunité perdue', message: `Pourquoi « ${opp.title} » est-elle perdue ? (facultatif)`, input: { label: 'Motif', placeholder: 'Budget, concurrent, pas de réponse…' }, confirmLabel: 'Enregistrer' });
      if (reason) {
        const { updateOpportunity } = await import('@/domain/pipeline');
        await run(() => updateOpportunity(ctx.db, id, { lost_reason: reason }));
      }
    }
  };

  return (
    <>
      <PageHead
        title="Pipeline commercial"
        subtitle={summary ? `${summary.open_count} opportunité(s) ouverte(s) · ${formatEuro(summary.total_cents)} HT au total · ${formatEuro(summary.weighted_cents)} HT pondéré (prévisionnel)` : ''}
        actions={
          <>
            <div className="search">
              <Search />
              <input className="input" style={{ width: 220 }} placeholder="Filtrer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button icon={Settings2} onClick={() => nav('/parametres/pipeline')}>Étapes</Button>
            <Button variant="accent" icon={Plus} onClick={() => setCreating(null)}>Nouvelle opportunité</Button>
          </>
        }
      />
      {!stages || !opps ? <Loading /> : stages.length === 0 ? (
        <Empty icon={KanbanSquare} title="Aucune étape configurée" action={<Button onClick={() => nav('/parametres/pipeline')}>Configurer</Button>} />
      ) : (
        <div className="kanban">
          {stages.map((s) => {
            const cards = opps.filter((o) => o.stage_id === s.id);
            const total = cards.reduce((a, o) => a + o.amount_cents, 0);
            return (
              <div
                key={s.id}
                className={`kanban-col ${over?.stage === s.id ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (over?.stage !== s.id || over.before !== null) {
                    if ((e.target as HTMLElement).closest('.kcard') == null) setOver({ stage: s.id, before: null });
                  }
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(s.id, over?.stage === s.id ? over.before : null);
                }}
              >
                <div className="kanban-col-head">
                  <div className="t"><span className="dot" style={{ background: s.color }} />{s.name}<span className="muted small" style={{ marginLeft: 'auto' }}>{cards.length}</span></div>
                  <div className="muted tiny">{formatEuro(total)} HT{s.kind === 'open' ? ` · ${s.default_probability} %` : ''}</div>
                </div>
                <div className="kanban-col-body">
                  {cards.map((o) => (
                    <div key={o.id}>
                      {over?.stage === s.id && over.before === o.id && dragId !== o.id && <div className="drop-marker" />}
                      <div
                        className={`kcard ${dragId === o.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(o.id));
                          setDragId(o.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (over?.before !== o.id) setOver({ stage: s.id, before: o.id });
                        }}
                        onClick={() => setDetail(o)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setDetail(o)}
                        aria-label={`${o.title}, ${o.company_name}`}
                      >
                        <div className="t">{o.title}</div>
                        <div className="c">{o.company_name}{o.contact_name ? ` · ${o.contact_name}` : ''}</div>
                        <div className="foot">
                          <span className="strong">{formatEuro(o.amount_cents)}</span>
                          <span className="row" style={{ gap: 6 }}>
                            {o.open_tasks > 0 && <Badge tone="warning" plain>{o.open_tasks} tâche(s)</Badge>}
                            {o.expected_close_date && <span className={`tiny ${o.expected_close_date < today() && o.status === 'open' ? '' : 'muted'}`} style={{ color: o.expected_close_date < today() && o.status === 'open' ? 'var(--danger)' : undefined }}>{formatDate(o.expected_close_date)}</span>}
                            <span className="muted tiny">{o.probability} %</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {over?.stage === s.id && over.before === null && dragId && <div className="drop-marker" />}
                  {s.kind === 'open' && (
                    <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => setCreating(s.id)}><Plus size={14} /> Ajouter</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating !== undefined && <OpportunityFormModal preset={creating ? { stage_id: creating } : undefined} onClose={() => setCreating(undefined)} />}
      {won && <WonModal opp={won} onClose={() => setWon(null)} />}
      {edit && <OpportunityFormModal opportunity={edit} onClose={() => setEdit(null)} />}
      {activityFor && <ActivityFormModal preset={{ company_id: activityFor.company_id, opportunity_id: activityFor.id, type: 'relance', title: `Relance — ${activityFor.title}` }} onClose={() => setActivityFor(null)} />}
      {detail && (
        <Modal
          title={detail.title}
          subtitle={detail.company_name}
          onClose={() => { setDetail(null); if (params.get('opportunite')) setParams({}); }}
          footer={
            <>
              <Button icon={Archive} variant="ghost" onClick={async () => { if (await confirm({ title: 'Archiver l\'opportunité', message: 'Elle disparaîtra du pipeline (historique conservé).' })) { await run(() => archiveOpportunity(ctx.db, detail.id), 'Opportunité archivée'); setDetail(null); } }}>Archiver</Button>
              <div className="grow" />
              <Button icon={CalendarPlus} onClick={() => { setActivityFor(detail); setDetail(null); }}>Planifier une tâche</Button>
              <Button icon={Pencil} onClick={() => { setEdit(detail); setDetail(null); }}>Modifier</Button>
              <Button variant="primary" icon={FileSignature} onClick={() => nav(`/devis/nouveau?entreprise=${detail.company_id}&opportunite=${detail.id}`)}>Créer un devis</Button>
            </>
          }
        >
          <dl className="dl">
            <dt>Entreprise</dt><dd><a href={`#/entreprises/${detail.company_id}`}>{detail.company_name}</a></dd>
            <dt>Contact</dt><dd>{detail.contact_name || '—'}</dd>
            <dt>Montant estimé</dt><dd className="strong">{formatEuro(detail.amount_cents)} HT</dd>
            <dt>Probabilité</dt><dd>{detail.probability} % (pondéré : {formatEuro(Math.round((detail.amount_cents * detail.probability) / 100))})</dd>
            <dt>Clôture estimée</dt><dd>{formatDate(detail.expected_close_date) || '—'}</dd>
            <dt>Statut</dt><dd>{detail.status === 'won' ? 'Gagnée' : detail.status === 'lost' ? `Perdue${detail.lost_reason ? ' — ' + detail.lost_reason : ''}` : 'En cours'}</dd>
            <dt>Tâches ouvertes</dt><dd>{detail.open_tasks}</dd>
            <dt>Devis associés</dt><dd>{detail.quotes_count ? <a href={`#/devis?opportunite=${detail.id}`}>{detail.quotes_count} devis</a> : 'Aucun'}</dd>
            <dt>Notes</dt><dd className="pre">{detail.notes || '—'}</dd>
          </dl>
        </Modal>
      )}
    </>
  );
}

function WonModal({ opp, onClose }: { opp: OpportunityRow; onClose: () => void }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const { data: templates } = useData((c) => listProjectTemplates(c.db));
  const [createProject, setCreateProject] = useState(true);
  const [name, setName] = useState(opp.title);
  const [tpl, setTpl] = useState<number | ''>('');
  const go = async () => {
    const r = await run(() => confirmWon(ctx.db, opp.id, { createProject, projectName: name, templateId: tpl || null }), opp.company_kind === 'client' ? 'Opportunité gagnée' : `${opp.company_name} est maintenant client`);
    onClose();
    if (r?.projectId) nav(`/projets/${r.projectId}`);
  };
  return (
    <Modal
      title={<span className="row"><Trophy color="var(--success)" /> Opportunité gagnée !</span>}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Plus tard</Button><Button variant="primary" onClick={go}>Confirmer</Button></>}
    >
      <div className="col">
        <p>« {opp.title} » est gagnée. Confirmez les actions à effectuer :</p>
        {opp.company_kind !== 'client' && <div className="alert success">« {opp.company_name} » deviendra client (même fiche, historique conservé).</div>}
        <label className="check"><input type="checkbox" checked={createProject} onChange={(e) => setCreateProject(e.target.checked)} /> Créer le projet correspondant</label>
        {createProject && (
          <div className="form-grid">
            <Field label="Nom du projet" className="span-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Modèle de projet (tâches prédéfinies)" className="span-2">
              <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Sans modèle</option>
                {templates?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.tasks.length} tâches)</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
