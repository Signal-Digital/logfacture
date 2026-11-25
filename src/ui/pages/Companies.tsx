import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Columns3, List, Copy, Download, GitMerge, Plus, Search, Upload, Users } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Avatar, Badge, Button, Card, Empty, Loading, Modal, PageHead, Tabs, useSort } from '../components/ui';
import { CompanyFormModal } from '../forms/CompanyForm';
import { ContactFormModal } from '../forms/smallForms';
import {
  CSV_COLUMNS, SOURCES, exportCompaniesCsv, importCompaniesCsv, listCompanies, listContacts, mapCsvHeaders,
  mergeCompanies, scanDuplicates, contactFullName, type CompanyFilter, type CompanyKind, type CompanyListRow, type ImportReport,
} from '@/domain/companies';
import { csvToObjects } from '@/lib/csv';
import { formatDate, formatEuro, today } from '@/lib/format';
import { KIND_LABEL, KIND_TONE } from '../labels';
import { StatusPicker, StatusPill, useStatusChange } from '../components/StatusPicker';
import { COMMERCIAL_STATUS_DEFS, statusCounts, type CommercialStatus } from '@/domain/prospectStatus';

export function CompaniesPage({ kind }: { kind?: CompanyKind }) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('onglet') as 'entreprises' | 'contacts') ?? 'entreprises';
  const title = kind === 'prospect' ? 'Prospects' : kind === 'client' ? 'Clients' : 'Entreprises et contacts';
  const [creating, setCreating] = useState(false);
  const [newContact, setNewContact] = useState(false);
  return (
    <>
      <PageHead
        title={title}
        subtitle={kind === 'prospect' ? 'Fiches de prospection, relances et import/export CSV' : kind === 'client' ? 'Vos clients, leur chiffre d\'affaires et leur solde' : 'Toutes les entreprises (prospects, clients, partenaires) et leurs contacts'}
        actions={
          tab === 'contacts' ? (
            <Button variant="accent" icon={Plus} onClick={() => setNewContact(true)}>Nouveau contact</Button>
          ) : (
            <Button variant="accent" icon={Plus} onClick={() => setCreating(true)}>{kind === 'client' ? 'Nouveau client' : 'Nouveau prospect'}</Button>
          )
        }
      />
      {!kind && (
        <Tabs
          tabs={[{ key: 'entreprises', label: 'Entreprises' }, { key: 'contacts', label: 'Contacts' }]}
          value={tab}
          onChange={(k) => setParams(k === 'contacts' ? { onglet: 'contacts' } : {})}
        />
      )}
      {tab === 'contacts' && !kind ? <ContactsList /> : <CompanyList kind={kind} />}
      {creating && <CompanyFormModal kind={kind === 'client' ? 'client' : 'prospect'} onClose={() => setCreating(false)} />}
      {newContact && <ContactFormModal onClose={() => setNewContact(false)} />}
    </>
  );
}

