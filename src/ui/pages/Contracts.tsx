import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, PlayCircle, Plus, Repeat } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Alert, Badge, Button, Card, Empty, Field, Kpi, Loading, Modal, PageHead } from '../components/ui';
import { CompanyPicker, DateInput, MoneyInput, VatSelect } from '../components/inputs';
import {
  CONTRACT_STATUSES, PERIODICITIES, archiveContract, createContract, duePeriods, listContracts, prepareRecurringInvoice, recurringSummary, updateContract,
  type Contract, type ContractInput,
} from '@/domain/contracts';
import { listServices } from '@/domain/catalog';
import { listInvoices } from '@/domain/invoices';
import { formatDate, formatEuro, today } from '@/lib/format';
import { contractStatus, invoiceStatus, periodicity } from '../labels';

export function ContractsPage() {
  const { ctx, run, settings } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<Contract | 'new' | null>(params.get('nouveau') ? 'new' : null);
  const { data, loading } = useData((c) => listContracts(c.db));
  const { data: summary } = useData((c) => recurringSummary(c.db));
  const { data: due } = useData((c) => duePeriods(c.db));
  useEffect(() => {
    const id = Number(params.get('contrat'));
    if (id && data) {
      const k = data.find((x) => x.id === id);
      if (k) setEdit(k);
    }
  }, [params, data]);
  const prepareAll = () =>
    run(async () => {
      let n = 0;
      for (const p of due ?? []) {
        const r = await prepareRecurringInvoice(ctx.db, p.contract.id, p.period_start);
        if (r.created) n++;
      }
      return n;
    }, 'Brouillons de factures préparés');
  return (
    <>
      <PageHead title="Contrats et revenus récurrents" subtitle="Abonnements, maintenance, accompagnements mensuels" actions={<Button variant="accent" icon={Plus} onClick={() => setEdit('new')}>Nouveau contrat</Button>} />
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Kpi hero label="Revenu récurrent mensuel (HT)" value={formatEuro(summary?.mrr_cents ?? 0)} hint={`${summary?.active ?? 0} contrat(s) actif(s)`} icon={Repeat} />
        <Kpi label="Revenu récurrent annuel (HT)" value={formatEuro(summary?.arr_cents ?? 0)} hint="Projection : mensuel × 12" />
        <Kpi label="Factures à préparer" value={due?.length ?? 0} hint={settings.automation.recurring_auto_issue ? 'Émission automatique activée (contrats concernés)' : 'Préparées en brouillon, émission manuelle'} tone={due?.length ? 'warning' : undefined} />
      </div>
      {!!due?.length && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning" title={`${due.length} période(s) à facturer`}>
            <ul>{due.slice(0, 6).map((p) => <li key={p.contract.id + p.period_start}>{p.contract.title} — période du {formatDate(p.period_start)} au {formatDate(p.period_end)}</li>)}</ul>
            <Button size="sm" icon={PlayCircle} onClick={prepareAll}>Préparer les brouillons</Button>
            <span className="small muted" style={{ marginLeft: 8 }}>Sans doublon : une période déjà préparée n'est jamais recréée.</span>
          </Alert>
        </div>
      )}
      <Card pad={false}>
        {loading && !data ? <Loading /> : !data?.length ? <Empty icon={Repeat} title="Aucun contrat" text="Créez un contrat pour les prestations facturées chaque mois, trimestre ou année." /> : (
          <table className="table">
            <thead><tr><th>Contrat</th><th>Client</th><th>Périodicité</th><th className="num">Montant HT</th><th className="num">Mensualisé</th><th>Prochaine facture</th><th>Renouvellement</th><th>Statut</th></tr></thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id} className="clickable" onClick={() => setEdit(k)}>
                  <td><div className="cell-title">{k.title}</div><div className="cell-sub">{k.service_name}{k.auto_issue ? ' · émission auto' : ''}</div></td>
                  <td><a onClick={(e) => { e.stopPropagation(); nav(`/entreprises/${k.company_id}`); }} style={{ cursor: 'pointer' }}>{k.company_name}</a></td>
                  <td>{periodicity(k.periodicity)}</td>
                  <td className="num strong">{formatEuro(k.amount_cents)}</td>
                  <td className="num muted">{formatEuro(k.monthly_cents)}</td>
                  <td className={k.next_invoice_date && k.next_invoice_date <= today() && k.status === 'actif' ? 'strong' : ''}>{formatDate(k.next_invoice_date)}</td>
                  <td>{formatDate(k.renewal_date)}</td>
                  <td><Badge tone={contractStatus(k.status).tone}>{contractStatus(k.status).label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <ContractModal contract={edit === 'new' ? undefined : edit} presetCompany={Number(params.get('entreprise')) || null} onClose={() => { setEdit(null); if (params.toString()) setParams({}); }} />}
    </>
  );
}

