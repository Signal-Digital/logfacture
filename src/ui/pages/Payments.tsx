import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Download, Plus, Wallet } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Badge, Button, Card, Empty, Field, Kpi, Loading, Modal, PageHead, useSort } from '../components/ui';
import { PeriodPicker } from './Dashboard';
import { PaymentModal } from './Invoices';
import { getInvoice, listInvoices, listPayments, PAYMENT_METHODS } from '@/domain/invoices';
import { periodFor, receivablesAging, type PeriodKind } from '@/domain/reports';
import { toCsv } from '@/lib/csv';
import { formatDate, formatEuro, today } from '@/lib/format';
import { PAYMENT_LABEL, invoiceStatus } from '../labels';

export function PaymentsPage() {
  const { platform, toast, run } = useApp();
  const nav = useNavigate();
  const [kind, setKind] = useState<PeriodKind>('annee');
  const [custom, setCustom] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const [method, setMethod] = useState('');
  const [pick, setPick] = useState(false);
  const period = periodFor(kind, today(), custom);
  const { data, loading } = useData((c) => listPayments(c.db, { from: period.from, to: period.to, method: method || undefined }), [period.from, period.to, method]);
  const { data: aging } = useData((c) => receivablesAging(c.db));
  const { sorted, header } = useSort(data, { key: 'paid_at', dir: 'desc' });
  const total = (data ?? []).reduce((a, p) => a + p.amount_cents, 0);
  const exportCsv = () =>
    run(async () => {
      const csv = toCsv((data ?? []).map((p) => ({ ...p, amount: (p.amount_cents / 100).toFixed(2).replace('.', ','), method: PAYMENT_LABEL[p.method] ?? p.method, paid_at: formatDate(p.paid_at) })), [
        { key: 'paid_at', label: 'Date' }, { key: 'invoice_number', label: 'Facture' }, { key: 'company_name', label: 'Client' }, { key: 'method', label: 'Moyen' }, { key: 'reference', label: 'Référence' }, { key: 'amount', label: 'Montant (€)' },
      ]);
      const p = await platform.saveFile(`paiements-${period.from}-${period.to}.csv`, new TextEncoder().encode(csv), { label: 'CSV', extensions: ['csv'] });
      if (p) toast('Export enregistré', 'success');
    });
  return (
    <>
      <PageHead title="Paiements" subtitle="Encaissements reçus et factures restant dues" actions={<><PeriodPicker kind={kind} setKind={setKind} custom={custom} setCustom={setCustom} /><Button icon={Download} onClick={exportCsv}>Exporter CSV</Button><Button variant="accent" icon={Plus} onClick={() => setPick(true)}>Enregistrer un paiement</Button></>} />
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi hero label={`Encaissé — ${period.label}`} value={formatEuro(total)} hint={`${data?.length ?? 0} paiement(s)`} icon={Wallet} />
        <Kpi label="À échoir" value={formatEuro(aging?.buckets.a_echoir ?? 0)} hint="Factures émises, pas encore échues" icon={CreditCard} tone="info" />
        <Kpi label="En retard de 1 à 30 jours" value={formatEuro(aging?.buckets.j0_30 ?? 0)} tone="warning" icon={CreditCard} />
        <Kpi label="En retard de plus de 30 jours" value={formatEuro((aging?.buckets.j31_60 ?? 0) + (aging?.buckets.j61_90 ?? 0) + (aging?.buckets.plus_90 ?? 0))} tone="danger" icon={CreditCard} hint={`dont plus de 90 jours : ${formatEuro(aging?.buckets.plus_90 ?? 0)}`} />
      </div>
      <div className="grid-3">
        <Card pad={false} title="Paiements reçus" className="span-2" actions={
          <select className="input sm" style={{ width: 170 }} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Moyen de paiement">
            <option value="">Tous les moyens</option>
            {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        }>
          {loading && !data ? <Loading /> : !sorted.length ? <Empty icon={Wallet} title="Aucun paiement sur la période" /> : (
            <table className="table">
              <thead><tr>{header('paid_at', 'Date')}{header('invoice_number', 'Facture')}{header('company_name', 'Client')}<th>Moyen</th><th>Référence</th>{header('amount_cents', 'Montant', 'num')}</tr></thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/factures/${p.invoice_id}`)}>
                    <td>{formatDate(p.paid_at)}</td><td className="cell-title">{p.invoice_number}</td><td>{p.company_name}</td><td>{PAYMENT_LABEL[p.method] ?? p.method}</td><td className="muted">{p.reference}</td><td className="num strong">{formatEuro(p.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card pad={false} title="Factures impayées">
          {!aging?.invoices.length ? <Empty icon={CreditCard} title="Aucun impayé" /> : (
            <div>
              {aging.invoices.map((i) => (
                <div key={i.id} className="list-row" style={{ padding: '10px 16px', cursor: 'pointer' }} onClick={() => nav(`/factures/${i.id}`)}>
                  <div className="grow">
                    <div className="strong small">{i.number} · {i.company_name}</div>
                    <div className="tiny muted">Échéance {formatDate(i.due_date)}</div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="strong small">{formatEuro(i.due_cents)}</span>
                    <Badge tone={invoiceStatus(i.display_status).tone} plain>{invoiceStatus(i.display_status).label}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {pick && <PickInvoiceForPayment onClose={() => setPick(false)} />}
    </>
  );
}

function PickInvoiceForPayment({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const { data } = useData((c) => listInvoices(c.db, { status: ['emise', 'partiellement_payee', 'en_retard'] }));
  const [selected, setSelected] = useState<number | null>(null);
  const [full, setFull] = useState<any>(null);
  if (full) return <PaymentModal inv={full} onClose={onClose} />;
  const open = (data ?? []).filter((i) => i.kind !== 'avoir' && i.due_cents > 0);
  return (
    <Modal title="Enregistrer un paiement" onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!selected} onClick={async () => setFull(await getInvoice(ctx.db, selected!))}>Continuer</Button></>}>
      <Field label="Facture concernée">
        <select className="input" value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value) || null)} autoFocus>
          <option value="">— Choisir une facture impayée —</option>
          {open.map((i) => <option key={i.id} value={i.id}>{i.number} — {i.company_name} — reste {formatEuro(i.due_cents)}</option>)}
        </select>
      </Field>
      {open.length === 0 && <p className="muted small" style={{ marginTop: 10 }}>Aucune facture en attente de paiement.</p>}
    </Modal>
  );
}
