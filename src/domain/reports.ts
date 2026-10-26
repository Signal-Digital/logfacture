/**
 * Tableau de bord et rapports — calculés à partir des données réelles.
 *
 * Distinctions systématiques :
 *  - facturé (factures émises, avoirs déduits) ≠ encaissé (paiements reçus)
 *  - restant dû (factures émises non soldées)
 *  - prévisionnel (pipeline, pondéré par la probabilité)
 * Le chiffre d'affaires n'est jamais présenté comme un bénéfice.
 */
import type { Db } from '@/lib/db';
import { addMonths, today, toLocalIsoDate, parseIsoDate } from '@/lib/format';
import { activityCounts } from './activities';
import { pipelineSummary } from './pipeline';
import { recurringSummary } from './contracts';
import { listInvoices } from './invoices';

export interface Period {
  from: string;
  to: string;
  label: string;
}

export type PeriodKind = 'mois' | 'mois_precedent' | 'trimestre' | 'annee' | 'annee_precedente' | '12_mois' | 'personnalisee';

export function periodFor(kind: PeriodKind, ref = today(), custom?: { from: string; to: string }): Period {
  const d = parseIsoDate(ref)!;
  const y = d.getFullYear();
  const m = d.getMonth();
  const iso = (dt: Date) => toLocalIsoDate(dt);
  switch (kind) {
    case 'mois':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
    case 'mois_precedent': {
      const p = new Date(y, m - 1, 1);
      return { from: iso(p), to: iso(new Date(y, m, 0)), label: p.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
    }
    case 'trimestre': {
      const q = Math.floor(m / 3);
      return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)), label: `T${q + 1} ${y}` };
    }
    case 'annee':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Année ${y}` };
    case 'annee_precedente':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `Année ${y - 1}` };
    case '12_mois':
      return { from: addMonths(iso(new Date(y, m, 1)), -11), to: iso(new Date(y, m + 1, 0)), label: '12 derniers mois' };
    case 'personnalisee':
      return { from: custom?.from ?? `${y}-01-01`, to: custom?.to ?? ref, label: 'Période personnalisée' };
  }
}

export interface DashboardData {
  period: Period;
  prospects_total: number;
  prospects_new: number;
  clients_total: number;
  followups_today: number;
  followups_late: number;
  tasks_late: number;
  opportunities_open: number;
  pipeline_total_cents: number;
  pipeline_weighted_cents: number;
  quotes_sent: number;
  quotes_sent_cents: number;
  quotes_accepted: number;
  quotes_accepted_cents: number;
  quotes_conversion_pct: number | null;
  invoiced_ht_cents: number;
  invoiced_ttc_cents: number;
  collected_cents: number;
  unpaid_count: number;
  unpaid_cents: number;
  overdue_count: number;
  overdue_cents: number;
  projects_active: number;
  contracts_active: number;
  mrr_cents: number;
  draft_invoices: number;
  quotes_awaiting: number;
}

export async function dashboard(db: Db, period: Period): Promise<DashboardData> {
  const p = [period.from, period.to];
  const companies = await db.get<any>(
    `SELECT SUM(CASE WHEN kind = 'prospect' THEN 1 ELSE 0 END) AS prospects,
            SUM(CASE WHEN kind = 'client' THEN 1 ELSE 0 END) AS clients,
            SUM(CASE WHEN kind = 'prospect' AND date(created_at,'localtime') BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_prospects
     FROM companies WHERE archived_at IS NULL AND merged_into_id IS NULL`,
    p,
  );
  const followups = await db.get<any>(
    `SELECT SUM(CASE WHEN next_action_date = date('now','localtime') THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN next_action_date < date('now','localtime') THEN 1 ELSE 0 END) AS late
     FROM companies WHERE archived_at IS NULL AND merged_into_id IS NULL AND next_action_date IS NOT NULL`,
  );
  const acts = await activityCounts(db);
  const relances = await db.get<any>(
    `SELECT SUM(CASE WHEN date(due_at) = date('now','localtime') THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN date(due_at) < date('now','localtime') THEN 1 ELSE 0 END) AS late
     FROM activities WHERE status IN ('a_faire','en_cours') AND type IN ('relance','appel','email','rdv')`,
  );
  const pipe = await pipelineSummary(db);
  const quotes = await db.get<any>(
    `SELECT COUNT(*) AS sent, COALESCE(SUM(total_ht_cents), 0) AS sent_cents,
            SUM(CASE WHEN status = 'accepte' THEN 1 ELSE 0 END) AS accepted_of_sent
     FROM quotes WHERE sent_at IS NOT NULL AND date(sent_at,'localtime') BETWEEN ? AND ?`,
    p,
  );
  const accepted = await db.get<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_ht_cents), 0) AS cents FROM quotes WHERE status = 'accepte' AND date(accepted_at,'localtime') BETWEEN ? AND ?`,
    p,
  );
  const invoiced = await db.get<any>(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'avoir' THEN -total_ht_cents ELSE total_ht_cents END), 0) AS ht,
            COALESCE(SUM(CASE WHEN kind = 'avoir' THEN -total_ttc_cents ELSE total_ttc_cents END), 0) AS ttc
     FROM invoices WHERE status <> 'brouillon' AND issue_date BETWEEN ? AND ?`,
    p,
  );
  const collected = await db.get<any>('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE paid_at BETWEEN ? AND ?', p);
  const open = (await listInvoices(db, {})).filter((i) => i.kind !== 'avoir' && (i.status === 'emise' || i.status === 'partiellement_payee') && i.due_cents > 0);
  const overdue = open.filter((i) => i.display_status === 'en_retard');
  const projects = await db.get<any>(
    `SELECT COUNT(*) AS n FROM projects p LEFT JOIN project_statuses s ON s.id = p.status_id WHERE p.archived_at IS NULL AND COALESCE(s.is_closed, 0) = 0`,
  );
  const rec = await recurringSummary(db);
  const misc = await db.get<any>(
    `SELECT (SELECT COUNT(*) FROM invoices WHERE status = 'brouillon' AND archived_at IS NULL) AS drafts,
            (SELECT COUNT(*) FROM quotes WHERE status IN ('envoye','attente_signature') AND archived_at IS NULL) AS awaiting`,
  );
  return {
    period,
    prospects_total: companies?.prospects ?? 0,
    prospects_new: companies?.new_prospects ?? 0,
    clients_total: companies?.clients ?? 0,
    followups_today: (followups?.today ?? 0) + (relances?.today ?? 0),
    followups_late: (followups?.late ?? 0) + (relances?.late ?? 0),
    tasks_late: acts.late,
    opportunities_open: pipe.open_count,
    pipeline_total_cents: pipe.total_cents,
    pipeline_weighted_cents: pipe.weighted_cents,
    quotes_sent: quotes?.sent ?? 0,
    quotes_sent_cents: quotes?.sent_cents ?? 0,
    quotes_accepted: accepted?.n ?? 0,
    quotes_accepted_cents: accepted?.cents ?? 0,
    quotes_conversion_pct: quotes?.sent ? Math.round(((quotes.accepted_of_sent ?? 0) / quotes.sent) * 1000) / 10 : null,
    invoiced_ht_cents: invoiced?.ht ?? 0,
    invoiced_ttc_cents: invoiced?.ttc ?? 0,
    collected_cents: collected?.s ?? 0,
    unpaid_count: open.length,
    unpaid_cents: open.reduce((a, b) => a + b.due_cents, 0),
    overdue_count: overdue.length,
    overdue_cents: overdue.reduce((a, b) => a + b.due_cents, 0),
    projects_active: projects?.n ?? 0,
    contracts_active: rec.active,
    mrr_cents: rec.mrr_cents,
    draft_invoices: misc?.drafts ?? 0,
    quotes_awaiting: misc?.awaiting ?? 0,
  };
}

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string;
  invoiced_ht_cents: number;
  collected_cents: number;
  quotes_accepted_cents: number;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from.slice(0, 7) + '-01';
  const end = to.slice(0, 7);
  let guard = 0;
  while (cur.slice(0, 7) <= end && guard++ < 240) {
    out.push(cur.slice(0, 7));
    cur = addMonths(cur, 1);
  }
  return out;
}

export async function monthlySeries(db: Db, period: Period): Promise<MonthPoint[]> {
  const p = [period.from, period.to];
  const inv = await db.all<any>(
    `SELECT substr(issue_date, 1, 7) AS m, SUM(CASE WHEN kind = 'avoir' THEN -total_ht_cents ELSE total_ht_cents END) AS ht
     FROM invoices WHERE status <> 'brouillon' AND issue_date BETWEEN ? AND ? GROUP BY m`,
    p,
  );
  const pay = await db.all<any>('SELECT substr(paid_at, 1, 7) AS m, SUM(amount_cents) AS s FROM payments WHERE paid_at BETWEEN ? AND ? GROUP BY m', p);
  const qa = await db.all<any>(
    `SELECT substr(date(accepted_at,'localtime'), 1, 7) AS m, SUM(total_ht_cents) AS s FROM quotes WHERE status = 'accepte' AND date(accepted_at,'localtime') BETWEEN ? AND ? GROUP BY m`,
    p,
  );
  return monthsBetween(period.from, period.to).map((m) => {
    const d = parseIsoDate(m + '-01')!;
    return {
      month: m,
      label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      invoiced_ht_cents: inv.find((r) => r.m === m)?.ht ?? 0,
      collected_cents: pay.find((r) => r.m === m)?.s ?? 0,
      quotes_accepted_cents: qa.find((r) => r.m === m)?.s ?? 0,
    };
  });
}

export async function topServices(db: Db, period: Period, limit = 10) {
  return db.all<{ name: string; quantity_milli: number; ht_cents: number; invoices: number }>(
    `SELECT COALESCE(s.name, l.designation) AS name, SUM(l.quantity_milli) AS quantity_milli,
       SUM(CASE WHEN i.kind = 'avoir' THEN -1 ELSE 1 END * (
         CAST(ROUND(l.quantity_milli * l.unit_price_cents / 1000.0) AS INTEGER)
         - CASE l.discount_type WHEN 'percent' THEN CAST(ROUND(ROUND(l.quantity_milli * l.unit_price_cents / 1000.0) * l.discount_value / 10000.0) AS INTEGER)
                                WHEN 'amount' THEN l.discount_value ELSE 0 END)) AS ht_cents,
       COUNT(DISTINCT i.id) AS invoices
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id LEFT JOIN services s ON s.id = l.service_id
     WHERE i.status <> 'brouillon' AND l.kind = 'item' AND l.unit_price_cents > 0 AND i.kind IN ('facture','solde','avoir')
       AND i.issue_date BETWEEN ? AND ?
     GROUP BY COALESCE(CAST(l.service_id AS TEXT), lower(l.designation)) ORDER BY ht_cents DESC LIMIT ?`,
    [period.from, period.to, limit],
  );
}

export async function quoteStats(db: Db, period: Period) {
  const rows = await db.all<any>(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(total_ht_cents),0) AS ht FROM quotes
     WHERE issue_date BETWEEN ? AND ? AND archived_at IS NULL GROUP BY status`,
    [period.from, period.to],
  );
  return rows as { status: string; n: number; ht: number }[];
}

export async function receivablesAging(db: Db) {
  const open = (await listInvoices(db, {})).filter((i) => i.kind !== 'avoir' && (i.status === 'emise' || i.status === 'partiellement_payee') && i.due_cents > 0);
  const t = today();
  const buckets = { a_echoir: 0, j0_30: 0, j31_60: 0, j61_90: 0, plus_90: 0 };
  for (const i of open) {
    if (!i.due_date || i.due_date >= t) { buckets.a_echoir += i.due_cents; continue; }
    const days = Math.round((Date.parse(t) - Date.parse(i.due_date)) / 86400000);
    if (days <= 30) buckets.j0_30 += i.due_cents;
    else if (days <= 60) buckets.j31_60 += i.due_cents;
    else if (days <= 90) buckets.j61_90 += i.due_cents;
    else buckets.plus_90 += i.due_cents;
  }
  return { invoices: open, buckets };
}
