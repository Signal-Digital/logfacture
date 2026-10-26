import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, BellRing, Copy, Eye, FileCode2, FileMinus2, Mail, Plus, Receipt, Search, Send, Trash2, Wallet } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { useLeaveGuard } from '../core/guard';
import { Alert, Badge, Button, Card, Dropdown, Empty, Field, Loading, Modal, PageHead, Tabs, useSort } from '../components/ui';
import { CompanyPicker, ContactSelect, DateInput, MoneyInput, PercentInput } from '../components/inputs';
import { LinesEditor } from '../doc/LinesEditor';
import { TotalsBox } from '../doc/Totals';
import { PdfPreviewModal, StoredPdfActions, StoredPdfView } from '../doc/PdfActions';
import { EmailComposer } from '../forms/EmailComposer';
import { HistoryCard } from './Quotes';
import {
  INVOICE_KINDS, INVOICE_STATUSES, PAYMENT_METHODS, addPayment, archiveInvoice, checkInvoice, createCreditNote, createInvoiceDraft, deleteDraftInvoice,
  deletePayment, duplicateInvoice, getInvoice, invoiceSnapshot, issueInvoice, listInvoices, listReminders, recordReminder, saveInvoiceDraft,
  suggestedReminderLevel, type DisplayStatus, type InvoiceFull, type InvoiceHeaderInput, type InvoiceKind, type ReminderLevel,
} from '@/domain/invoices';
import { previewInvoicePdf, storeInvoicePdf } from '@/domain/docgen';
import { invoiceToCii } from '@/domain/facturx';
import { listTemplates } from '@/domain/templates';
import { getCompany, primaryContact } from '@/domain/companies';
import { emptyLine, type DocLine } from '@/domain/docCommon';
import type { DiscountType } from '@/lib/money';
import { addDays, formatDate, formatDateTime, formatEuro, today } from '@/lib/format';
import { PAYMENT_LABEL, invoiceKind, invoiceStatus } from '../labels';

