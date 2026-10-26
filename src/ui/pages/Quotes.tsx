import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive, CheckCircle2, Copy, Eye, FileSignature, FolderKanban, GitBranch, Mail, PenLine, Plus, Receipt, Search, Send, ShieldCheck, Trash2, XCircle, Ban, Paperclip,
} from 'lucide-react';
import { useApp, useData } from '../core/app';
import { useLeaveGuard } from '../core/guard';
import { Alert, Badge, Button, Card, Dropdown, Empty, Field, Loading, Modal, PageHead, Tabs, useSort } from '../components/ui';
import { CompanyPicker, ContactSelect, DateInput, MoneyInput, PercentInput } from '../components/inputs';
import { LinesEditor } from '../doc/LinesEditor';
import { TotalsBox } from '../doc/Totals';
import { PdfPreviewModal, StoredPdfActions, StoredPdfView } from '../doc/PdfActions';
import { EmailComposer } from '../forms/EmailComposer';
import { AttachmentsCard } from './Documents';
import {
  QUOTE_STATUSES, acceptQuote, archiveQuote, cancelQuote, checkQuote, createQuote, deleteDraftQuote, duplicateQuote, finalizeQuote, getQuote,
  listQuotes, listVersions, newVersion, refuseQuote, saveQuoteDraft, type QuoteFull, type QuoteHeaderInput, type QuoteStatus,
} from '@/domain/quotes';
import { previewQuotePdf, storeQuoteVersionPdf } from '@/domain/docgen';
import { createSignatureRequest, listSignatures, signatureEvents, verifySignature } from '@/domain/signatures';
import { createInvoiceFromQuote, quoteInvoicingState } from '@/domain/invoices';
import { listTemplates } from '@/domain/templates';
import { listEvents } from '@/domain/audit';
import { createProject, listProjectTemplates } from '@/domain/projects';
import { getCompany, primaryContact } from '@/domain/companies';
import type { DocLine } from '@/domain/docCommon';
import type { DiscountType } from '@/lib/money';
import { formatDate, formatDateTime, formatEuro, today } from '@/lib/format';
import { quoteStatus } from '../labels';

