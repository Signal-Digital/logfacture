import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Alert, Button, Card, Kpi, Loading, PageHead } from '../components/ui';
import { BarChart, Donut, HBars } from '../components/charts';
import { PeriodPicker } from './Dashboard';
import { dashboard, monthlySeries, periodFor, quoteStats, receivablesAging, topServices, type PeriodKind } from '@/domain/reports';
import { pipelineSummary } from '@/domain/pipeline';
import { listContracts } from '@/domain/contracts';
import { listProjects } from '@/domain/projects';
import { listInvoices } from '@/domain/invoices';
import { toCsv } from '@/lib/csv';
import { formatDate, formatEuro, today } from '@/lib/format';
import { quoteStatus, periodicity } from '../labels';

export function ReportsPage() {
  const { platform, run, toast } = useApp();
  const [kind, setKind] = useState<PeriodKind>('annee');
  const [custom, setCustom] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const period = periodFor(kind, today(), custom);
  const deps = [period.from, period.to];
  const { data: d } = useData((c) => dashboard(c.db, period), deps);
  const { data: series } = useData((c) => monthlySeries(c.db, period), deps);
  const { data: top } = useData((c) => topServices(c.db, period, 10), deps);
  const { data: qs } = useData((c) => quoteStats(c.db, period), deps);
  const { data: pipe } = useData((c) => pipelineSummary(c.db));
  const { data: aging } = useData((c) => receivablesAging(c.db));
  const { data: contracts } = useData((c) => listContracts(c.db, { status: 'actif' }));
  const { data: projects } = useData((c) => listProjects(c.db, { activeOnly: true }));

  const exportCsv = (name: string, rows: Record<string, unknown>[], cols: { key: string; label: string }[]) =>
    run(async () => {
      const p = await platform.saveFile(`${name}-${period.from}-${period.to}.csv`, new TextEncoder().encode(toCsv(rows, cols)), { label: 'CSV', extensions: ['csv'] });
      if (p) toast('Export CSV enregistré', 'success');
    });
  const e = (c: number) => (c / 100).toFixed(2).replace('.', ',');

  return (
    <>
      <PageHead title="Rapports" subtitle={`${period.label} — du ${formatDate(period.from)} au ${formatDate(period.to)} · chiffres calculés à partir des données enregistrées`} actions={<PeriodPicker kind={kind} setKind={setKind} custom={custom} setCustom={setCustom} />} />
      <div style={{ marginBottom: 14 }}>
        <Alert tone="info">Chiffre d'affaires ≠ bénéfice. Pour un micro-entrepreneur, le chiffre d'affaires à déclarer à l'Urssaf est en principe celui <b>encaissé</b> sur la période (à vérifier selon votre situation) : utilisez la colonne « Encaissé ».</Alert>
      </div>
      {!d ? <Loading /> : (
        <div className="stack-lg">
          <div className="grid-4">
            <Kpi hero label="Facturé HT" value={formatEuro(d.invoiced_ht_cents)} hint={`${formatEuro(d.invoiced_ttc_cents)} TTC`} />
            <Kpi label="Encaissé (TTC)" value={formatEuro(d.collected_cents)} tone="success" />
            <Kpi label="Restant dû" value={formatEuro(d.unpaid_cents)} hint={`dont en retard : ${formatEuro(d.overdue_cents)}`} tone="warning" />
            <Kpi label="Taux de conversion des devis" value={d.quotes_conversion_pct == null ? '—' : `${d.quotes_conversion_pct.toLocaleString('fr-FR')} %`} hint={`${d.quotes_accepted} accepté(s) / ${d.quotes_sent} envoyé(s)`} tone="info" />
          </div>
          <Card title="Chiffre d'affaires facturé, encaissé et devis acceptés par mois" actions={series && <Button size="sm" icon={Download} onClick={() => exportCsv('ca-mensuel', series.map((s) => ({ mois: s.month, facture: e(s.invoiced_ht_cents), encaisse: e(s.collected_cents), devis: e(s.quotes_accepted_cents) })), [{ key: 'mois', label: 'Mois' }, { key: 'facture', label: 'Facturé HT (€)' }, { key: 'encaisse', label: 'Encaissé TTC (€)' }, { key: 'devis', label: 'Devis acceptés HT (€)' }])}>CSV</Button>}>
            {series ? <BarChart labels={series.map((s) => s.label)} series={[
              { key: 'f', label: 'Facturé HT', color: '#0f1b3d', values: series.map((s) => s.invoiced_ht_cents) },
              { key: 'e', label: 'Encaissé TTC', color: '#14b8a6', values: series.map((s) => s.collected_cents) },
              { key: 'd', label: 'Devis acceptés HT', color: '#a5b4fc', values: series.map((s) => s.quotes_accepted_cents) },
            ]} /> : <Loading />}
          </Card>
          <div className="grid-2">
            <Card title="Prestations les plus vendues (facturé HT)" actions={top && <Button size="sm" icon={Download} onClick={() => exportCsv('prestations', top.map((t) => ({ ...t, ht: e(t.ht_cents), qte: (t.quantity_milli / 1000).toLocaleString('fr-FR') })), [{ key: 'name', label: 'Prestation' }, { key: 'qte', label: 'Quantité' }, { key: 'invoices', label: 'Factures' }, { key: 'ht', label: 'Montant HT (€)' }])}>CSV</Button>}>
              {top?.length ? <HBars rows={top.map((t) => ({ label: t.name, value: t.ht_cents, sub: `${(t.quantity_milli / 1000).toLocaleString('fr-FR')} unité(s) · ${t.invoices} facture(s)` }))} /> : <div className="muted small">Aucune facture émise sur la période.</div>}
              <p className="tiny muted" style={{ marginTop: 8 }}>Montants des lignes avant remise globale ; avoirs déduits.</p>
            </Card>
            <Card title="Devis émis sur la période">
              {qs?.length ? <Donut parts={qs.map((q) => ({ label: `${quoteStatus(q.status).label} (${formatEuro(q.ht)})`, value: q.n, color: ({ brouillon: '#94a3b8', envoye: '#60a5fa', attente_signature: '#f59e0b', accepte: '#22c55e', refuse: '#ef4444', expire: '#cbd5e1', annule: '#475569' } as any)[q.status] }))} center={String(qs.reduce((a, q) => a + q.n, 0))} /> : <div className="muted small">Aucun devis.</div>}
            </Card>
          </div>
          <div className="grid-2">
            <Card title="Pipeline commercial (prévisionnel)" actions={pipe && <Button size="sm" icon={Download} onClick={() => exportCsv('pipeline', pipe.byStage.map((s) => ({ ...s, total: e(s.total_cents), pondere: e(s.weighted_cents) })), [{ key: 'name', label: 'Étape' }, { key: 'count', label: 'Opportunités' }, { key: 'total', label: 'Montant HT (€)' }, { key: 'pondere', label: 'Pondéré HT (€)' }])}>CSV</Button>}>
              {pipe && <>
                <div className="row" style={{ gap: 24, marginBottom: 12 }}>
                  <div><div className="muted small">Valeur totale</div><div className="strong" style={{ fontSize: 20 }}>{formatEuro(pipe.total_cents)}</div></div>
                  <div><div className="muted small">Valeur pondérée</div><div className="strong" style={{ fontSize: 20 }}>{formatEuro(pipe.weighted_cents)}</div></div>
                </div>
                <HBars rows={pipe.byStage.filter((s) => s.count).map((s) => ({ label: s.name, value: s.total_cents, sub: `${s.count} opp. · pondéré ${formatEuro(s.weighted_cents)}` }))} />
              </>}
            </Card>
            <Card title="Factures impayées et en retard" actions={aging && <Button size="sm" icon={Download} onClick={() => exportCsv('impayes', aging.invoices.map((i) => ({ numero: i.number, client: i.company_name, echeance: formatDate(i.due_date), du: e(i.due_cents), statut: i.display_status })), [{ key: 'numero', label: 'Facture' }, { key: 'client', label: 'Client' }, { key: 'echeance', label: 'Échéance' }, { key: 'du', label: 'Reste dû (€)' }, { key: 'statut', label: 'Statut' }])}>CSV</Button>}>
              {aging && (
                <HBars rows={[
                  { label: 'À échoir', value: aging.buckets.a_echoir },
                  { label: 'Retard 1–30 jours', value: aging.buckets.j0_30 },
                  { label: 'Retard 31–60 jours', value: aging.buckets.j31_60 },
                  { label: 'Retard 61–90 jours', value: aging.buckets.j61_90 },
                  { label: 'Retard > 90 jours', value: aging.buckets.plus_90 },
                ]} />
              )}
            </Card>
          </div>
          <div className="grid-2">
            <Card title="Revenus récurrents" actions={contracts && <Button size="sm" icon={Download} onClick={() => exportCsv('contrats', contracts.map((k) => ({ ...k, montant: e(k.amount_cents), mensuel: e(k.monthly_cents), period: periodicity(k.periodicity) })), [{ key: 'title', label: 'Contrat' }, { key: 'company_name', label: 'Client' }, { key: 'period', label: 'Périodicité' }, { key: 'montant', label: 'Montant HT (€)' }, { key: 'mensuel', label: 'Mensualisé HT (€)' }])}>CSV</Button>}>
              <div className="row" style={{ gap: 24, marginBottom: 10 }}>
                <div><div className="muted small">Mensuel (MRR)</div><div className="strong" style={{ fontSize: 20 }}>{formatEuro(d.mrr_cents)}</div></div>
                <div><div className="muted small">Annuel (projection)</div><div className="strong" style={{ fontSize: 20 }}>{formatEuro(d.mrr_cents * 12)}</div></div>
              </div>
              {contracts?.length ? <HBars rows={contracts.map((k) => ({ label: `${k.title} — ${k.company_name}`, value: k.monthly_cents }))} /> : <div className="muted small">Aucun contrat actif.</div>}
            </Card>
            <Card title="Projets en cours" actions={projects && <Button size="sm" icon={Download} onClick={() => exportCsv('projets', projects.map((p) => ({ ...p, montant: e(p.contract_amount_cents), avancement: `${p.tasks_done}/${p.tasks_total}`, echeance: formatDate(p.due_date) })), [{ key: 'name', label: 'Projet' }, { key: 'company_name', label: 'Client' }, { key: 'status_name', label: 'Statut' }, { key: 'avancement', label: 'Tâches' }, { key: 'echeance', label: 'Échéance' }, { key: 'montant', label: 'Montant HT (€)' }])}>CSV</Button>}>
              {projects?.length ? projects.map((p) => (
                <div key={p.id} className="list-row small"><span className="dot" style={{ background: p.status_color ?? '#999' }} /><span className="grow"><b>{p.name}</b> — {p.company_name}</span><span className="muted">{p.tasks_done}/{p.tasks_total} · {formatDate(p.due_date)}</span></div>
              )) : <div className="muted small">Aucun projet en cours.</div>}
            </Card>
          </div>
          <InvoicesExport period={period} exportCsv={exportCsv} />
        </div>
      )}
    </>
  );
}

