import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Banknote, Briefcase, CalendarClock, CheckCircle2, Clock, FileCheck2, FileSignature, FolderKanban, Gauge, Hourglass,
  Receipt, Repeat, Target, TrendingUp, UserPlus, Wallet,
} from 'lucide-react';
import { useApp, useData } from '../core/app';
import { Alert, Card, Kpi, Loading, PageHead } from '../components/ui';
import { BarChart } from '../components/charts';
import { dashboard, monthlySeries, periodFor, type PeriodKind } from '@/domain/reports';
import { listActivities } from '@/domain/activities';
import { checkAdministrativeSetup } from '@/domain/settings';
import { formatDate, formatDateTime, formatEuro, today } from '@/lib/format';
import { activityType } from '../labels';

export function PeriodPicker({ kind, setKind, custom, setCustom }: { kind: PeriodKind; setKind: (k: PeriodKind) => void; custom: { from: string; to: string }; setCustom: (c: { from: string; to: string }) => void }) {
  return (
    <div className="row wrap">
      <div className="btn-group" role="group" aria-label="Période">
        {([
          ['mois', 'Mois'],
          ['trimestre', 'Trimestre'],
          ['annee', 'Année'],
          ['12_mois', '12 mois'],
          ['personnalisee', 'Personnalisée'],
        ] as [PeriodKind, string][]).map(([k, l]) => (
          <button key={k} className={`btn sm ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {kind === 'personnalisee' && (
        <div className="row" style={{ gap: 6 }}>
          <input type="date" className="input sm" style={{ width: 150 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Début" />
          <span className="muted">→</span>
          <input type="date" className="input sm" style={{ width: 150 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Fin" />
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { settings } = useApp();
  const nav = useNavigate();
  const [kind, setKind] = useState<PeriodKind>('mois');
  const [custom, setCustom] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const period = periodFor(kind, today(), custom);
  const { data: d } = useData((c) => dashboard(c.db, period), [period.from, period.to]);
  const { data: series } = useData((c) => monthlySeries(c.db, periodFor('12_mois')));
  const { data: todayActs } = useData((c) => listActivities(c.db, { scope: 'today' }));
  const { data: lateActs } = useData((c) => listActivities(c.db, { scope: 'late', limit: 8 }));
  const adminIssues = checkAdministrativeSetup(settings).filter((i) => i.severity === 'bloquant');

  return (
    <>
      <PageHead
        title={`Bonjour ${settings.company.manager.split(' ')[0] || ''}`}
        subtitle={`${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} — ${period.label}`}
        actions={<PeriodPicker kind={kind} setKind={setKind} custom={custom} setCustom={setCustom} />}
      />
      {adminIssues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning" title="Configuration administrative à compléter avant d'émettre des documents">
            <ul>{adminIssues.slice(0, 4).map((i) => <li key={i.field + i.label}>{i.label}</li>)}</ul>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => nav('/parametres')}>Compléter les paramètres</button>
          </Alert>
        </div>
      )}
      {!d ? (
        <Loading />
      ) : (
        <div className="stack-lg">
          <div className="grid-4">
            <Kpi hero label="Chiffre d'affaires facturé (HT)" value={formatEuro(d.invoiced_ht_cents)} hint={`${formatEuro(d.invoiced_ttc_cents)} TTC — avoirs déduits`} icon={Receipt} onClick={() => nav('/factures')} />
            <Kpi label="Montants encaissés" value={formatEuro(d.collected_cents)} hint="Paiements reçus sur la période (TTC)" icon={Banknote} tone="success" onClick={() => nav('/paiements')} />
            <Kpi label="Restant dû (factures émises)" value={formatEuro(d.unpaid_cents)} hint={`${d.unpaid_count} facture(s) non soldée(s)`} icon={Wallet} tone="warning" onClick={() => nav('/factures?statut=impayees')} />
            <Kpi label="En retard de paiement" value={formatEuro(d.overdue_cents)} hint={`${d.overdue_count} facture(s) échue(s)`} icon={AlertTriangle} tone={d.overdue_count ? 'danger' : undefined} onClick={() => nav('/factures?statut=en_retard')} />
          </div>
          <div className="grid-4">
            <Kpi label="Valeur du pipeline" value={formatEuro(d.pipeline_total_cents)} hint={`${d.opportunities_open} opportunité(s) ouverte(s) — prévision, non facturé`} icon={TrendingUp} tone="info" onClick={() => nav('/pipeline')} />
            <Kpi label="Prévisionnel pondéré" value={formatEuro(d.pipeline_weighted_cents)} hint="Montants × probabilité de conversion" icon={Gauge} tone="info" onClick={() => nav('/pipeline')} />
            <Kpi label="Devis envoyés" value={d.quotes_sent} hint={`${formatEuro(d.quotes_sent_cents)} HT · ${d.quotes_awaiting} en attente de réponse`} icon={FileSignature} onClick={() => nav('/devis')} />
            <Kpi label="Devis acceptés" value={d.quotes_accepted} hint={`${formatEuro(d.quotes_accepted_cents)} HT · conversion ${d.quotes_conversion_pct == null ? '—' : d.quotes_conversion_pct.toLocaleString('fr-FR') + ' %'}`} icon={FileCheck2} tone="success" onClick={() => nav('/devis?statut=accepte')} />
          </div>
          <div className="grid-4">
            <Kpi label="Prospects" value={d.prospects_total} hint={`${d.prospects_new} nouveau(x) sur la période`} icon={Target} onClick={() => nav('/prospects')} />
            <Kpi label="Relances du jour" value={d.followups_today} hint={`${d.followups_late} relance(s) en retard`} icon={CalendarClock} tone={d.followups_late ? 'warning' : undefined} onClick={() => nav('/activites?vue=jour')} />
            <Kpi label="Projets en cours" value={d.projects_active} hint={`${d.tasks_late} tâche(s) en retard`} icon={FolderKanban} tone={d.tasks_late ? 'warning' : undefined} onClick={() => nav('/projets')} />
            <Kpi label="Contrats récurrents actifs" value={d.contracts_active} hint={`${formatEuro(d.mrr_cents)} HT / mois`} icon={Repeat} onClick={() => nav('/contrats')} />
          </div>

          <div className="grid-3">
            <Card title="Facturé et encaissé — 12 derniers mois" className="span-2" actions={<span className="muted small">Le chiffre d'affaires n'est pas un bénéfice</span>}>
              {series ? (
                <BarChart
                  labels={series.map((s) => s.label)}
                  series={[
                    { key: 'inv', label: 'Facturé HT', color: '#0f1b3d', values: series.map((s) => s.invoiced_ht_cents) },
                    { key: 'col', label: 'Encaissé TTC', color: '#14b8a6', values: series.map((s) => s.collected_cents) },
                  ]}
                />
              ) : <Loading />}
            </Card>
            <Card title="À faire aujourd'hui" actions={<button className="btn sm ghost" onClick={() => nav('/activites')}>Tout voir</button>}>
              {(lateActs?.length ?? 0) + (todayActs?.length ?? 0) === 0 ? (
                <div className="empty" style={{ padding: 20 }}>
                  <CheckCircle2 color="var(--success)" />
                  <span>Rien d'urgent. Bonne journée !</span>
                  <button className="btn sm" onClick={() => nav('/prospects')}><UserPlus size={14} /> Prospecter</button>
                </div>
              ) : (
                <div>
                  {lateActs?.map((a) => (
                    <div key={a.id} className="list-row">
                      <Clock size={16} color="var(--danger)" />
                      <div className="grow">
                        <div className="strong small">{a.title}</div>
                        <div className="tiny muted">{activityType(a.type)} · {a.company_name ?? 'Sans entreprise'} · en retard depuis le {formatDate(a.due_at)}</div>
                      </div>
                    </div>
                  ))}
                  {todayActs?.map((a) => (
                    <div key={a.id} className="list-row">
                      <Hourglass size={16} color="var(--accent)" />
                      <div className="grow">
                        <div className="strong small">{a.title}</div>
                        <div className="tiny muted">{activityType(a.type)} · {a.company_name ?? 'Sans entreprise'} · {formatDateTime(a.due_at).split(' à ')[1] ?? ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <div className="grid-3">
            <Kpi label="Clients actifs" value={d.clients_total} icon={Briefcase} onClick={() => nav('/clients')} />
            <Kpi label="Factures en brouillon" value={d.draft_invoices} hint="Non émises, sans numéro" icon={Receipt} onClick={() => nav('/factures?statut=brouillon')} />
            <Kpi label="Tâches en retard" value={d.tasks_late} icon={AlertTriangle} tone={d.tasks_late ? 'danger' : undefined} onClick={() => nav('/activites?vue=retard')} />
          </div>
        </div>
      )}
    </>
  );
}