function CompanyList({ kind }: { kind?: CompanyKind }) {
  const { ctx, platform, run, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState<CompanyFilter>({ kind, search: '', followUp: (params.get('relance') as any) ?? undefined });
  const [importing, setImporting] = useState<{ name: string; text: string } | null>(null);
  const [dups, setDups] = useState(false);
  const { data, loading } = useData((c) => listCompanies(c.db, { ...f, kind }), [JSON.stringify(f), kind]);
  const { sorted, header } = useSort(data, { key: 'name', dir: 'asc' });
  const isClient = kind === 'client';
  const t = today();
  const [view, setView] = useState<'liste' | 'tableau'>(() => (localStorage.getItem('sd-prospects-vue') as any) ?? 'liste');
  const setViewSaved = (v: 'liste' | 'tableau') => { setView(v); try { localStorage.setItem('sd-prospects-vue', v); } catch { /* stockage indisponible */ } };
  const { data: counts } = useData((c) => statusCounts(c.db, kind), [kind]);
  const showStatus = !isClient;

  const exportCsv = () =>
    run(async () => {
      const csv = await exportCompaniesCsv(ctx.db, { ...f, kind });
      const name = `${kind === 'prospect' ? 'prospects' : kind === 'client' ? 'clients' : 'entreprises'}-${t}.csv`;
      const p = await platform.saveFile(name, new TextEncoder().encode(csv), { label: 'CSV', extensions: ['csv'] });
      if (p) toast(`Export enregistré : ${p}`, 'success');
    });

  const importCsv = async () => {
    const file = await platform.pickFile({ title: 'Importer un fichier CSV', extensions: ['csv', 'txt'], label: 'Fichier CSV' });
    if (!file) return;
    let text = new TextDecoder('utf-8').decode(file.bytes);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(file.bytes);
    setImporting({ name: file.name, text });
  };

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Nom, contact, email, téléphone, ville…" value={f.search ?? ''} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Rechercher" />
        </div>
        <select className="input" style={{ width: 170 }} value={f.source ?? ''} onChange={(e) => setF({ ...f, source: e.target.value || undefined })} aria-label="Source">
          <option value="">Toutes les sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 170 }} value={f.followUp ?? ''} onChange={(e) => setF({ ...f, followUp: (e.target.value || undefined) as any })} aria-label="Relances">
          <option value="">Toutes les relances</option>
          <option value="today">Relance aujourd'hui</option>
          <option value="late">Relance en retard</option>
          <option value="week">Relance sous 7 jours</option>
        </select>
        <label className="check small"><input type="checkbox" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Archivées</label>
        <div className="grow" />
        <Button icon={Upload} onClick={importCsv}>Importer CSV</Button>
        <Button icon={Download} onClick={exportCsv}>Exporter CSV</Button>
        <Button icon={Copy} onClick={() => setDups(true)}>Doublons</Button>
      </div>
      {showStatus && (
        <div className="row between wrap" style={{ marginBottom: 12, gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip ${!f.status ? 'on' : ''}`} onClick={() => setF({ ...f, status: undefined })}>Tous <span className="muted">{Object.values(counts ?? {}).reduce((a, b) => a + b, 0)}</span></button>
            {COMMERCIAL_STATUS_DEFS.filter((d) => kind !== 'prospect' || d.key !== 'client' || counts?.client).map((d) => (
              <button key={d.key} className={`chip ${f.status === d.key ? 'on' : ''}`} onClick={() => setF({ ...f, status: f.status === d.key ? undefined : d.key })} title={d.hint}>
                <span className="dot" style={{ background: d.color }} /> {d.short} <span className="muted">{counts?.[d.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="btn-group">
            <button className={`btn sm ${view === 'liste' ? 'on' : ''}`} onClick={() => setViewSaved('liste')}><List size={14} /> Liste</button>
            <button className={`btn sm ${view === 'tableau' ? 'on' : ''}`} onClick={() => setViewSaved('tableau')}><Columns3 size={14} /> Tableau</button>
          </div>
        </div>
      )}
      {showStatus && view === 'tableau' ? (
        <StatusBoard rows={sorted} />
      ) : (
      <Card pad={false}>
        {loading && !data ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <Empty icon={Users} title={f.search || f.status || f.followUp ? 'Aucun résultat' : kind === 'client' ? 'Aucun client pour le moment' : 'Aucune fiche pour le moment'} text={kind === 'client' ? 'Un prospect devient client automatiquement lorsqu\'un devis est accepté ou qu\'une facture est émise.' : 'Créez votre première fiche ou importez une liste au format CSV.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {header('name', 'Entreprise')}
                  {!kind && <th>Type</th>}
                  {header('commercial_status', 'Statut')}
                  {header('city', 'Ville')}
                  <th>Contact</th>
                  {isClient ? header('invoiced_cents', 'Facturé TTC', 'num') : header('potential_cents', 'Potentiel', 'num')}
                  {header('next_action_date', 'Relance')}
                  {header('created_at', 'Créée le')}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/entreprises/${c.id}`)}>
                    <td>
                      <div className="row">
                        <Avatar name={c.name} />
                        <div>
                          <div className="cell-title">{c.name}</div>
                          <div className="cell-sub">{[c.sector, c.source].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                    {!kind && <td><Badge tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Badge></td>}
                    <td>{showStatus ? <StatusPicker companyId={c.id} name={c.name} status={c.commercial_status} /> : <StatusPill status={c.commercial_status} />}</td>
                    <td>{c.city}</td>
                    <td>
                      <div>{c.contact_name}</div>
                      <div className="cell-sub">{c.email ?? c.phone}</div>
                    </td>
                    <td className="num">{isClient ? formatEuro(c.invoiced_cents) : c.potential_cents ? formatEuro(c.potential_cents) : '—'}</td>
                    <td>
                      {c.next_action_date ? (
                        <div>
                          <Badge tone={c.next_action_date < t ? 'danger' : c.next_action_date === t ? 'warning' : 'info'}>{formatDate(c.next_action_date)}</Badge>
                          {c.next_action && <div className="cell-sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.next_action}</div>}
                        </div>
                      ) : <span className="subtle">—</span>}
                    </td>
                    <td className="muted small">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}
      <div className="muted small" style={{ marginTop: 8 }}>{sorted.length} fiche(s)</div>
      {importing && <CsvImportModal file={importing} defaultKind={kind ?? 'prospect'} onClose={() => setImporting(null)} />}
      {dups && <DuplicatesModal onClose={() => setDups(false)} />}
    </>
  );
}

function CsvImportModal({ file, defaultKind, onClose }: { file: { name: string; text: string }; defaultKind: CompanyKind; onClose: () => void }) {
  const { ctx, run } = useApp();
  const parsed = csvToObjects(file.text);
  const [mapping, setMapping] = useState<Record<string, string>>(() => mapCsvHeaders(parsed.headers));
  const [importDuplicates, setImportDuplicates] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const doImport = async () => {
    const r = await run(() => importCompaniesCsv(ctx.db, file.text, { defaultKind, importDuplicates, mapping }));
    if (r) setReport(r);
  };
  return (
    <Modal
      title="Importer des fiches (CSV)"
      subtitle={`${file.name} — ${parsed.rows.length} ligne(s)`}
      onClose={onClose}
      size="xl"
      footer={report ? <Button variant="primary" onClick={onClose}>Terminer</Button> : <><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={doImport} disabled={!Object.values(mapping).includes('name')}>Importer {parsed.rows.length} ligne(s)</Button></>}
    >
      {report ? (
        <div className="col">
          <div className="alert success">{report.created} fiche(s) créée(s).</div>
          {report.skippedDuplicates.length > 0 && (
            <div className="alert warning">
              <div>
                <div className="strong">{report.skippedDuplicates.length} doublon(s) ignoré(s)</div>
                <ul>{report.skippedDuplicates.slice(0, 20).map((d) => <li key={d.line}>Ligne {d.line} : « {d.name} » ressemble à « {d.existing} » ({d.reasons.join(', ')})</li>)}</ul>
              </div>
            </div>
          )}
          {report.errors.length > 0 && (
            <div className="alert danger">
              <div>
                <div className="strong">{report.errors.length} ligne(s) en erreur</div>
                <ul>{report.errors.slice(0, 20).map((e) => <li key={e.line}>Ligne {e.line} : {e.message}</li>)}</ul>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="col">
          <p className="muted small">Associez chaque colonne du fichier à un champ de Signal Desk. Séparateurs « ; », « , » ou tabulation détectés automatiquement. Les doublons potentiels sont ignorés par défaut.</p>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Colonne du fichier</th><th>Champ Signal Desk</th><th>Exemple</th></tr></thead>
              <tbody>
                {parsed.headers.map((h) => (
                  <tr key={h}>
                    <td className="strong">{h}</td>
                    <td>
                      <select className="input sm" value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                        <option value="">— Ignorer —</option>
                        {CSV_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </td>
                    <td className="muted small">{parsed.rows[0]?.[h]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check"><input type="checkbox" checked={importDuplicates} onChange={(e) => setImportDuplicates(e.target.checked)} /> Importer aussi les doublons potentiels</label>
        </div>
      )}
    </Modal>
  );
}

function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const { ctx, run, confirm } = useApp();
  const { data, loading } = useData((c) => scanDuplicates(c.db));
  const merge = async (targetId: number, sourceId: number, targetName: string, sourceName: string) => {
    const ok = await confirm({
      title: 'Fusionner les fiches',
      message: <>La fiche « <b>{sourceName}</b> » sera fusionnée dans « <b>{targetName}</b> ». Contacts, activités, opportunités, devis, factures, projets et documents seront rattachés à « {targetName} ». La fiche fusionnée reste consultable dans le journal (archivée).</>,
      confirmLabel: 'Fusionner',
    });
    if (ok) await run(() => mergeCompanies(ctx.db, targetId, sourceId), 'Fiches fusionnées');
  };
  return (
    <Modal title="Doublons potentiels" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Fermer</Button>}>
      {loading ? <Loading /> : !data?.length ? (
        <Empty icon={GitMerge} title="Aucun doublon détecté" text="Comparaison sur le nom, l'email, le domaine, le téléphone, le site Internet et le SIRET." />
      ) : (
        <div className="col">
          {data.map((p) => (
            <div key={`${p.a.id}-${p.b.id}`} className="card card-pad row between">
              <div>
                <div className="strong">{p.a.name} <span className="muted">↔</span> {p.b.name}</div>
                <div className="muted small">{p.reasons.join(' · ')} — score {p.score}</div>
              </div>
              <div className="row">
                <Button size="sm" icon={GitMerge} onClick={() => merge(p.a.id, p.b.id, p.a.name, p.b.name)}>Garder « {p.a.name.slice(0, 18)} »</Button>
                <Button size="sm" icon={GitMerge} onClick={() => merge(p.b.id, p.a.id, p.b.name, p.a.name)}>Garder « {p.b.name.slice(0, 18)} »</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ContactsList() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const [archived, setArchived] = useState(false);
  const { data, loading } = useData((c) => listContacts(c.db, { search: q, includeArchived: archived }), [q, archived]);
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Rechercher un contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Inclure les archivés</label>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty icon={Users} title="Aucun contact" />
        ) : (
          <table className="table">
            <thead><tr><th>Nom</th><th>Fonction</th><th>Entreprise</th><th>Email</th><th>Téléphone</th></tr></thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id} className="clickable" onClick={() => k.company_id && nav(`/entreprises/${k.company_id}`)}>
                  <td><div className="row"><Avatar name={contactFullName(k)} /><span className="cell-title">{contactFullName(k)}</span>{k.is_primary ? <Badge tone="accent" plain>Principal</Badge> : null}{k.archived_at && <Badge tone="muted" plain><Archive size={11} /> Archivé</Badge>}</div></td>
                  <td>{k.job_title}</td>
                  <td>{k.company_name}</td>
                  <td>{k.email && <a href={`mailto:${k.email}`} onClick={(e) => e.stopPropagation()}>{k.email}</a>}</td>
                  <td>{k.phone ?? k.mobile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/** Vue « tableau » : une colonne par statut, glisser-déposer pour changer de statut. */
function StatusBoard({ rows }: { rows: CompanyListRow[] }) {
  const nav = useNavigate();
  const { change, dialog } = useStatusChange();
  const [drag, setDrag] = useState<CompanyListRow | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const t = today();
  return (
    <div className="kanban">
      {COMMERCIAL_STATUS_DEFS.map((d) => {
        const cards = rows.filter((r) => r.commercial_status === d.key);
        return (
          <div
            key={d.key}
            className={`kanban-col ${over === d.key ? 'over' : ''}`}
            style={{ width: 230 }}
            onDragOver={(e) => { e.preventDefault(); if (over !== d.key) setOver(d.key); }}
            onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (drag && drag.commercial_status !== d.key) change(drag.id, drag.name, d.key as CommercialStatus);
              setDrag(null);
            }}
          >
            <div className="kanban-col-head">
              <div className="t"><span className="dot" style={{ background: d.color }} />{d.short}<span className="muted small" style={{ marginLeft: 'auto' }}>{cards.length}</span></div>
              <div className="muted tiny">{d.hint}</div>
            </div>
            <div className="kanban-col-body">
              {cards.map((c) => (
                <div key={c.id} className={`kcard ${drag?.id === c.id ? 'dragging' : ''}`} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.id)); setDrag(c); }} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => nav(`/entreprises/${c.id}`)}>
                  <div className="t">{c.name}</div>
                  <div className="c">{[c.contact_name, c.city].filter(Boolean).join(' · ')}</div>
                  <div className="foot">
                    <span>{c.potential_cents ? formatEuro(c.potential_cents) : ''}</span>
                    {c.next_action_date && <span className="tiny" style={{ color: c.next_action_date < t ? 'var(--danger)' : 'var(--muted)' }}>Relance {formatDate(c.next_action_date)}</span>}
                  </div>
                  {d.key === 'perdu' && c.lost_reason && <div className="tiny muted">{c.lost_reason}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {dialog}
    </div>
  );
}