function InvoicesExport({ period, exportCsv }: { period: { from: string; to: string }; exportCsv: (name: string, rows: Record<string, unknown>[], cols: { key: string; label: string }[]) => void }) {
  const { data } = useData((c) => listInvoices(c.db, { from: period.from, to: period.to }), [period.from, period.to]);
  const issued = (data ?? []).filter((i) => i.status !== 'brouillon');
  const e = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  return (
    <Card title="Journal des factures émises (livre des recettes facturées)" actions={<Button size="sm" icon={Download} onClick={() => exportCsv('factures', issued.map((i) => ({ numero: i.number, type: i.kind, date: formatDate(i.issue_date), client: i.company_name, ht: e(i.kind === 'avoir' ? -i.total_ht_cents : i.total_ht_cents), tva: e(i.kind === 'avoir' ? -i.total_vat_cents : i.total_vat_cents), ttc: e(i.kind === 'avoir' ? -i.total_ttc_cents : i.total_ttc_cents), paye: e(i.paid_cents), du: e(Math.max(0, i.due_cents)) })), [
      { key: 'numero', label: 'Numéro' }, { key: 'type', label: 'Type' }, { key: 'date', label: 'Date' }, { key: 'client', label: 'Client' }, { key: 'ht', label: 'HT (€)' }, { key: 'tva', label: 'TVA (€)' }, { key: 'ttc', label: 'TTC (€)' }, { key: 'paye', label: 'Payé (€)' }, { key: 'du', label: 'Reste dû (€)' },
    ])}>Exporter CSV</Button>}>
      <p className="small muted">{issued.length} facture(s) et avoir(s) émis sur la période. L'export CSV peut être transmis à votre comptable. Pour le livre des recettes encaissées (micro-entreprise), utilisez l'export de la page Paiements.</p>
    </Card>
  );
}
