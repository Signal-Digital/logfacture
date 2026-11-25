/**
 * Statut commercial des prospects : une seule échelle, qui suit le parcours
 * de vente, modifiable en un clic et mise à jour automatiquement par les devis
 * et le pipeline (devis en préparation, envoyé, signé, refusé…).
 */
import type { Db } from '@/lib/db';
import { BusinessError, assert } from './context';
import { logEvent } from './audit';

export type CommercialStatus =
  | 'nouveau' | 'a_contacter' | 'contacte' | 'rdv' | 'devis_en_cours' | 'devis_envoye' | 'client' | 'a_recontacter' | 'perdu';

export interface StatusDef {
  key: CommercialStatus;
  label: string;
  short: string;
  color: string;
  /** Position dans le parcours (étapes principales) ; null = statut de côté */
  step: number | null;
  hint: string;
}

export const COMMERCIAL_STATUS_DEFS: StatusDef[] = [
  { key: 'nouveau', label: 'Nouveau', short: 'Nouveau', color: '#94a3b8', step: 0, hint: 'Fiche créée, pas encore traitée' },
  { key: 'a_contacter', label: 'À contacter', short: 'À contacter', color: '#818cf8', step: 1, hint: 'Premier contact à faire' },
  { key: 'contacte', label: 'Contacté', short: 'Contacté', color: '#60a5fa', step: 2, hint: 'Échange en cours' },
  { key: 'rdv', label: 'Rendez-vous / audit', short: 'RDV / audit', color: '#22d3ee', step: 3, hint: 'Rendez-vous ou audit prévu ou réalisé' },
  { key: 'devis_en_cours', label: 'Devis en préparation', short: 'Devis en prépa.', color: '#f59e0b', step: 4, hint: 'Devis en brouillon' },
  { key: 'devis_envoye', label: 'Devis envoyé', short: 'Devis envoyé', color: '#f97316', step: 5, hint: 'En attente de la réponse ou de la signature' },
  { key: 'client', label: 'Gagné — client', short: 'Gagné', color: '#22c55e', step: 6, hint: 'Devis signé ou accepté' },
  { key: 'a_recontacter', label: 'À recontacter', short: 'À recontacter', color: '#a855f7', step: null, hint: 'Pas maintenant : relance planifiée' },
  { key: 'perdu', label: 'Perdu', short: 'Perdu', color: '#ef4444', step: null, hint: 'Pas intéressé, devis refusé…' },
];

export const MAIN_STEPS = COMMERCIAL_STATUS_DEFS.filter((d) => d.step != null);

export function statusDef(key: string | null | undefined): StatusDef {
  return COMMERCIAL_STATUS_DEFS.find((d) => d.key === key) ?? COMMERCIAL_STATUS_DEFS[0];
}

export const LOST_REASONS = ['Budget insuffisant', 'Pas de besoin actuellement', 'A choisi un concurrent', 'Pas de réponse', 'Devis refusé', 'Projet abandonné', 'Autre'];

export interface StatusChangeOptions {
  /** Motif (statut « Perdu ») */
  reason?: string | null;
  /** Date de relance (statut « À recontacter ») : crée une activité de relance */
  followUpDate?: string | null;
  /** Origine du changement, pour le journal */
  source?: string;
}