export function InvoicesPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const initial = params.get('statut');
  const [status, setStatus] = useState<DisplayStatus | 'impayees' | ''>((initial as any) ?? '');
  const [kind, setKind] = useState<InvoiceKind | ''>('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const { data, loading } = useData(
    (c) => listInvoices(c.db, { status: status === 'impayees' ? ['emise', 'partiellement_payee', 'en_retard'] : status || undefined, kind: kind || undefined, search, archived }),
    [status, kind, search, archived],
  );
  const { sorted, header } = useSort(data, { key: 'issue_date', dir: 'desc' });
  const totals = (data ?? []).filter((i) => i.status !== 'brouillon').reduce(
    (a, i) => ({ ttc: a.ttc + (i.kind === 'avoir' ? -i.total_ttc_cents : i.total_ttc_cents), due: a.due + Math.max(0, i.due_cents) }),
    { ttc: 0, due: 0 },
  );
  return (
    <>
      <PageHead
        title="Factures et avoirs"
        subtitle="Numérotation chronologique attribuée à l'émission · factures émises non modifiables · rectification par avoir"
        actions={<Button variant="accent" icon={Plus} onClick={() => nav('/factures/nouvelle')}>Nouvelle facture</Button>}
      />
      <div className="toolbar">
        <div className="search"><Search /><input className="input" placeholder="Numéro, objet, client…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`chip ${status === '' ? 'on' : ''}`} onClick={() => setStatus('')}>Toutes</button>
          <button className={`chip ${status === 'impayees' ? 'on' : ''}`} onClick={() => setStatus('impayees')}>Impayées</button>
          {INVOICE_STATUSES.map((s) => <button key={s.key} className={`chip ${status === s.key ? 'on' : ''}`} onClick={() => setStatus(s.key)}>{s.label}</button>)}
        </div>
        <select className="input" style={{ width: 170 }} value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Type">
          <option value="">Tous les types</option>
          {INVOICE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivées</label>
      </div>
      <Card pad={false}>
        {loading && !data ? <Loading /> : sorted.length === 0 ? (
          <Empty icon={Receipt} title="Aucune facture" text="Facturez un devis accepté en un clic, ou créez une facture ponctuelle." action={<Button variant="primary" icon={Plus} onClick={() => nav('/factures/nouvelle')}>Nouvelle facture</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {header('number', 'Numéro')}
                  {header('company_name', 'Client')}
                  <th>Type</th>
                  {header('issue_date', 'Émise le')}
                  {header('due_date', 'Échéance')}
                  {header('display_status', 'Statut')}
                  {header('total_ttc_cents', 'Total TTC', 'num')}
                  {header('due_cents', 'Reste dû', 'num')}
                </tr>
              </thead>
              <tbody>
                {sorted.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => nav(`/factures/${i.id}`)}>
                    <td className="cell-title">{i.number ?? <span className="muted">Brouillon</span>}</td>
                    <td>{i.company_name}<div className="cell-sub">{i.title}</div></td>
                    <td>{invoiceKind(i.kind)}</td>
                    <td>{formatDate(i.issue_date)}</td>
                    <td>{formatDate(i.due_date)}</td>
                    <td><Badge tone={invoiceStatus(i.display_status).tone}>{invoiceStatus(i.display_status).label}</Badge></td>
                    <td className="num">{i.kind === 'avoir' ? '-' : ''}{formatEuro(i.total_ttc_cents)}</td>
                    <td className="num strong">{i.due_cents > 0 ? formatEuro(i.due_cents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={6}>Total des factures émises affichées (avoirs déduits)</td><td className="num">{formatEuro(totals.ttc)}</td><td className="num">{formatEuro(totals.due)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export function InvoiceNew() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { ctx, run, settings } = useApp();
  const preset = Number(params.get('entreprise')) || null;
  const [companyId, setCompanyId] = useState<number | null>(preset);
  const started = useRef(false);
  const start = async (id: number) => {
    if (started.current) return;
    started.current = true;
    const contact = await primaryContact(ctx.db, id);
    const vat = settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp;
    const invId = await run(() => createInvoiceDraft(ctx.db, { company_id: id, contact_id: contact?.id ?? null, lines: [emptyLine(vat)] }));
    if (invId) nav(`/factures/${invId}`, { replace: true });
    else started.current = false;
  };
  useEffect(() => {
    if (preset) start(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
  if (preset) return <Loading />;
  return (
    <>
      <PageHead title="Nouvelle facture" breadcrumb={<Link to="/factures">Factures</Link>} />
      <Card title="Client à facturer">
        <div className="col" style={{ maxWidth: 560 }}>
          <CompanyPicker value={companyId} onChange={setCompanyId} autoFocus />
          <p className="muted small">Pour facturer un devis accepté, ouvrez plutôt le devis et utilisez « Facturer » : les lignes sont reprises automatiquement.</p>
          <div><Button variant="primary" disabled={!companyId} onClick={() => companyId && start(companyId)}>Continuer</Button></div>
        </div>
      </Card>
    </>
  );
}

export function InvoiceDetail() {
  const id = Number(useParams().id);
  const { data: inv, loading } = useData((c) => getInvoice(c.db, id), [id]);
  if (loading && !inv) return <Loading />;
  if (!inv) return <Empty icon={Receipt} title="Facture introuvable" />;
  return inv.status === 'brouillon' ? <InvoiceDraft key={inv.id} inv={inv} /> : <InvoiceView inv={inv} />;
}

function InvoiceDraft({ inv }: { inv: InvoiceFull }) {
  const { ctx, run, confirm, toast } = useApp();
  const nav = useNavigate();
  const [h, setH] = useState<InvoiceHeaderInput>(() => ({
    company_id: inv.company_id, contact_id: inv.contact_id, title: inv.title, service_date: inv.service_date, due_date: inv.due_date,
    global_discount_type: inv.global_discount_type, global_discount_value: inv.global_discount_value, payment_terms: inv.payment_terms,
    footer_notes: inv.footer_notes, notes_internal: inv.notes_internal, template_id: inv.template_id,
  }));
  const [lines, setLines] = useState<DocLine[]>(inv.lines);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState(false);
  const [issueDate, setIssueDate] = useState(today());
  const [errors, setErrors] = useState<string[]>([]);
  const { data: templates } = useData((c) => listTemplates(c.db));
  const { settings } = useApp();
  useLeaveGuard(dirty);
  const set = (k: keyof InvoiceHeaderInput, v: any) => { setH((x) => ({ ...x, [k]: v })); setDirty(true); };
  const setL = (l: DocLine[]) => { setLines(l); setDirty(true); };
  const save = async (silent = false) => {
    try {
      await saveInvoiceDraft(ctx.db, inv.id, h, lines);
      setDirty(false);
      setSavedAt(new Date());
      return true;
    } catch (e: any) {
      if (!silent) toast(e.message, 'error', e.details);
      return false;
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(true), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, lines, dirty]);

  const issue = async () => {
    if (!(await save())) return;
    const check = await checkInvoice(ctx.db, inv.id, issueDate);
    setErrors(check.errors);
    if (check.errors.length) return;
    const due = h.due_date ?? addDays(issueDate, settings.payment.default_terms_days);
    const ok = await confirm({
      title: inv.kind === 'avoir' ? 'Émettre l\'avoir' : 'Émettre la facture',
      message: (
        <div className="col">
          <span>Un numéro définitif sera attribué. La {inv.kind === 'avoir' ? 'l\'avoir' : 'facture'} ne pourra plus être modifié(e) ni supprimé(e) ; toute correction se fera par avoir.</span>
          <dl className="dl"><dt>Date d'émission</dt><dd>{formatDate(issueDate)}</dd>{inv.kind !== 'avoir' && <><dt>Échéance</dt><dd>{formatDate(due)}</dd></>}</dl>
          {check.warnings.length > 0 && <Alert tone="warning"><ul>{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
        </div>
      ),
      confirmLabel: 'Émettre',
    });
    if (!ok) return;
    const snap = await run(async () => {
      const s = await issueInvoice(ctx.db, inv.id, { issueDate, dueDate: inv.kind === 'avoir' ? undefined : due });
      await storeInvoicePdf(ctx, inv.id);
      return s;
    }, 'Document émis et PDF enregistré');
    if (snap) setDirty(false);
  };

  const isCredit = inv.kind === 'avoir';
  return (
    <>
      <PageHead
        breadcrumb={<><Link to="/factures">Factures</Link> / Brouillon</>}
        title={<span className="row">{invoiceKind(inv.kind)} — brouillon <Badge>Brouillon</Badge></span>}
        subtitle={<span>{inv.company_name}{inv.quote_number ? ` · devis ${inv.quote_number}` : ''}{inv.credited_invoice_number ? ` · rectifie la facture ${inv.credited_invoice_number}` : ''} · {dirty ? 'Modifications en cours…' : savedAt ? `Enregistré à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Enregistrement automatique'}</span>}
        actions={
          <>
            <Button icon={Trash2} variant="ghost" onClick={async () => { if (await confirm({ title: 'Supprimer le brouillon', message: 'Ce brouillon n\'a pas de numéro : sa suppression ne crée pas de trou dans la numérotation.', danger: true, confirmLabel: 'Supprimer' })) { setDirty(false); const r = await run(() => deleteDraftInvoice(ctx.db, inv.id), 'Brouillon supprimé'); if (r !== undefined) nav('/factures'); } }}>Supprimer</Button>
            <Button icon={Eye} onClick={async () => { await save(); setPreview(true); }}>Aperçu PDF</Button>
            <Button onClick={() => save()} disabled={!dirty}>Enregistrer</Button>
            <div className="row" style={{ gap: 6 }}>
              <input type="date" className="input" style={{ width: 150 }} value={issueDate} max={today()} onChange={(e) => setIssueDate(e.target.value)} aria-label="Date d'émission" title="Date d'émission" />
              <Button variant="accent" icon={Send} onClick={issue}>Émettre</Button>
            </div>
          </>
        }
      />
      {errors.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="danger" title="Émission impossible pour le moment">
            <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            {errors.some((e) => e.startsWith('Paramètres')) && <Link to="/parametres">Compléter les paramètres →</Link>}
          </Alert>
        </div>
      )}
      <div className="stack-lg">
        <Card title="Informations">
          <div className="form-grid three">
            <Field label="Client" required className="span-2"><CompanyPicker value={h.company_id ?? null} onChange={(id) => { set('company_id', id); set('contact_id', null); }} /></Field>
            <Field label="Contact"><ContactSelect companyId={h.company_id ?? null} value={h.contact_id ?? null} onChange={(v) => set('contact_id', v)} /></Field>
            <Field label="Objet" className="span-2"><input className="input" value={h.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Modèle de document">
              <select className="input" value={h.template_id ?? ''} onChange={(e) => set('template_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Modèle par défaut</option>
                {templates?.filter((t) => t.doc_type !== 'devis').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Date de la prestation / vente" help="Mention obligatoire si différente de la date d'émission"><DateInput value={h.service_date} onChange={(v) => set('service_date', v)} /></Field>
            {!isCredit && <Field label="Échéance" help={`Par défaut : ${settings.payment.default_terms_days} jours après émission`}><DateInput value={h.due_date} onChange={(v) => set('due_date', v)} min={issueDate} /></Field>}
          </div>
        </Card>
        <Card title={isCredit ? 'Lignes de l\'avoir (montants crédités)' : 'Prestations'}>
          <LinesEditor lines={lines} onChange={setL} allowNegative={inv.kind === 'solde' || inv.kind === 'facture'} />
        </Card>
        <div className="grid-2">
          <Card title="Remise et conditions">
            <div className="form-grid">
              <Field label="Remise globale" className="span-2">
                <div className="row" style={{ gap: 6 }}>
                  <select className="input" style={{ width: 120 }} value={h.global_discount_type} onChange={(e) => { set('global_discount_type', e.target.value as DiscountType); set('global_discount_value', 0); }}>
                    <option value="none">Aucune</option><option value="percent">En %</option><option value="amount">En €</option>
                  </select>
                  {h.global_discount_type === 'percent' && <PercentInput value={h.global_discount_value ?? 0} onChange={(v) => set('global_discount_value', v)} />}
                  {h.global_discount_type === 'amount' && <MoneyInput value={h.global_discount_value ?? 0} onChange={(v) => set('global_discount_value', v)} />}
                </div>
              </Field>
              {!isCredit && <Field label="Conditions de paiement" className="span-2"><textarea className="input" rows={2} value={h.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>}
              <Field label="Note en bas du document" className="span-2"><textarea className="input" rows={2} value={h.footer_notes ?? ''} onChange={(e) => set('footer_notes', e.target.value)} /></Field>
              <Field label="Notes internes" className="span-2"><textarea className="input" rows={2} value={h.notes_internal ?? ''} onChange={(e) => set('notes_internal', e.target.value)} /></Field>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>Les mentions légales (pénalités de retard, indemnité de recouvrement, TVA…) sont ajoutées automatiquement d'après les paramètres.</p>
          </Card>
          <TotalsBox lines={lines} discount={{ type: h.global_discount_type ?? 'none', value: h.global_discount_value ?? 0 }} credit={isCredit} />
        </div>
      </div>
      {preview && <PdfPreviewModal title="Aperçu (brouillon)" fileName="Facture (brouillon).pdf" generate={() => previewInvoicePdf(ctx, inv.id)} onClose={() => setPreview(false)} />}
    </>
  );
}

type ViewTab = 'document' | 'paiements' | 'relances' | 'historique';

function InvoiceView({ inv }: { inv: InvoiceFull }) {
  const { ctx, run, confirm, platform, toast } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<ViewTab>('document');
  const [payment, setPayment] = useState(false);
  const [reminder, setReminder] = useState<ReminderLevel | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [credit, setCredit] = useState(false);
  const { data: company } = useData((c) => getCompany(c.db, inv.company_id), [inv.company_id]);
  const { data: reminders } = useData((c) => listReminders(c.db, inv.id), [inv.id]);
  const { data: suggested } = useData((c) => suggestedReminderLevel(c.db, inv.id), [inv.id]);
  const st = invoiceStatus(inv.display_status);
  const isCredit = inv.kind === 'avoir';
  const open = !isCredit && (inv.status === 'emise' || inv.status === 'partiellement_payee');

  useEffect(() => {
    if (!inv.pdf_path) run(() => storeInvoicePdf(ctx, inv.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id, inv.pdf_path]);

  const exportXml = () =>
    run(async () => {
      const xml = invoiceToCii(await invoiceSnapshot(ctx.db, inv.id));
      const p = await platform.saveFile(`${inv.number}-factur-x.xml`, new TextEncoder().encode(xml), { label: 'XML', extensions: ['xml'] });
      if (p) toast('XML CII exporté (préparation Factur-X, non validé).', 'success');
    });

  return (
    <>
      <PageHead
        breadcrumb={<><Link to="/factures">Factures</Link> / {inv.number}</>}
        title={<span className="row">{invoiceKind(inv.kind)} {inv.number} <Badge tone={st.tone}>{st.label}</Badge></span>}
        subtitle={<span><Link to={`/entreprises/${inv.company_id}`}>{inv.company_name}</Link> · émise le {formatDate(inv.issue_date)}{inv.due_date ? ` · échéance ${formatDate(inv.due_date)}` : ''}{inv.quote_id ? <> · <Link to={`/devis/${inv.quote_id}`}>devis {inv.quote_number}</Link></> : null}{inv.credited_invoice_id ? <> · rectifie <Link to={`/factures/${inv.credited_invoice_id}`}>{inv.credited_invoice_number}</Link></> : null}</span>}
        actions={
          <>
            {inv.pdf_path && <StoredPdfActions path={inv.pdf_path} fileName={`${isCredit ? 'Avoir' : 'Facture'} ${inv.number}.pdf`} />}
            <Button icon={Mail} onClick={() => setEmailOpen(true)}>Email</Button>
            {open && <Button icon={BellRing} onClick={() => setReminder(suggested ?? 'relance_1')}>Relancer</Button>}
            {open && <Button variant="accent" icon={Wallet} onClick={() => setPayment(true)}>Enregistrer un paiement</Button>}
            <Dropdown align="right" width={250} trigger={(o) => <Button onClick={o}>Actions</Button>}>
              {(close) => (
                <>
                  {!isCredit && inv.status !== 'annulee' && <button onClick={() => { close(); setCredit(true); }}><FileMinus2 /> Créer un avoir (rectifier / annuler)</button>}
                  {!isCredit && <button onClick={async () => { close(); const id = await run(() => duplicateInvoice(ctx.db, inv.id), 'Brouillon créé'); if (id) nav(`/factures/${id}`); }}><Copy /> Dupliquer en brouillon</button>}
                  <button onClick={() => { close(); exportXml(); }}><FileCode2 /> Exporter le XML (préparation Factur-X)</button>
                  <div className="sep" />
                  <button onClick={() => { close(); run(() => archiveInvoice(ctx.db, inv.id, !inv.archived_at), inv.archived_at ? 'Désarchivée' : 'Archivée'); }}><Archive /> {inv.archived_at ? 'Désarchiver' : 'Archiver'}</button>
                </>
              )}
            </Dropdown>
          </>
        }
      />
      {!isCredit && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">Total dû (TTC)</div><div className="value">{formatEuro(inv.balance.total_cents)}</div></div>
          <div className="kpi"><div className="label">Total payé</div><div className="value" style={{ color: 'var(--success)' }}>{formatEuro(inv.balance.paid_cents)}</div>{inv.balance.credited_cents > 0 && <div className="hint">Avoirs : -{formatEuro(inv.balance.credited_cents)}</div>}</div>
          <div className="kpi"><div className="label">Solde restant dû</div><div className="value" style={{ color: inv.balance.due_cents > 0 ? 'var(--warning)' : undefined }}>{formatEuro(Math.max(0, inv.balance.due_cents))}</div>{inv.balance.due_cents < 0 && <div className="hint" style={{ color: 'var(--danger)' }}>Trop-perçu à rembourser : {formatEuro(-inv.balance.due_cents)}</div>}</div>
          <div className="kpi"><div className="label">Échéance</div><div className="value" style={{ fontSize: 19 }}>{formatDate(inv.due_date)}</div><div className="hint" style={{ color: inv.balance.overdue ? 'var(--danger)' : undefined }}>{inv.balance.overdue ? `En retard de ${inv.balance.days_late} jour(s)` : inv.balance.due_cents <= 0 ? 'Soldée' : 'Dans les délais'}</div></div>
        </div>
      )}
      <Tabs<ViewTab> value={tab} onChange={setTab} tabs={[
        { key: 'document', label: 'Document' },
        ...(!isCredit ? [{ key: 'paiements' as const, label: 'Paiements', count: inv.payments.length }, { key: 'relances' as const, label: 'Relances', count: reminders?.length }] : []),
        { key: 'historique', label: 'Historique' },
      ]} />
      {tab === 'document' && (
        <div className="grid-3">
          <div className="span-2">{inv.pdf_path ? <StoredPdfView path={inv.pdf_path} /> : <Loading />}</div>
          <div className="col">
            <TotalsBox lines={inv.lines} discount={{ type: inv.global_discount_type, value: inv.global_discount_value }} credit={isCredit} />
            {inv.credit_notes.length > 0 && (
              <Card title="Avoirs liés">
                {inv.credit_notes.map((c) => <div key={c.id} className="row between small"><Link to={`/factures/${c.id}`}>{c.number ?? 'Brouillon'}</Link><span>-{formatEuro(c.total_ttc_cents)}</span></div>)}
              </Card>
            )}
            <Card title="Intégrité">
              <dl className="dl" style={{ gridTemplateColumns: '100px 1fr' }}>
                <dt>Émise le</dt><dd>{formatDateTime(inv.issued_at)}</dd>
                <dt>SHA-256</dt><dd className="mono">{inv.pdf_sha256 ?? '—'}</dd>
              </dl>
              <p className="tiny muted" style={{ marginTop: 8 }}>Document verrouillé : ni modification, ni suppression, ni renumérotation possibles.</p>
            </Card>
          </div>
        </div>
      )}
      {tab === 'paiements' && (
        <Card pad={false} title="Historique des paiements" actions={open && <Button size="sm" icon={Plus} onClick={() => setPayment(true)}>Ajouter</Button>}>
          {!inv.payments.length ? <Empty icon={Wallet} title="Aucun paiement enregistré" /> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Moyen</th><th>Référence</th><th>Note</th><th className="num">Montant</th><th /></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.paid_at)}</td>
                    <td>{PAYMENT_LABEL[p.method] ?? p.method}</td>
                    <td>{p.reference}</td>
                    <td className="muted">{p.notes}</td>
                    <td className="num strong">{formatEuro(p.amount_cents)}</td>
                    <td className="num"><Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={async () => { const reason = await confirm({ title: 'Supprimer ce paiement', message: 'La suppression est tracée dans le journal. Utilisez-la pour corriger une erreur de saisie ou un chèque rejeté.', input: { label: 'Motif', required: true }, danger: true, confirmLabel: 'Supprimer' }); if (reason) run(() => deletePayment(ctx.db, p.id, reason), 'Paiement supprimé'); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === 'relances' && (
        <Card pad={false} title="Relances de paiement" actions={open && <><Button size="sm" onClick={() => setReminder('avant_echeance')}>Rappel avant échéance</Button><Button size="sm" onClick={() => setReminder('relance_1')}>Première relance</Button><Button size="sm" onClick={() => setReminder('relance_finale')}>Relance finale</Button></>}>
          {!reminders?.length ? <Empty icon={BellRing} title="Aucune relance" text="Les relances sont préparées et prévisualisées, puis copiées ou ouvertes dans votre messagerie. Aucun envoi automatique." /> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Niveau</th><th>Canal</th><th>Objet</th></tr></thead>
              <tbody>
                {reminders.map((r) => (
                  <tr key={r.id}><td>{formatDateTime(r.created_at)}</td><td>{({ avant_echeance: 'Rappel avant échéance', relance_1: 'Première relance', relance_finale: 'Relance finale' } as any)[r.level]}</td><td>{r.channel === 'copie' ? 'Texte copié' : r.channel === 'messagerie' ? 'Messagerie' : 'SMTP'}</td><td>{r.subject}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === 'historique' && <HistoryCard entity="facture" id={inv.id} />}
      {payment && <PaymentModal inv={inv} onClose={() => setPayment(false)} />}
      {reminder && company && (
        <EmailComposer
          context={{ company, document: { numero: inv.number, objet: inv.title, date: inv.issue_date, date_echeance: inv.due_date, total_ttc: inv.total_ttc_cents, reste_du: inv.balance.due_cents } }}
          templateKey={{ avant_echeance: 'relance_avant_echeance', relance_1: 'relance_paiement_1', relance_finale: 'relance_paiement_finale' }[reminder]}
          categories={['Relances de paiement']}
          onPrepared={(channel, subject, body) => recordReminder(ctx.db, inv.id, reminder, channel, subject, body)}
          onClose={() => setReminder(null)}
        />
      )}
      {emailOpen && company && (
        <EmailComposer
          context={{ company, document: { numero: inv.number, objet: inv.title, date: inv.issue_date, date_echeance: inv.due_date, total_ttc: inv.total_ttc_cents, reste_du: inv.balance.due_cents } }}
          templateKey="envoi_facture"
          categories={['Factures', 'Relances de paiement']}
          attachmentHint="Joignez le PDF (bouton « Exporter ») à votre message."
          onClose={() => setEmailOpen(false)}
        />
      )}
      {credit && <CreditNoteModal inv={inv} onClose={() => setCredit(false)} />}
    </>
  );
}

export function PaymentModal({ inv, onClose }: { inv: InvoiceFull; onClose: () => void }) {
  const { ctx, run, settings } = useApp();
  const methods = PAYMENT_METHODS.filter((m) => settings.payment.methods.find((x) => x.key === m.key)?.enabled !== false);
  const [amount, setAmount] = useState(Math.max(0, inv.balance.due_cents));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState(methods[0]?.key ?? 'virement');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const save = async () => {
    const ok = await run(() => addPayment(ctx.db, inv.id, { amount_cents: amount, paid_at: date, method, reference, notes }), 'Paiement enregistré');
    if (ok) onClose();
  };
  return (
    <Modal title={`Paiement — facture ${inv.number}`} subtitle={`Reste dû : ${formatEuro(inv.balance.due_cents)}`} onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer</Button></>}>
      <div className="form-grid">
        <Field label="Montant reçu" required><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Date de réception" required><DateInput value={date} onChange={(v) => setDate(v ?? today())} max={today()} /></Field>
        <Field label="Moyen de paiement">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Référence" help="N° de chèque, libellé du virement…"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note" className="span-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {method === 'especes' && <div className="span-2"><Alert tone="warning">Paiement en espèces : il est plafonné par la loi (1 000 € entre professionnels et avec un particulier domicilié en France, à vérifier selon votre situation).</Alert></div>}
      </div>
    </Modal>
  );
}

function CreditNoteModal({ inv, onClose }: { inv: InvoiceFull; onClose: () => void }) {
  const { ctx, run } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState<'total' | 'partiel'>(inv.balance.credited_cents > 0 ? 'partiel' : 'total');
  const [reason, setReason] = useState('');
  const go = async () => {
    const id = await run(() => createCreditNote(ctx.db, inv.id, { mode, reason, lines: mode === 'partiel' ? [{ ...emptyLine(inv.lines.find((l) => l.kind === 'item')?.vat_rate_bp ?? 0), designation: `Rectification facture ${inv.number}` }] : undefined }), 'Brouillon d\'avoir créé');
    if (id) nav(`/factures/${id}`);
  };
  return (
    <Modal title={`Avoir sur la facture ${inv.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={go} disabled={!reason.trim()}>Préparer l'avoir</Button></>}>
      <div className="col">
        <p className="small muted">Une facture émise ne se modifie pas et ne se supprime pas : on émet un avoir (numéroté dans sa propre série) qui la rectifie totalement ou partiellement.</p>
        <label className="check"><input type="radio" checked={mode === 'total'} disabled={inv.balance.credited_cents > 0} onChange={() => setMode('total')} /> Avoir total (annule la facture : {formatEuro(inv.total_ttc_cents)} TTC)</label>
        <label className="check"><input type="radio" checked={mode === 'partiel'} onChange={() => setMode('partiel')} /> Avoir partiel (lignes à saisir)</label>
        <Field label="Motif" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Erreur de prix, prestation annulée, geste commercial…" autoFocus /></Field>
        {inv.balance.paid_cents > 0 && <Alert tone="warning">Cette facture a déjà reçu {formatEuro(inv.balance.paid_cents)} de paiements : l'avoir pourra générer un trop-perçu à rembourser au client.</Alert>}
      </div>
    </Modal>
  );
}
