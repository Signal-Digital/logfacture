import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, Briefcase, CalendarPlus, CheckCircle2, ExternalLink, FileSignature, Globe, Mail, MapPin, MessageSquarePlus, Pencil, Phone,
  Plus, Receipt, Star, UserPlus, Users, Activity, FileText, Repeat, FolderKanban, History,
} from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Avatar, Badge, Button, Card, Dropdown, Empty, Kpi, Loading, PageHead, Tabs } from '../components/ui';
import { CompanyFormModal } from '../forms/CompanyForm';
import { ActivityFormModal, ContactFormModal, OpportunityFormModal } from '../forms/smallForms';
import { EmailComposer } from '../forms/EmailComposer';
import {
  archiveCompany, archiveContact, clientFinancials, companyTimeline, contactFullName, convertToClient, getCompany, listContacts, setCompanyKind,
} from '@/domain/companies';
import { listActivities, setActivityStatus } from '@/domain/activities';
import { listOpportunities } from '@/domain/pipeline';
import { listQuotes } from '@/domain/quotes';
import { listInvoices, listPayments } from '@/domain/invoices';
import { listProjects } from '@/domain/projects';
import { listContracts } from '@/domain/contracts';
import { listDocuments } from '@/domain/documents';
import { formatDate, formatDateTime, formatEuro, today } from '@/lib/format';
import { KIND_LABEL, KIND_TONE, activityType, commercialStatus, contractStatus, invoiceKind, invoiceStatus, periodicity, quoteStatus, PAYMENT_LABEL, PRIORITY_TONE, priority } from '../labels';

type TabKey = 'apercu' | 'contacts' | 'activites' | 'opportunites' | 'devis' | 'factures' | 'paiements' | 'projets' | 'contrats' | 'documents';