/** Changement manuel du statut commercial (un clic, glisser-déposer…). */
export async function setCommercialStatus(db: Db, companyId: number, status: CommercialStatus, opts: StatusChangeOptions = {}): Promise<void> {
  if (!COMMERCIAL_STATUS_DEFS.some((d) => d.key === status)) throw new BusinessError('Statut inconnu.');
  if (opts.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(opts.followUpDate)) throw new BusinessError('Date de relance invalide.');
  await db.tx(async (t) => {
    const c = await t.get<any>('SELECT id, name, kind, commercial_status FROM companies WHERE id = ?', [companyId]);
    assert(c, 'Fiche introuvable.');
    if (status === 'client') {
      const { convertToClient } = await import('./companies');
      await convertToClient(t, companyId, 'statut « Gagné »');
    } else {
      await t.run(
        `UPDATE companies SET commercial_status = ?, lost_reason = ?, status_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        [status, status === 'perdu' ? opts.reason?.trim() || null : null, companyId],
      );
    }
    if (status === 'a_recontacter' && opts.followUpDate) {
      const { createActivity } = await import('./activities');
      await createActivity(t, { type: 'relance', title: `Recontacter ${c.name}`, company_id: companyId, due_at: `${opts.followUpDate}T09:00:00`, notes: opts.reason ?? null });
      await t.run('UPDATE companies SET next_action = ?, next_action_date = ? WHERE id = ?', [`Recontacter ${c.name}`, opts.followUpDate, companyId]);
    }
    if (c.commercial_status !== status) await syncOpportunity(t, companyId, status, opts.reason ?? null);
    if (c.commercial_status !== status) {
      await logEvent(t, {
        entity: 'entreprise', id: companyId, action: 'statut',
        summary: `Statut : ${statusDef(c.commercial_status).label} → ${statusDef(status).label}${status === 'perdu' && opts.reason ? ` (${opts.reason.trim()})` : ''}${opts.followUpDate ? ` — relance le ${opts.followUpDate.split('-').reverse().join('/')}` : ''}`,
        companyId,
      });
    }
  });
}

/**
 * Mise à jour automatique déclenchée par un événement (devis, pipeline).
 * Le statut n'avance que dans le sens du parcours : il ne recule jamais sur
 * une action automatique, sauf pour « réveiller » une fiche perdue ou à
 * recontacter quand un nouveau devis est préparé. « Gagné » n'est jamais
 * modifié automatiquement.
 */
export async function autoStatus(db: Db, companyId: number, target: CommercialStatus, reason: string): Promise<void> {
  const c = await db.get<{ commercial_status: string }>('SELECT commercial_status FROM companies WHERE id = ?', [companyId]);
  if (!c || c.commercial_status === target || c.commercial_status === 'client') return;
  const cur = statusDef(c.commercial_status);
  const tgt = statusDef(target);
  let apply = false;
  if (target === 'perdu' || target === 'a_recontacter') {
    // Seulement si plus aucun devis n'est en cours pour ce prospect.
    const open = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM quotes WHERE company_id = ? AND status IN ('brouillon','envoye','attente_signature') AND archived_at IS NULL", [companyId]);
    apply = (open?.n ?? 0) === 0 && (cur.key === 'devis_envoye' || cur.key === 'devis_en_cours');
  } else if (cur.step == null) {
    apply = true; // réveil d'une fiche perdue / à recontacter
  } else {
    apply = (tgt.step ?? -1) > cur.step;
  }
  if (!apply) return;
  await db.run(
    `UPDATE companies SET commercial_status = ?, lost_reason = ?, status_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [target, target === 'perdu' ? reason : null, companyId],
  );
  await logEvent(db, { entity: 'entreprise', id: companyId, action: 'statut_auto', summary: `Statut mis à jour automatiquement : ${cur.label} → ${tgt.label} (${reason})`, companyId });
  await syncOpportunity(db, companyId, target, target === 'perdu' ? reason : null);
}

// ---------- Lien avec le pipeline commercial ----------

/** Étape du pipeline correspondant à un statut (la première dans l'ordre du pipeline). */
export async function stageForStatus(db: Db, status: string) {
  return db.get<{ id: number; name: string; kind: 'open' | 'won' | 'lost'; default_probability: number }>(
    'SELECT id, name, kind, default_probability FROM pipeline_stages WHERE status_key = ? AND archived_at IS NULL ORDER BY position, id LIMIT 1',
    [status],
  );
}

/**
 * Répercute le statut d'un prospect dans le pipeline :
 *  - aucune opportunité en cours : elle est créée (sauf « Perdu » et « Gagné ») ;
 *  - une seule opportunité en cours : elle est déplacée dans l'étape correspondante ;
 *  - plusieurs opportunités : elles ne sont pas déplacées (chacune suit son devis).
 * Les opportunités déjà dans une étape de même statut ne bougent pas.
 */
export async function syncOpportunity(db: Db, companyId: number, status: string, lostReason: string | null = null): Promise<void> {
  const stage = await stageForStatus(db, status);
  if (!stage) return;
  const company = await db.get<{ name: string; potential_cents: number; kind: string }>('SELECT name, potential_cents, kind FROM companies WHERE id = ?', [companyId]);
  if (!company) return;
  const opps = await db.all<{ id: number; stage_id: number; probability: number; stage_status: string | null; title: string; is_auto: number }>(
    `SELECT o.id, o.stage_id, o.probability, o.title, o.is_auto, s.status_key AS stage_status FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
     WHERE o.company_id = ? AND o.status = 'open' AND o.archived_at IS NULL`,
    [companyId],
  );
  if (opps.length === 0) {
    if (stage.kind !== 'open' || company.kind === 'client') return;
    const max = await db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM opportunities WHERE stage_id = ?', [stage.id]);
    const r = await db.run(
      `INSERT INTO opportunities (company_id, title, stage_id, amount_cents, probability, status, position, is_auto) VALUES (?, ?, ?, ?, ?, 'open', ?, 1)`,
      [companyId, company.name, stage.id, company.potential_cents ?? 0, stage.default_probability, (max?.p ?? 0) + 1],
    );
    await logEvent(db, { entity: 'opportunite', id: r.lastInsertId, action: 'creation', summary: `Ajouté au pipeline : ${company.name} (${stage.name})`, companyId });
    return;
  }
  if (opps.length > 1) return;
  const o = opps[0];
  if (o.stage_status === status || o.stage_id === stage.id) return;
  // Une affaire saisie n'est gagnée que par son devis accepté (ou à la main) :
  // devenir client pour une autre raison (ex. facture ponctuelle) ne la clôt pas.
  if (status === 'client' && !o.is_auto) return;
  const max = await db.get<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM opportunities WHERE stage_id = ?', [stage.id]);
  const oppStatus = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open';
  await db.run(
    `UPDATE opportunities SET stage_id = ?, position = ?, status = ?, probability = ?, lost_reason = CASE WHEN ? = 'lost' THEN ? ELSE lost_reason END,
       closed_at = CASE WHEN ? = 'open' THEN NULL ELSE COALESCE(closed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [stage.id, (max?.p ?? 0) + 1, oppStatus, stage.kind === 'open' ? Math.max(o.probability, stage.default_probability) : stage.default_probability, oppStatus, lostReason, oppStatus, o.id],
  );
  await logEvent(db, { entity: 'opportunite', id: o.id, action: 'changement_etape', summary: `« ${o.title} » déplacée dans le pipeline : ${stage.name} (statut du prospect)`, companyId });
}

/**
 * Rattrapage (une fois) : place dans le pipeline les prospects actifs qui n'y
 * sont pas encore, et aligne les opportunités uniques sur le statut du prospect.
 */
export async function backfillPipeline(db: Db): Promise<number> {
  const companies = await db.all<{ id: number; commercial_status: string }>(
    "SELECT id, commercial_status FROM companies WHERE kind = 'prospect' AND archived_at IS NULL AND merged_into_id IS NULL",
  );
  let n = 0;
  for (const c of companies) {
    const before = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM opportunities WHERE company_id = ? AND status = 'open' AND archived_at IS NULL", [c.id]);
    await syncOpportunity(db, c.id, c.commercial_status);
    if ((before?.n ?? 0) === 0) n++;
  }
  return n;
}

export async function statusCounts(db: Db, kind: string | string[] | undefined): Promise<Record<string, number>> {
  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;
  const rows = await db.all<{ s: string; n: number }>(
    `SELECT commercial_status AS s, COUNT(*) AS n FROM companies WHERE archived_at IS NULL AND merged_into_id IS NULL
     ${kinds ? `AND kind IN (${kinds.map(() => '?').join(',')})` : ''} GROUP BY commercial_status`,
    kinds ?? [],
  );
  return Object.fromEntries(rows.map((r) => [r.s, r.n]));
}