export function QuotesPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<QuoteStatus | ''>((params.get('statut') as QuoteStatus) ?? '');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const { data, loading } = useData((c) => listQuotes(c.db, { status: status || undefined, search, archived }), [status, search, archived]);
  const { sorted, header } = useSort(data, { key: 'issue_date', dir: 'desc' });
  const opp = Number(params.get('opportunite')) || null;
  const rows = opp ? sorted.filter((q) => q.opportunity_id === opp) : sorted;
  return (
    <>
      <PageHead title="Devis" subtitle="Brouillons, envois, signatures et acceptations" actions={<Button variant="accent" icon={Plus} onClick={() => nav('/devis/nouveau')}>Nouveau devis</Button>} />
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Numéro, objet, client…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => setStatus('')}>Tous</button>
          {QUOTE_STATUSES.map((s) => <button key={s.key} className={`chip ${status === s.key ? 'on' : ''}`} onClick={() => setStatus(s.key)}>{s.label}</button>)}
        </div>
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivés</label>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : rows.length === 0 ? (
          <Empty icon={FileSignature} title="Aucun devis" text="Créez un devis depuis une fiche client ou prospect pour reprendre ses coordonnées automatiquement." action={<Button variant="primary" icon={Plus} onClick={() => nav('/devis/nouveau')}>Nouveau devis</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {header('number', 'Numéro')}
                  {header('company_name', 'Client')}
                  <th>Objet</th>
                  {header('issue_date', 'Date')}
                  {header('validity_date', 'Validité')}
                  {header('status', 'Statut')}
                  {header('total_ht_cents', 'Total HT', 'num')}
                  {header('total_ttc_cents', 'Total TTC', 'num')}
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => nav(`/devis/${q.id}`)}>
                    <td className="cell-title">{q.number}{q.version > 1 && <span className="muted"> v{q.version}</span>}</td>
                    <td>{q.company_name}</td>
                    <td className="muted">{q.title}</td>
                    <td>{formatDate(q.issue_date)}</td>
                    <td className={q.validity_date && q.validity_date < today() && ['envoye', 'attente_signature'].includes(q.status) ? 'strong' : ''}>{formatDate(q.validity_date)}</td>
                    <td><Badge tone={quoteStatus(q.status).tone}>{quoteStatus(q.status).label}</Badge>{q.invoiced_cents > 0 && <Badge tone="accent" plain>Facturé</Badge>}</td>
                    <td className="num">{formatEuro(q.total_ht_cents)}</td>
                    <td className="num strong">{formatEuro(q.total_ttc_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Création : choix du client (prérempli depuis une fiche) puis ouverture de l'éditeur. */
export function QuoteNew() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { ctx, run } = useApp();
  const preset = Number(params.get('entreprise')) || null;
  const opp = Number(params.get('opportunite')) || null;
  const [companyId, setCompanyId] = useState<number | null>(preset);
  const started = useRef(false);
  const start = async (id: number) => {
    if (started.current) return;
    started.current = true;
    const contact = await primaryContact(ctx.db, id);
    const quoteId = await run(() => createQuote(ctx.db, { company_id: id, contact_id: contact?.id ?? null, opportunity_id: opp }));
    if (quoteId) nav(`/devis/${quoteId}`, { replace: true });
    else started.current = false;
  };
  useEffect(() => {
    if (preset) start(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  if (preset) return <Loading />;
  return (
    <>
      <PageHead title="Nouveau devis" breadcrumb={<Link to="/devis">Devis</Link>} />
      <Card title="Pour quel client ou prospect ?" className="" >
        <div className="col" style={{ maxWidth: 560 }}>
          <CompanyPicker value={companyId} onChange={(id) => setCompanyId(id)} autoFocus />
          <p className="muted small">Les coordonnées seront reprises automatiquement depuis la fiche (aucune ressaisie). Pour une nouvelle entreprise, créez d'abord la fiche via « Créer ».</p>
          <div><Button variant="primary" disabled={!companyId} onClick={() => companyId && start(companyId)}>Continuer</Button></div>
        </div>
      </Card>
    </>
  );
}

export function QuoteDetail() {
  const id = Number(useParams().id);
  const { data: q, loading } = useData((c) => getQuote(c.db, id), [id]);
  if (loading && !q) return <Loading />;
  if (!q) return <Empty icon={FileSignature} title="Devis introuvable" />;
  return q.status === 'brouillon' ? <QuoteDraft key={`${q.id}-${q.version}`} quote={q} /> : <QuoteView quote={q} />;
}

function QuoteDraft({ quote }: { quote: QuoteFull }) {
  const { ctx, run, confirm, toast } = useApp();
  const nav = useNavigate();
  const [h, setH] = useState<QuoteHeaderInput>(() => pickHeader(quote));
  const [lines, setLines] = useState<DocLine[]>(quote.lines);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState(false);
  const [checking, setChecking] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const { data: templates } = useData((c) => listTemplates(c.db));
  useLeaveGuard(dirty);
  const set = (k: keyof QuoteHeaderInput, v: any) => { setH((x) => ({ ...x, [k]: v })); setDirty(true); };
  const setL = (l: DocLine[]) => { setLines(l); setDirty(true); };

  const save = async (silent = false) => {
    try {
      await saveQuoteDraft(ctx.db, quote.id, h, lines);
      setDirty(false);
      setSavedAt(new Date());
      return true;
    } catch (e: any) {
      if (!silent) toast(e.message, 'error', e.details);
      return false;
    }
  };
  // Enregistrement automatique des brouillons
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(true), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, lines, dirty]);

  const finalize = async (awaitingSignature: boolean) => {
    if (!(await save())) return;
    const check = await checkQuote(ctx.db, quote.id);
    if (check.errors.length || check.warnings.length) {
      setChecking(check);
      if (check.errors.length) return;
    }
    const ok = await confirm({
      title: awaitingSignature ? 'Finaliser pour signature' : 'Finaliser et marquer comme envoyé',
      message: (
        <div className="col">
          <span>Le devis {quote.number} v{quote.version} sera figé : son contenu ne pourra plus être modifié sans créer une nouvelle version. Un PDF définitif sera enregistré avec son empreinte SHA-256.</span>
          {check.warnings.length > 0 && <Alert tone="warning"><ul>{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
        </div>
      ),
      confirmLabel: 'Finaliser',
    });
    if (!ok) return;
    setChecking(null);
    const v = await run(async () => {
      const version = await finalizeQuote(ctx.db, quote.id, { awaitingSignature });
      await storeQuoteVersionPdf(ctx, version.id);
      return version;
    }, `Devis ${quote.number} finalisé`);
    if (v) setDirty(false);
  };

  return (
    <>
      <PageHead
        breadcrumb={<><Link to="/devis">Devis</Link> / {quote.number}</>}
        title={<span className="row">Devis {quote.number}{quote.version > 1 ? ` — version ${quote.version}` : ''} <Badge>Brouillon</Badge></span>}
        subtitle={<span>{quote.company_name} · {dirty ? 'Modifications en cours…' : savedAt ? `Enregistré à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Enregistrement automatique activé'}</span>}
        actions={
          <>
            <Button icon={Trash2} variant="ghost" onClick={async () => { if (await confirm({ title: 'Supprimer le brouillon', message: `Supprimer définitivement le brouillon ${quote.number} ?`, danger: true, confirmLabel: 'Supprimer' })) { const ok = await run(() => deleteDraftQuote(ctx.db, quote.id), 'Brouillon supprimé'); if (ok !== undefined) { setDirty(false); nav('/devis'); } } }}>Supprimer</Button>
            <Button icon={Eye} onClick={async () => { await save(); setPreview(true); }}>Aperçu PDF</Button>
            <Button onClick={() => save()} disabled={!dirty}>Enregistrer</Button>
            <Dropdown align="right" trigger={(open) => <Button variant="accent" icon={Send} onClick={open}>Finaliser</Button>}>
              {(close) => (
                <>
                  <button onClick={() => { close(); finalize(false); }}><Send /> Finaliser et marquer « envoyé »</button>
                  <button onClick={() => { close(); finalize(true); }}><PenLine /> Finaliser pour signature électronique</button>
                </>
              )}
            </Dropdown>
          </>
        }
      />
      {checking && checking.errors.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="danger" title="Le devis ne peut pas encore être finalisé">
            <ul>{checking.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            {checking.errors.some((e) => e.startsWith('Paramètres')) && <Link to="/parametres">Compléter les paramètres →</Link>}
          </Alert>
        </div>
      )}
      <div className="stack-lg">
        <Card title="Informations">
          <div className="form-grid three">
            <Field label="Client" required className="span-2"><CompanyPicker value={h.company_id ?? null} onChange={(id) => { set('company_id', id); set('contact_id', null); }} /></Field>
            <Field label="Contact"><ContactSelect companyId={h.company_id ?? null} value={h.contact_id ?? null} onChange={(v) => set('contact_id', v)} /></Field>
            <Field label="Objet du devis" className="span-2"><input className="input" value={h.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Création de votre site Internet" /></Field>
            <Field label="Modèle de document">
              <select className="input" value={h.template_id ?? ''} onChange={(e) => set('template_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Modèle par défaut</option>
                {templates?.filter((t) => t.doc_type !== 'facture').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Date d'émission" required><DateInput value={h.issue_date} onChange={(v) => set('issue_date', v)} /></Field>
            <Field label="Valable jusqu'au"><DateInput value={h.validity_date} onChange={(v) => set('validity_date', v)} /></Field>
          </div>
        </Card>
        <Card title="Prestations" pad>
          <LinesEditor lines={lines} onChange={setL} />
        </Card>
        <div className="grid-2">
          <Card title="Remise, acompte et conditions">
            <div className="form-grid">
              <Field label="Remise globale">
                <div className="row" style={{ gap: 6 }}>
                  <select className="input" style={{ width: 120 }} value={h.global_discount_type} onChange={(e) => { set('global_discount_type', e.target.value as DiscountType); set('global_discount_value', 0); }}>
                    <option value="none">Aucune</option><option value="percent">En %</option><option value="amount">En €</option>
                  </select>
                  {h.global_discount_type === 'percent' && <PercentInput value={h.global_discount_value ?? 0} onChange={(v) => set('global_discount_value', v)} />}
                  {h.global_discount_type === 'amount' && <MoneyInput value={h.global_discount_value ?? 0} onChange={(v) => set('global_discount_value', v)} />}
                </div>
              </Field>
              <Field label="Acompte demandé">
                <div className="row" style={{ gap: 6 }}>
                  <select className="input" style={{ width: 120 }} value={h.deposit_type} onChange={(e) => { set('deposit_type', e.target.value as DiscountType); set('deposit_value', 0); }}>
                    <option value="none">Aucun</option><option value="percent">En %</option><option value="amount">En € TTC</option>
                  </select>
                  {h.deposit_type === 'percent' && <PercentInput value={h.deposit_value ?? 0} onChange={(v) => set('deposit_value', v)} />}
                  {h.deposit_type === 'amount' && <MoneyInput value={h.deposit_value ?? 0} onChange={(v) => set('deposit_value', v)} />}
                </div>
              </Field>
              <Field label="Conditions de paiement" className="span-2"><textarea className="input" rows={2} value={h.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
              <Field label="Conditions particulières" className="span-2"><textarea className="input" rows={3} value={h.special_conditions ?? ''} onChange={(e) => set('special_conditions', e.target.value)} placeholder="Délais, livrables, propriété intellectuelle…" /></Field>
              <Field label="Note en bas du document" className="span-2"><textarea className="input" rows={2} value={h.footer_notes ?? ''} onChange={(e) => set('footer_notes', e.target.value)} /></Field>
              <Field label="Notes internes (non imprimées)" className="span-2"><textarea className="input" rows={2} value={h.notes_internal ?? ''} onChange={(e) => set('notes_internal', e.target.value)} /></Field>
            </div>
          </Card>
          <div className="col">
            <TotalsBox lines={lines} discount={{ type: h.global_discount_type ?? 'none', value: h.global_discount_value ?? 0 }} deposit={{ type: h.deposit_type ?? 'none', value: h.deposit_value ?? 0 }} />
            <AttachmentsCard quoteId={quote.id} companyId={quote.company_id} />
          </div>
        </div>
      </div>
      {preview && <PdfPreviewModal title={`Aperçu — devis ${quote.number}`} fileName={`Devis ${quote.number} (brouillon).pdf`} generate={() => previewQuotePdf(ctx, quote.id)} onClose={() => setPreview(false)} />}
    </>
  );
}

function pickHeader(q: QuoteFull): QuoteHeaderInput {
  return {
    company_id: q.company_id, contact_id: q.contact_id, opportunity_id: q.opportunity_id, project_id: q.project_id, title: q.title, issue_date: q.issue_date,
    validity_date: q.validity_date, global_discount_type: q.global_discount_type, global_discount_value: q.global_discount_value, deposit_type: q.deposit_type,
    deposit_value: q.deposit_value, payment_terms: q.payment_terms, special_conditions: q.special_conditions, footer_notes: q.footer_notes,
    notes_internal: q.notes_internal, template_id: q.template_id,
  };
}

type ViewTab = 'document' | 'versions' | 'signatures' | 'historique' | 'pieces';

function QuoteView({ quote: q }: { quote: QuoteFull }) {
  const { ctx, run, confirm, platform, toast } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<ViewTab>('document');
  const [email, setEmail] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const { data: versions } = useData((c) => listVersions(c.db, q.id), [q.id, q.version]);
  const { data: sigs } = useData((c) => listSignatures(c.db, q.id), [q.id]);
  const { data: inv } = useData((c) => quoteInvoicingState(c.db, q.id), [q.id]);
  const { data: company } = useData((c) => getCompany(c.db, q.company_id), [q.company_id]);
  const current = versions?.find((v) => v.version === q.version);
  const signedDoc = sigs?.find((s) => s.quote_version_id === current?.id);
  const st = quoteStatus(q.status);

  const ensurePdf = async () => {
    if (current && !current.pdf_path) await run(() => storeQuoteVersionPdf(ctx, current.id));
  };
  useEffect(() => {
    ensurePdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const sign = () =>
    run(async () => {
      const req = await createSignatureRequest(ctx, q.id);
      await platform.openSignatureWindow(req.token);
      toast('Écran de signature ouvert dans une fenêtre séparée.');
    });

  return (
    <>
      <PageHead
        breadcrumb={<><Link to="/devis">Devis</Link> / {q.number}</>}
        title={<span className="row">Devis {q.number}{q.version > 1 ? ` v${q.version}` : ''} <Badge tone={st.tone}>{st.label}</Badge></span>}
        subtitle={<span><Link to={`/entreprises/${q.company_id}`}>{q.company_name}</Link> · {q.title || 'Sans objet'} · émis le {formatDate(q.issue_date)}{q.validity_date ? ` · valable jusqu'au ${formatDate(q.validity_date)}` : ''}</span>}
        actions={
          <>
            {current?.pdf_path && <StoredPdfActions path={signedDoc?.signed_pdf_path ?? current.pdf_path} fileName={`Devis ${q.number}${q.version > 1 ? '-v' + q.version : ''}${signedDoc ? ' - signé' : ''}.pdf`} />}
            <Button icon={Mail} onClick={() => setEmail(true)}>Email</Button>
            {['envoye', 'attente_signature'].includes(q.status) && <Button variant="accent" icon={PenLine} onClick={sign}>Faire signer</Button>}
            {q.status === 'accepte' && <Button variant="accent" icon={Receipt} onClick={() => setInvoicing(true)} disabled={inv?.hasFinal}>Facturer</Button>}
            <Dropdown align="right" width={260} trigger={(open) => <Button onClick={open}>Actions</Button>}>
              {(close) => (
                <>
                  {['envoye', 'attente_signature'].includes(q.status) && (
                    <>
                      <button onClick={async () => { close(); const note = await confirm({ title: 'Enregistrer l\'acceptation', message: 'Le client a accepté ce devis hors de Signal Desk (signature papier, email…). Le prospect deviendra client.', input: { label: 'Preuve / commentaire', placeholder: 'Bon pour accord reçu par email le…', required: true }, confirmLabel: 'Marquer accepté' }); if (note) { const r = await run(() => acceptQuote(ctx.db, q.id, { via: 'manuel', note }), 'Devis accepté'); if (r) setProjectModal(true); } }}><CheckCircle2 /> Marquer comme accepté</button>
                      <button onClick={async () => { close(); const reason = await confirm({ title: 'Devis refusé', message: 'Indiquez le motif (facultatif).', input: { label: 'Motif' }, confirmLabel: 'Marquer refusé', danger: true }); if (reason !== false) run(() => refuseQuote(ctx.db, q.id, reason || undefined), 'Devis marqué refusé'); }}><XCircle /> Marquer comme refusé</button>
                    </>
                  )}
                  {q.status !== 'annule' && (
                    <button onClick={async () => { close(); const reason = await confirm({ title: 'Créer une nouvelle version', message: q.status === 'accepte' ? 'Ce devis est ACCEPTÉ. La version acceptée et sa signature restent conservées ; la nouvelle version devra être de nouveau acceptée.' : 'La version actuelle est conservée ; une nouvelle version modifiable est créée.', input: { label: 'Motif de la modification', required: true }, confirmLabel: 'Créer la version', danger: q.status === 'accepte' }); if (reason) run(() => newVersion(ctx.db, q.id, reason), 'Nouvelle version créée'); }}><GitBranch /> Nouvelle version (modifier)</button>
                  )}
                  <button onClick={async () => { close(); const id = await run(() => duplicateQuote(ctx.db, q.id), 'Devis dupliqué'); if (id) nav(`/devis/${id}`); }}><Copy /> Dupliquer</button>
                  {q.status === 'accepte' && <button onClick={() => { close(); setProjectModal(true); }}><FolderKanban /> Créer le projet</button>}
                  <div className="sep" />
                  {q.status !== 'annule' && q.status !== 'accepte' && <button onClick={async () => { close(); const r = await confirm({ title: 'Annuler le devis', message: 'Le devis restera consultable, avec le statut « annulé ».', input: { label: 'Motif' }, danger: true, confirmLabel: 'Annuler le devis' }); if (r !== false) run(() => cancelQuote(ctx.db, q.id, r || undefined), 'Devis annulé'); }}><Ban /> Annuler le devis</button>}
                  <button onClick={() => { close(); run(() => archiveQuote(ctx.db, q.id, !q.archived_at), q.archived_at ? 'Devis désarchivé' : 'Devis archivé'); }}><Archive /> {q.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                </>
              )}
            </Dropdown>
          </>
        }
      />
      {q.status === 'accepte' && inv && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="success" title={`Accepté le ${formatDate(q.accepted_at)}${signedDoc ? ` — signé électroniquement par ${signedDoc.signer_name}` : ''}`}>
            {inv.issued.length === 0 ? 'Ce devis n\'a pas encore été facturé.' : `Facturé : ${inv.issued.map((i) => i.number).join(', ')}`}
            {inv.drafts.length > 0 && <> · Brouillon(s) : {inv.drafts.map((d) => <Link key={d.id} to={`/factures/${d.id}`} style={{ marginLeft: 6 }}>ouvrir</Link>)}</>}
          </Alert>
        </div>
      )}
      <Tabs<ViewTab> value={tab} onChange={setTab} tabs={[
        { key: 'document', label: 'Document' },
        { key: 'versions', label: 'Versions', count: versions?.length },
        { key: 'signatures', label: 'Signatures', count: sigs?.length },
        { key: 'pieces', label: 'Pièces jointes' },
        { key: 'historique', label: 'Historique' },
      ]} />
      {tab === 'document' && (
        <div className="grid-3">
          <div className="span-2">
            {current?.pdf_path ? <StoredPdfView path={signedDoc?.signed_pdf_path ?? current.pdf_path} /> : <Loading />}
          </div>
          <div className="col">
            <TotalsBox lines={q.lines} discount={{ type: q.global_discount_type, value: q.global_discount_value }} deposit={{ type: q.deposit_type, value: q.deposit_value }} />
            <Card title="Intégrité">
              <dl className="dl" style={{ gridTemplateColumns: '110px 1fr' }}>
                <dt>Version</dt><dd>{q.version} — figée le {formatDateTime(current?.created_at)}</dd>
                <dt>SHA-256 PDF</dt><dd className="mono">{current?.pdf_sha256 ?? '—'}</dd>
              </dl>
            </Card>
            {q.notes_internal && <Card title="Notes internes"><p className="small pre">{q.notes_internal}</p></Card>}
          </div>
        </div>
      )}
      {tab === 'versions' && (
        <Card pad={false}>
          <table className="table">
            <thead><tr><th>Version</th><th>Date</th><th>Motif</th><th>Empreinte du PDF</th><th /></tr></thead>
            <tbody>
              {versions?.map((v) => (
                <tr key={v.id}>
                  <td className="cell-title">v{v.version}{v.id === q.accepted_version_id && <Badge tone="success" plain>Acceptée</Badge>}</td>
                  <td>{formatDateTime(v.created_at)}</td>
                  <td>{v.reason}</td>
                  <td className="mono small">{v.pdf_sha256?.slice(0, 24)}…</td>
                  <td className="num">{v.pdf_path && <Button size="sm" onClick={() => platform.openManagedFile(v.pdf_path!)}>Ouvrir</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === 'signatures' && <SignaturesTab quoteId={q.id} />}
      {tab === 'pieces' && <AttachmentsCard quoteId={q.id} companyId={q.company_id} />}
      {tab === 'historique' && <HistoryCard entity="devis" id={q.id} />}
      {email && company && (
        <EmailComposer
          context={{ company, contact: undefined, document: { numero: q.number, objet: q.title, date: q.issue_date, date_validite: q.validity_date, total_ht: q.total_ht_cents, total_ttc: q.total_ttc_cents } }}
          templateKey={q.status === 'accepte' ? 'confirmation_signature' : 'envoi_devis'}
          categories={['Devis']}
          attachmentHint="Joignez le PDF du devis (bouton « Exporter ») à votre message : l'ouverture dans la messagerie ne permet pas d'ajouter la pièce jointe automatiquement."
          onClose={() => setEmail(false)}
        />
      )}
      {invoicing && inv && <InvoiceFromQuoteModal quote={q} state={inv} onClose={() => setInvoicing(false)} />}
      {projectModal && <ProjectFromQuoteModal quote={q} onClose={() => setProjectModal(false)} />}
    </>
  );
}

function SignaturesTab({ quoteId }: { quoteId: number }) {
  const { ctx, platform } = useApp();
  const { data: sigs } = useData((c) => listSignatures(c.db, quoteId), [quoteId]);
  const { data: events } = useData((c) => signatureEvents(c.db, quoteId), [quoteId]);
  const [checks, setChecks] = useState<Record<number, { ok: boolean; checks: { label: string; ok: boolean }[] }>>({});
  return (
    <div className="grid-2">
      <Card title="Signatures">
        {!sigs?.length ? <div className="muted small">Aucune signature.</div> : sigs.map((s) => (
          <div key={s.id} className="col" style={{ gap: 6, paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
            <div className="strong">{s.signer_name}{s.signer_role ? `, ${s.signer_role}` : ''} — version {s.version}</div>
            <div className="small muted">Signé le {formatDateTime(s.signed_at)} · mention « {s.acceptance_mention} »</div>
            <div className="tiny mono">Original : {s.original_sha256}</div>
            <div className="tiny mono">Signé : {s.signed_sha256}</div>
            <div className="row">
              <Button size="sm" icon={ShieldCheck} onClick={async () => setChecks({ ...checks, [s.id]: await verifySignature(ctx, s.id) })}>Vérifier l'intégrité</Button>
              {s.signed_pdf_path && <Button size="sm" onClick={() => platform.openManagedFile(s.signed_pdf_path!)}>PDF signé</Button>}
              <Button size="sm" onClick={() => platform.openManagedFile(s.original_pdf_path)}>PDF original</Button>
            </div>
            {checks[s.id] && (
              <Alert tone={checks[s.id].ok ? 'success' : 'danger'} title={checks[s.id].ok ? 'Intégrité vérifiée' : 'Anomalie détectée'}>
                <ul>{checks[s.id].checks.map((c) => <li key={c.label}>{c.ok ? '✓' : '✗'} {c.label}</li>)}</ul>
              </Alert>
            )}
          </div>
        ))}
        <p className="tiny muted">Signature électronique simple, réalisée localement. Elle ne constitue pas à elle seule une signature avancée ou qualifiée au sens du règlement eIDAS.</p>
      </Card>
      <Card title="Journal de signature">
        {!events?.length ? <div className="muted small">Aucun événement.</div> : (
          <div className="timeline">
            {events.map((e) => (
              <div className="item" key={e.id}>
                <div className="ico accent"><PenLine /></div>
                <div><div className="small strong">{e.event.replace(/_/g, ' ')}</div><div className="small muted">{e.details}</div><div className="tiny subtle">{formatDateTime(e.at)}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function HistoryCard({ entity, id }: { entity: any; id: number }) {
  const { data } = useData((c) => listEvents(c.db, { entity, id }), [entity, id]);
  return (
    <Card title="Historique des modifications">
      {!data?.length ? <div className="muted small">Aucun événement.</div> : (
        <div className="timeline">
          {data.map((e) => (
            <div className="item" key={e.id}>
              <div className="ico"><Paperclip /></div>
              <div><div className="small">{e.summary}</div><div className="tiny subtle">{formatDateTime(e.at)} · {e.action.replace(/_/g, ' ')}</div></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function InvoiceFromQuoteModal({ quote, state, onClose }: { quote: QuoteFull; state: Awaited<ReturnType<typeof quoteInvoicingState>>; onClose: () => void }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const hasDeposits = state.deposits.length > 0;
  const [mode, setMode] = useState<'totale' | 'acompte' | 'solde'>(hasDeposits ? 'solde' : quote.deposit_type !== 'none' ? 'acompte' : 'totale');
  const [depType, setDepType] = useState<DiscountType>(quote.deposit_type === 'none' ? 'percent' : quote.deposit_type);
  const [depValue, setDepValue] = useState(quote.deposit_type === 'none' ? 3000 : quote.deposit_value);
  const go = async () => {
    const id = await run(() => createInvoiceFromQuote(ctx.db, quote.id, mode, { depositType: depType, depositValue: depValue }), 'Brouillon de facture créé');
    if (id) nav(`/factures/${id}`);
  };
  return (
    <Modal title={`Facturer le devis ${quote.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={go}>Créer le brouillon</Button></>}>
      <div className="col">
        {!hasDeposits && <label className="check"><input type="radio" checked={mode === 'totale'} onChange={() => setMode('totale')} /> Facture totale ({formatEuro(quote.totals.total_ttc_cents)} TTC)</label>}
        <label className="check"><input type="radio" checked={mode === 'acompte'} onChange={() => setMode('acompte')} /> Facture d'acompte</label>
        {mode === 'acompte' && (
          <div className="row" style={{ marginLeft: 26 }}>
            <select className="input" style={{ width: 120 }} value={depType} onChange={(e) => { setDepType(e.target.value as DiscountType); setDepValue(0); }}>
              <option value="percent">En %</option><option value="amount">En € TTC</option>
            </select>
            {depType === 'percent' ? <PercentInput value={depValue} onChange={setDepValue} /> : <MoneyInput value={depValue} onChange={setDepValue} />}
          </div>
        )}
        <label className="check"><input type="radio" checked={mode === 'solde'} onChange={() => setMode('solde')} /> Facture de solde {hasDeposits ? `(acomptes déjà facturés : ${formatEuro(state.deposits_ttc_cents)} TTC, déduits par taux de TVA)` : ''}</label>
        <p className="muted small">Un brouillon est créé : vous pourrez le vérifier avant de l'émettre. Le numéro définitif n'est attribué qu'à l'émission.</p>
      </div>
    </Modal>
  );
}

function ProjectFromQuoteModal({ quote, onClose }: { quote: QuoteFull; onClose: () => void }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const { data: templates } = useData((c) => listProjectTemplates(c.db));
  const [name, setName] = useState(quote.title || `Projet ${quote.company_name}`);
  const [tpl, setTpl] = useState<number | ''>('');
  return (
    <Modal title="Créer le projet correspondant ?" onClose={onClose} footer={<><Button onClick={onClose}>Non merci</Button><Button variant="primary" onClick={async () => { const id = await run(() => createProject(ctx.db, { company_id: quote.company_id, name, quote_id: quote.id, contract_amount_cents: quote.total_ht_cents, template_id: tpl || null }), 'Projet créé'); if (id) nav(`/projets/${id}`); }}>Créer le projet</Button></>}>
      <div className="form-grid">
        <Field label="Nom du projet" className="span-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Modèle de projet" className="span-2">
          <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Sans modèle</option>
            {templates?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.tasks.length} tâches)</option>)}
          </select>
        </Field>
        <div className="span-2 muted small">Montant contractuel : {formatEuro(quote.total_ht_cents)} HT (devis {quote.number}).</div>
      </div>
    </Modal>
  );
}