export function CompanyDetail() {
  const id = Number(useParams().id);
  const { ctx, run, confirm } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<TabKey>('apercu');
  const [modal, setModal] = useState<null | 'edit' | 'contact' | 'activite' | 'note' | 'opportunite' | 'email'>(null);
  const { data: c, loading } = useData((x) => getCompany(x.db, id), [id]);
  const { data: fin } = useData((x) => clientFinancials(x.db, id), [id]);
  const { data: contacts } = useData((x) => listContacts(x.db, { companyId: id }), [id]);
  const { data: counts } = useData(async (x) => ({
    acts: (await listActivities(x.db, { companyId: id, scope: 'open' })).length,
    opps: (await listOpportunities(x.db, { companyId: id })).length,
    quotes: (await listQuotes(x.db, { companyId: id })).length,
    invoices: (await listInvoices(x.db, { companyId: id })).length,
    projects: (await listProjects(x.db, { companyId: id })).length,
    contracts: (await listContracts(x.db, { companyId: id })).length,
    docs: (await listDocuments(x.db, { companyId: id })).length,
  }), [id]);

  if (loading && !c) return <Loading />;
  if (!c) return <Empty icon={Users} title="Fiche introuvable" action={<Button onClick={() => nav('/entreprises')}>Retour</Button>} />;
  const primary = contacts?.find((k) => k.is_primary) ?? contacts?.[0] ?? null;

  return (
    <>
      <PageHead
        breadcrumb={<><Link to={c.kind === 'client' ? '/clients' : c.kind === 'prospect' ? '/prospects' : '/entreprises'}>{c.kind === 'client' ? 'Clients' : c.kind === 'prospect' ? 'Prospects' : 'Entreprises'}</Link> / {c.name}</>}
        title={
          <span className="row">
            <Avatar name={c.name} size="lg" />
            <span className="col" style={{ gap: 4 }}>
              <span>{c.name}</span>
              <span className="row" style={{ gap: 6 }}>
                <Badge tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Badge>
                <Badge tone="muted" plain>{commercialStatus(c.commercial_status)}</Badge>
                {c.archived_at && <Badge tone="warning">Archivée</Badge>}
                {c.merged_into_id && <Badge tone="danger">Fusionnée</Badge>}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            <Button icon={Pencil} onClick={() => setModal('edit')}>Modifier</Button>
            <Button icon={Mail} onClick={() => setModal('email')}>Email</Button>
            <Button icon={CalendarPlus} onClick={() => setModal('activite')}>Relance</Button>
            <Dropdown align="right" trigger={(open) => <Button variant="accent" icon={Plus} onClick={open}>Créer</Button>}>
              {(close) => (
                <>
                  <button onClick={() => { close(); nav(`/devis/nouveau?entreprise=${c.id}`); }}><FileSignature /> Devis</button>
                  <button onClick={() => { close(); nav(`/factures/nouvelle?entreprise=${c.id}`); }}><Receipt /> Facture</button>
                  <button onClick={() => { close(); setModal('opportunite'); }}><Briefcase /> Opportunité</button>
                  <button onClick={() => { close(); nav(`/projets?nouveau=1&entreprise=${c.id}`); }}><FolderKanban /> Projet</button>
                  <button onClick={() => { close(); nav(`/contrats?nouveau=1&entreprise=${c.id}`); }}><Repeat /> Contrat récurrent</button>
                  <div className="sep" />
                  <button onClick={() => { close(); setModal('note'); }}><MessageSquarePlus /> Note</button>
                  <button onClick={() => { close(); setModal('contact'); }}><UserPlus /> Contact</button>
                </>
              )}
            </Dropdown>
            <Dropdown align="right" trigger={(open) => <Button onClick={open}>…</Button>}>
              {(close) => (
                <>
                  {c.kind !== 'client' && (
                    <button onClick={async () => { close(); if (await confirm({ title: 'Convertir en client', message: `« ${c.name} » deviendra un client. La fiche et tout son historique sont conservés (aucune duplication).`, confirmLabel: 'Convertir' })) run(() => convertToClient(ctx.db, c.id), 'Fiche convertie en client'); }}><Star /> Convertir en client</button>
                  )}
                  {c.kind === 'client' && <button onClick={() => { close(); run(() => setCompanyKind(ctx.db, c.id, 'ancien_client'), 'Marqué comme ancien client'); }}><History /> Marquer « ancien client »</button>}
                  {c.kind !== 'partenaire' && <button onClick={() => { close(); run(() => setCompanyKind(ctx.db, c.id, 'partenaire')); }}><Users /> Marquer « partenaire »</button>}
                  <div className="sep" />
                  {c.archived_at ? (
                    <button onClick={() => { close(); run(() => archiveCompany(ctx.db, c.id, false), 'Fiche restaurée'); }}><ArchiveRestore /> Désarchiver</button>
                  ) : (
                    <button onClick={async () => { close(); if (await confirm({ title: 'Archiver la fiche', message: 'La fiche n\'apparaîtra plus dans les listes. Son historique, ses devis, factures et documents sont conservés et restent consultables.', confirmLabel: 'Archiver' })) run(() => archiveCompany(ctx.db, c.id), 'Fiche archivée'); }}><Archive /> Archiver</button>
                  )}
                </>
              )}
            </Dropdown>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: 18 }}>
        <Kpi label="Facturé (TTC)" value={formatEuro((fin?.invoiced_cents ?? 0) - (fin?.credited_cents ?? 0))} hint={fin?.credited_cents ? `dont avoirs : -${formatEuro(fin.credited_cents)}` : 'Avoirs déduits'} icon={Receipt} />
        <Kpi label="Encaissé" value={formatEuro(fin?.paid_cents ?? 0)} icon={CheckCircle2} tone="success" />
        <Kpi label="Solde restant dû" value={formatEuro(fin?.due_cents ?? 0)} hint={fin?.overdue_cents ? `${formatEuro(fin.overdue_cents)} en retard` : undefined} icon={Receipt} tone={fin?.overdue_cents ? 'danger' : 'warning'} />
        <Kpi label="Devis acceptés (HT)" value={formatEuro(fin?.quotes_accepted_cents ?? 0)} hint={`${fin?.quotes_count ?? 0} devis au total`} icon={FileSignature} tone="info" />
      </div>

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'apercu', label: 'Aperçu et chronologie' },
          { key: 'contacts', label: 'Contacts', count: contacts?.length },
          { key: 'activites', label: 'Activités', count: counts?.acts },
          { key: 'opportunites', label: 'Opportunités', count: counts?.opps },
          { key: 'devis', label: 'Devis', count: counts?.quotes },
          { key: 'factures', label: 'Factures', count: counts?.invoices },
          { key: 'paiements', label: 'Paiements' },
          { key: 'projets', label: 'Projets', count: counts?.projects },
          { key: 'contrats', label: 'Contrats', count: counts?.contracts },
          { key: 'documents', label: 'Documents', count: counts?.docs },
        ]}
      />

      {tab === 'apercu' && (
        <div className="grid-3">
          <div className="col" style={{ gap: 14 }}>
            <Card title="Coordonnées" actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setModal('edit')} />}>
              <div className="col" style={{ gap: 9 }}>
                {(c.address_line1 || c.city) && <div className="row top"><MapPin size={15} className="muted" /><span>{[c.address_line1, c.address_line2].filter(Boolean).join(', ')}<br />{[c.postal_code, c.city].filter(Boolean).join(' ')}</span></div>}
                {c.phone && <div className="row"><Phone size={15} className="muted" /><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
                {c.email && <div className="row"><Mail size={15} className="muted" /><a href={`mailto:${c.email}`}>{c.email}</a></div>}
                {c.website && <div className="row"><Globe size={15} className="muted" /><a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, '')}</a></div>}
                {c.gbp_url && <div className="row"><ExternalLink size={15} className="muted" /><a href={c.gbp_url} target="_blank" rel="noreferrer">Fiche Google Business Profile</a></div>}
                {!c.address_line1 && !c.phone && !c.email && <span className="muted small">Aucune coordonnée renseignée.</span>}
              </div>
              <div className="divider" />
              <dl className="dl">
                <dt>Secteur</dt><dd>{c.sector ?? '—'}</dd>
                <dt>Source</dt><dd>{c.source ?? '—'}</dd>
                <dt>Potentiel</dt><dd>{c.potential_cents ? formatEuro(c.potential_cents) : '—'}</dd>
                <dt>SIRET</dt><dd>{c.siret ?? '—'}</dd>
                {c.vat_number && <><dt>TVA intracom.</dt><dd>{c.vat_number}</dd></>}
                <dt>Créée le</dt><dd>{formatDate(c.created_at)}</dd>
                {c.became_client_at && <><dt>Client depuis</dt><dd>{formatDate(c.became_client_at)}</dd></>}
              </dl>
            </Card>
            <Card title="Prochaine action">
              {c.next_action_date ? (
                <div className="col" style={{ gap: 6 }}>
                  <Badge tone={c.next_action_date < today() ? 'danger' : c.next_action_date === today() ? 'warning' : 'info'}>{formatDate(c.next_action_date)}</Badge>
                  <div>{c.next_action ?? 'Relance'}</div>
                </div>
              ) : <div className="muted small">Aucune relance planifiée.</div>}
              <Button size="sm" icon={CalendarPlus} onClick={() => setModal('activite')} className="" >Planifier une relance</Button>
            </Card>
            {primary && (
              <Card title="Contact principal">
                <div className="row"><Avatar name={contactFullName(primary)} /><div><div className="strong">{contactFullName(primary)}</div><div className="muted small">{primary.job_title}</div></div></div>
                <div className="col small" style={{ gap: 4, marginTop: 10 }}>
                  {primary.email && <a href={`mailto:${primary.email}`}>{primary.email}</a>}
                  {primary.phone && <span>{primary.phone}</span>}
                </div>
              </Card>
            )}
            {c.notes && <Card title="Notes internes"><p className="pre small">{c.notes}</p></Card>}
          </div>
          <Card title="Chronologie" className="span-2" actions={<Button size="sm" icon={MessageSquarePlus} onClick={() => setModal('note')}>Ajouter une note</Button>}>
            <Timeline companyId={c.id} />
          </Card>
        </div>
      )}
      {tab === 'contacts' && <ContactsTab companyId={c.id} onNew={() => setModal('contact')} />}
      {tab === 'activites' && <ActivitiesTab companyId={c.id} onNew={() => setModal('activite')} />}
      {tab === 'opportunites' && <OppsTab companyId={c.id} onNew={() => setModal('opportunite')} />}
      {tab === 'devis' && <QuotesTab companyId={c.id} />}
      {tab === 'factures' && <InvoicesTab companyId={c.id} />}
      {tab === 'paiements' && <PaymentsTab companyId={c.id} />}
      {tab === 'projets' && <ProjectsTab companyId={c.id} />}
      {tab === 'contrats' && <ContractsTab companyId={c.id} />}
      {tab === 'documents' && <DocsTab companyId={c.id} />}

      {modal === 'edit' && <CompanyFormModal company={c} onClose={() => setModal(null)} />}
      {modal === 'contact' && <ContactFormModal companyId={c.id} onClose={() => setModal(null)} />}
      {modal === 'activite' && <ActivityFormModal preset={{ company_id: c.id, contact_id: primary?.id ?? null, type: 'relance', title: `Relancer ${c.name}` }} onClose={() => setModal(null)} />}
      {modal === 'note' && <ActivityFormModal preset={{ company_id: c.id, type: 'note', title: '', status: 'fait', due_at: null }} onClose={() => setModal(null)} />}
      {modal === 'opportunite' && <OpportunityFormModal preset={{ company_id: c.id, contact_id: primary?.id ?? null }} onClose={() => setModal(null)} />}
      {modal === 'email' && <EmailComposer context={{ company: c, contact: primary }} categories={['Prospection', 'Fidélisation', 'Projets']} onClose={() => setModal(null)} />}
    </>
  );
}