function ContractModal({ contract, presetCompany, onClose }: { contract?: Contract; presetCompany: number | null; onClose: () => void }) {
  const { ctx, run, confirm, settings } = useApp();
  const nav = useNavigate();
  const { data: services } = useData((c) => listServices(c.db));
  const { data: invoices } = useData((c) => (contract ? listInvoices(c.db, { contractId: contract.id }) : Promise.resolve([])), [contract?.id]);
  const [f, setF] = useState<ContractInput>(contract ? { ...contract } : { company_id: presetCompany ?? 0, title: '', amount_cents: 0, start_date: today(), periodicity: 'mensuel', vat_rate_bp: settings.vat.regime === 'franchise' ? 0 : settings.vat.default_rate_bp, payment_terms_days: 30 });
  const set = (k: keyof ContractInput, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const ok = await run(async () => {
      if (contract) await updateContract(ctx.db, contract.id, f);
      else await createContract(ctx.db, f);
      return true;
    }, 'Contrat enregistré');
    if (ok) onClose();
  };
  return (
    <Modal
      title={contract ? contract.title : 'Nouveau contrat récurrent'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {contract && <Button variant="ghost" icon={Archive} onClick={async () => { if (await confirm({ title: 'Archiver le contrat', message: 'Le contrat n\'apparaîtra plus dans la liste. Ses factures sont conservées.' })) { await run(() => archiveContract(ctx.db, contract.id), 'Contrat archivé'); onClose(); } }}>Archiver</Button>}
          <div className="grow" />
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={save}>Enregistrer</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Intitulé" required className="span-2"><input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Maintenance du site Internet" /></Field>
        <Field label="Client" required className="span-2"><CompanyPicker value={f.company_id || null} onChange={(id) => set('company_id', id ?? 0)} /></Field>
        <Field label="Prestation du catalogue">
          <select className="input" value={f.service_id ?? ''} onChange={(e) => {
            const s = services?.find((x) => x.id === Number(e.target.value));
            setF((x) => ({ ...x, service_id: s?.id ?? null, title: x.title || s?.name || '', amount_cents: x.amount_cents || s?.unit_price_cents || 0, vat_rate_bp: settings.vat.regime === 'franchise' ? 0 : s?.vat_rate_bp ?? x.vat_rate_bp }));
          }}>
            <option value="">—</option>
            {services?.filter((s) => s.is_recurring || s.id === f.service_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <optgroup label="Autres">{services?.filter((s) => !s.is_recurring && s.id !== f.service_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Périodicité">
          <select className="input" value={f.periodicity} onChange={(e) => set('periodicity', e.target.value)}>
            {PERIODICITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Montant HT par période" required><MoneyInput value={f.amount_cents} onChange={(v) => set('amount_cents', v)} /></Field>
        <Field label="Taux de TVA"><VatSelect value={f.vat_rate_bp ?? 0} onChange={(v) => set('vat_rate_bp', v)} /></Field>
        <Field label="Date de début" required><DateInput value={f.start_date} onChange={(v) => set('start_date', v ?? today())} /></Field>
        <Field label="Prochaine facture"><DateInput value={f.next_invoice_date} onChange={(v) => set('next_invoice_date', v)} /></Field>
        <Field label="Date de renouvellement"><DateInput value={f.renewal_date} onChange={(v) => set('renewal_date', v)} /></Field>
        <Field label="Date de fin"><DateInput value={f.end_date} onChange={(v) => set('end_date', v)} /></Field>
        <Field label="Statut">
          <select className="input" value={f.status ?? 'actif'} onChange={(e) => set('status', e.target.value)}>
            {CONTRACT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Délai de paiement (jours)"><input className="input num" type="number" min={0} max={60} value={f.payment_terms_days ?? 30} onChange={(e) => set('payment_terms_days', Number(e.target.value))} /></Field>
        <Field label="Conditions de résiliation" className="span-2"><textarea className="input" rows={2} value={f.termination_terms ?? ''} onChange={(e) => set('termination_terms', e.target.value)} placeholder="Résiliable à tout moment avec un préavis d'un mois…" /></Field>
        <Field label="Description (reprise sur la facture)" className="span-2"><textarea className="input" rows={2} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="span-2">
          <label className="check"><input type="checkbox" checked={!!f.auto_issue} onChange={(e) => set('auto_issue', e.target.checked ? 1 : 0)} /> Émettre automatiquement les factures de ce contrat</label>
          <div className="help muted small" style={{ marginTop: 4 }}>
            {settings.automation.recurring_auto_issue ? "L'émission automatique est activée dans les paramètres." : "L'émission automatique est désactivée dans les paramètres (Paramètres → Automatisations) : les factures restent préparées en brouillon."}
          </div>
        </div>
        {contract && !!invoices?.length && (
          <div className="span-2">
            <div className="label" style={{ marginBottom: 6 }}>Factures du contrat</div>
            {invoices.map((i) => (
              <div key={i.id} className="row between small list-row" style={{ cursor: 'pointer' }} onClick={() => nav(`/factures/${i.id}`)}>
                <span>{i.number ?? 'Brouillon'} — {i.title}</span>
                <span className="row"><Badge tone={invoiceStatus(i.display_status).tone} plain>{invoiceStatus(i.display_status).label}</Badge>{formatEuro(i.total_ttc_cents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