function Timeline({ companyId }: { companyId: number }) {
  const { data } = useData((x) => companyTimeline(x.db, companyId), [companyId]);
  if (!data) return <Loading />;
  if (!data.length) return <div className="muted small">Aucun événement.</div>;
  const icon = (t: string) => ({ appel: Phone, email: Mail, rdv: CalendarPlus, note: MessageSquarePlus, relance: CalendarPlus, audit: FileText, tache: CheckCircle2, reunion: Users } as Record<string, any>)[t] ?? History;
  return (
    <div className="timeline">
      {data.map((e, i) => {
        const Icon = e.kind === 'activite' ? icon(e.type) : Activity;
        return (
          <div className="item" key={i}>
            <div className={`ico ${e.kind === 'activite' ? 'accent' : ''}`}><Icon /></div>
            <div>
              <div className="small"><span className="strong">{e.title}</span>{e.kind === 'activite' && <span className="muted"> · {activityType(e.type)}</span>}</div>
              {e.detail && <div className="small muted pre">{e.detail}</div>}
              <div className="tiny subtle">{formatDateTime(e.at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContactsTab({ companyId, onNew }: { companyId: number; onNew: () => void }) {
  const { ctx, run } = useApp();
  const [edit, setEdit] = useState<any>(null);
  const { data } = useData((x) => listContacts(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Contacts" actions={<Button size="sm" icon={UserPlus} onClick={onNew}>Ajouter</Button>}>
      {!data?.length ? <Empty icon={Users} title="Aucun contact" /> : (
        <table className="table">
          <thead><tr><th>Nom</th><th>Fonction</th><th>Email</th><th>Téléphone</th><th /></tr></thead>
          <tbody>
            {data.map((k) => (
              <tr key={k.id}>
                <td><div className="row"><Avatar name={contactFullName(k)} /><span className="cell-title">{contactFullName(k)}</span>{k.is_primary ? <Badge tone="accent" plain>Principal</Badge> : null}</div></td>
                <td>{k.job_title}</td>
                <td>{k.email && <a href={`mailto:${k.email}`}>{k.email}</a>}</td>
                <td>{[k.phone, k.mobile].filter(Boolean).join(' / ')}</td>
                <td className="num">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(k)} aria-label="Modifier" />
                  <Button size="sm" variant="ghost" icon={Archive} onClick={() => run(() => archiveContact(ctx.db, k.id), 'Contact archivé')} aria-label="Archiver" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <ContactFormModal contact={edit} companyId={companyId} onClose={() => setEdit(null)} />}
    </Card>
  );
}

export function ActivitiesTab({ companyId, projectId, onNew }: { companyId?: number; projectId?: number; onNew: () => void }) {
  const { ctx, run } = useApp();
  const [edit, setEdit] = useState<any>(null);
  const { data } = useData((x) => listActivities(x.db, { companyId, projectId, scope: 'all' }), [companyId, projectId]);
  const t = today();
  return (
    <Card pad={false} title="Activités et tâches" actions={<Button size="sm" icon={Plus} onClick={onNew}>Ajouter</Button>}>
      {!data?.length ? <Empty icon={CalendarPlus} title="Aucune activité" /> : (
        <table className="table">
          <thead><tr><th style={{ width: 36 }} /><th>Activité</th><th>Échéance</th><th>Priorité</th><th /></tr></thead>
          <tbody>
            {data.map((a) => {
              const done = a.status === 'fait';
              const late = !done && a.due_at && a.due_at.slice(0, 10) < t;
              return (
                <tr key={a.id}>
                  <td><input type="checkbox" checked={done} aria-label="Fait" onChange={(e) => run(() => setActivityStatus(ctx.db, a.id, e.target.checked ? 'fait' : 'a_faire'))} /></td>
                  <td>
                    <div className="cell-title" style={{ textDecoration: done ? 'line-through' : undefined, opacity: done ? 0.6 : 1 }}>{a.title}</div>
                    <div className="cell-sub">{activityType(a.type)}{a.notes ? ' · ' + a.notes.slice(0, 90) : ''}</div>
                  </td>
                  <td>{a.due_at ? <Badge tone={late ? 'danger' : 'muted'} plain>{formatDateTime(a.due_at)}</Badge> : '—'}</td>
                  <td><Badge tone={PRIORITY_TONE[a.priority]} plain>{priority(a.priority)}</Badge></td>
                  <td className="num"><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(a)} aria-label="Modifier" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {edit && <ActivityFormModal activity={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function OppsTab({ companyId, onNew }: { companyId: number; onNew: () => void }) {
  const { data } = useData((x) => listOpportunities(x.db, { companyId, includeClosed: true }), [companyId]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <Card pad={false} title="Opportunités" actions={<Button size="sm" icon={Plus} onClick={onNew}>Ajouter</Button>}>
      {!data?.length ? <Empty icon={Briefcase} title="Aucune opportunité" /> : (
        <table className="table">
          <thead><tr><th>Intitulé</th><th>Statut</th><th className="num">Montant</th><th className="num">Probabilité</th><th>Clôture estimée</th></tr></thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => setEdit(o)}>
                <td className="cell-title">{o.title}</td>
                <td><Badge tone={o.status === 'won' ? 'success' : o.status === 'lost' ? 'danger' : 'info'}>{o.status === 'won' ? 'Gagnée' : o.status === 'lost' ? 'Perdue' : 'En cours'}</Badge></td>
                <td className="num">{formatEuro(o.amount_cents)}</td>
                <td className="num">{o.probability} %</td>
                <td>{formatDate(o.expected_close_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <OpportunityFormModal opportunity={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function QuotesTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listQuotes(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Devis" actions={<Button size="sm" icon={Plus} onClick={() => nav(`/devis/nouveau?entreprise=${companyId}`)}>Nouveau devis</Button>}>
      {!data?.length ? <Empty icon={FileSignature} title="Aucun devis" /> : (
        <table className="table">
          <thead><tr><th>Numéro</th><th>Objet</th><th>Date</th><th>Statut</th><th className="num">Total HT</th><th className="num">Total TTC</th></tr></thead>
          <tbody>
            {data.map((q) => (
              <tr key={q.id} className="clickable" onClick={() => nav(`/devis/${q.id}`)}>
                <td className="cell-title">{q.number}{q.version > 1 ? ` v${q.version}` : ''}</td>
                <td>{q.title}</td>
                <td>{formatDate(q.issue_date)}</td>
                <td><Badge tone={quoteStatus(q.status).tone}>{quoteStatus(q.status).label}</Badge></td>
                <td className="num">{formatEuro(q.total_ht_cents)}</td>
                <td className="num">{formatEuro(q.total_ttc_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function InvoicesTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listInvoices(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Factures et avoirs" actions={<Button size="sm" icon={Plus} onClick={() => nav(`/factures/nouvelle?entreprise=${companyId}`)}>Nouvelle facture</Button>}>
      {!data?.length ? <Empty icon={Receipt} title="Aucune facture" /> : (
        <table className="table">
          <thead><tr><th>Numéro</th><th>Type</th><th>Date</th><th>Échéance</th><th>Statut</th><th className="num">Total TTC</th><th className="num">Reste dû</th></tr></thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/factures/${i.id}`)}>
                <td className="cell-title">{i.number ?? 'Brouillon'}</td>
                <td>{invoiceKind(i.kind)}</td>
                <td>{formatDate(i.issue_date)}</td>
                <td>{formatDate(i.due_date)}</td>
                <td><Badge tone={invoiceStatus(i.display_status).tone}>{invoiceStatus(i.display_status).label}</Badge></td>
                <td className="num">{i.kind === 'avoir' ? '-' : ''}{formatEuro(i.total_ttc_cents)}</td>
                <td className="num strong">{i.due_cents > 0 ? formatEuro(i.due_cents) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PaymentsTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listPayments(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Paiements reçus">
      {!data?.length ? <Empty icon={Receipt} title="Aucun paiement" /> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Facture</th><th>Moyen</th><th>Référence</th><th className="num">Montant</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/factures/${p.invoice_id}`)}>
                <td>{formatDate(p.paid_at)}</td>
                <td className="cell-title">{p.invoice_number}</td>
                <td>{PAYMENT_LABEL[p.method] ?? p.method}</td>
                <td className="muted">{p.reference}</td>
                <td className="num strong">{formatEuro(p.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ProjectsTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listProjects(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Projets" actions={<Button size="sm" icon={Plus} onClick={() => nav(`/projets?nouveau=1&entreprise=${companyId}`)}>Nouveau projet</Button>}>
      {!data?.length ? <Empty icon={FolderKanban} title="Aucun projet" /> : (
        <table className="table">
          <thead><tr><th>Projet</th><th>Statut</th><th>Échéance</th><th>Tâches</th><th className="num">Montant</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/projets/${p.id}`)}>
                <td className="cell-title">{p.name}</td>
                <td><span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: p.status_color ?? '#999' }} />{p.status_name}</span></td>
                <td>{formatDate(p.due_date)}</td>
                <td>{p.tasks_done}/{p.tasks_total}</td>
                <td className="num">{formatEuro(p.contract_amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ContractsTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listContracts(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Contrats et prestations récurrentes" actions={<Button size="sm" icon={Plus} onClick={() => nav(`/contrats?nouveau=1&entreprise=${companyId}`)}>Nouveau contrat</Button>}>
      {!data?.length ? <Empty icon={Repeat} title="Aucun contrat" /> : (
        <table className="table">
          <thead><tr><th>Contrat</th><th>Périodicité</th><th>Statut</th><th>Prochaine facture</th><th className="num">Montant HT</th></tr></thead>
          <tbody>
            {data.map((k) => (
              <tr key={k.id} className="clickable" onClick={() => nav(`/contrats?contrat=${k.id}`)}>
                <td className="cell-title">{k.title}</td>
                <td>{periodicity(k.periodicity)}</td>
                <td><Badge tone={contractStatus(k.status).tone}>{contractStatus(k.status).label}</Badge></td>
                <td>{formatDate(k.next_invoice_date)}</td>
                <td className="num">{formatEuro(k.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DocsTab({ companyId }: { companyId: number }) {
  const nav = useNavigate();
  const { data } = useData((x) => listDocuments(x.db, { companyId }), [companyId]);
  return (
    <Card pad={false} title="Documents" actions={<Button size="sm" onClick={() => nav(`/documents?entreprise=${companyId}`)}>Ouvrir la bibliothèque</Button>}>
      {!data?.length ? <Empty icon={FileText} title="Aucun document" /> : (
        <table className="table">
          <thead><tr><th>Document</th><th>Type</th><th>Date</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => nav(`/documents?document=${d.id}`)}>
                <td className="cell-title">{d.title}{d.locked ? ' 🔒' : ''}</td>
                <td>{d.doc_type}</td>
                <td>{formatDate(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
